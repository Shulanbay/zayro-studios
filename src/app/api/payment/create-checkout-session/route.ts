import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '@/lib/db';
import { temporaryHolds, services, payments, bookings, integrationLogs } from '@/lib/db/schema';
import { calculatePricing } from '@/lib/pricing';
import { checkBookable } from '@/lib/catalogData';
import { generateBookingId, isValidPhone, getBaseUrl, formatBookingDateUTC, toDateOnly } from '@/lib/utils';
import { upsertCustomer } from '@/lib/crm/customers';
import { createPurchase, orderNumberForBooking } from '@/lib/crm/purchases';
import { enforceRateLimit, isHoneypotTripped } from '@/lib/crm/rateLimit';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  holdId: z.string().trim().min(1).max(64),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(7).max(20).refine(isValidPhone, 'Invalid phone number'),
  company: z.string().trim().max(255).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  website: z.string().optional(),
});

/**
 * Starts Stripe Checkout for a held slot. The price is recomputed on the
 * server; the booking (payment_pending) and its purchase are written with
 * that price as a snapshot, which the webhook later checks the payment
 * against. Stripe metadata carries only ids — never contact details.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'checkout', 20, 600);
  if (limited) return limited;

  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await request.json();
    if (isHoneypotTripped(raw)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      const missing = parsed.error.issues.some((i) => i.code === 'invalid_type' && i.received === 'undefined');
      const first = parsed.error.issues[0];
      const error = missing
        ? 'Missing required fields'
        : first.path[0] === 'email'
          ? 'Invalid email format'
          : first.path[0] === 'phone'
            ? 'Invalid phone number'
            : `Invalid ${String(first.path[0] ?? 'input')}`;
      return NextResponse.json({ error }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const { holdId, firstName, lastName, email, phone, company, notes } = body;

    const hold = await db.query.temporaryHolds.findFirst({ where: eq(temporaryHolds.id, holdId) });
    if (!hold) {
      await logStripe(null, 'failed', 'Hold not found');
      return NextResponse.json({ error: 'Booking hold not found' }, { status: 404 });
    }
    const now = new Date();
    if (hold.hold_expires_at <= now) {
      return NextResponse.json({ error: 'Booking hold has expired. Please select a new time slot.' }, { status: 410 });
    }
    if (hold.status !== 'active') {
      return NextResponse.json({ error: 'Booking hold is no longer active' }, { status: 409 });
    }
    // A hold created for one email can't be checked out by someone else.
    if (hold.customer_email.trim().toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: 'This hold belongs to a different customer' }, { status: 403 });
    }

    const service = await db.query.services.findFirst({ where: eq(services.id, hold.service_id) });
    if (!service || !service.is_active) {
      await logStripe(null, 'failed', 'Service not found or inactive');
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }
    const bookable = checkBookable(service);
    if (!bookable.ok) return NextResponse.json({ error: bookable.error }, { status: bookable.status });

    const pricing = await calculatePricing(hold.service_id);
    if (!pricing) return NextResponse.json({ error: 'Could not calculate pricing' }, { status: 500 });
    // Free services never go through Stripe — the server decides the path.
    if (pricing.total <= 0) {
      return NextResponse.json(
        { error: 'This service has no charge; use the free booking confirmation instead.', freeBooking: true },
        { status: 400 }
      );
    }

    const bookingUuid = crypto.randomUUID();
    const bookingIdString = generateBookingId();
    const bookingDate = toDateOnly(hold.booking_date);
    const baseUrl = getBaseUrl(request);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: pricing.currency.toLowerCase(),
            product_data: {
              name: service.name,
              description: `Studio Session - ${formatBookingDateUTC(bookingDate)}, ${hold.start_time} ET`,
              metadata: { serviceId: service.id.toString() },
            },
            // The tax-inclusive total as one line item, so the amount Stripe
            // collects is exactly the booking's stored total.
            unit_amount: pricing.total,
          },
          quantity: 1,
        },
      ],
      billing_address_collection: 'required',
      customer_email: email,
      success_url: `${baseUrl}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/booking/cancel?hold_id=${holdId}`,
      mode: 'payment',
      metadata: { bookingId: bookingUuid, holdId: hold.id, serviceId: service.id.toString() },
      payment_intent_data: { metadata: { bookingId: bookingUuid } },
      // Stripe requires ≥ 30 minutes; the webhook re-checks the slot when a
      // payment lands after our shorter hold has expired.
      expires_at: Math.max(Math.floor(hold.hold_expires_at.getTime() / 1000), Math.floor(Date.now() / 1000) + 30 * 60),
    });

    try {
      await db.transaction(async (tx) => {
        const customer = await upsertCustomer(tx, { email, firstName, lastName, phone, company }, { updateContact: true });
        const purchase = await createPurchase(tx, {
          orderNumber: orderNumberForBooking(bookingIdString),
          customerId: customer.id,
          type: 'individual',
          status: 'pending',
          taxCents: pricing.taxAmount,
          paymentMethod: 'stripe',
          stripeCheckoutSessionId: session.id,
          items: [
            {
              itemType: 'service',
              referenceId: service.id,
              description: `${service.name} — ${bookingDate} ${hold.start_time}–${hold.end_time} ET`,
              unitPriceCents: pricing.subtotal,
              metadata: { bookingId: bookingIdString, category: service.category, durationMinutes: hold.duration_minutes, taxRate: pricing.taxRate },
            },
          ],
        });
        await tx.insert(bookings).values({
          id: bookingUuid,
          booking_id: bookingIdString,
          customer_id: customer.id,
          service_id: hold.service_id,
          // Plain YYYY-MM-DD: never send the driver's Date object.
          booking_date: bookingDate,
          start_time: hold.start_time,
          end_time: hold.end_time,
          duration_minutes: hold.duration_minutes,
          customer_first_name: firstName,
          customer_last_name: lastName,
          customer_email: email,
          customer_phone: phone,
          company_name: company || null,
          notes: notes || null,
          status: 'payment_pending',
          payment_status: 'pending',
          subtotal: (pricing.subtotal / 100).toFixed(2),
          tax_amount: (pricing.taxAmount / 100).toFixed(2),
          total_amount: (pricing.total / 100).toFixed(2),
          stripe_session_id: session.id,
          purchase_id: purchase.id,
          source: 'individual',
          created_at: now,
          updated_at: now,
        });
        await tx.insert(payments).values({
          booking_id: bookingUuid,
          stripe_payment_id: session.id,
          amount: (pricing.total / 100).toFixed(2),
          currency: pricing.currency,
          status: 'pending',
          metadata: { holdId: hold.id, serviceId: service.id, checkoutSessionId: session.id },
        });
      });
    } catch (dbError) {
      // Don't leave a payable Checkout session without a booking behind it.
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
      throw dbError;
    }

    await logStripe(bookingUuid, 'success', 'Stripe session created', { sessionId: session.id, holdId: hold.id, amount: pricing.total / 100 });

    return NextResponse.json({
      checkoutUrl: session.url,
      sessionId: session.id,
      pricing: {
        subtotal: (pricing.subtotal / 100).toFixed(2),
        taxAmount: (pricing.taxAmount / 100).toFixed(2),
        total: (pricing.total / 100).toFixed(2),
        currency: pricing.currency,
      },
    });
  } catch (error) {
    console.error('Error creating checkout session:', (error as Error)?.message || error);
    await logStripe(null, 'failed', 'Stripe session creation error', { error: (error as Error)?.message?.slice(0, 300) ?? 'unknown' });
    return NextResponse.json({ error: 'Failed to create payment session' }, { status: 500 });
  }
}

async function logStripe(bookingId: string | null, status: 'success' | 'failed', message: string, data?: Record<string, unknown>) {
  try {
    await db.insert(integrationLogs).values({
      integration_type: 'stripe',
      booking_id: bookingId,
      status,
      error_message: status === 'failed' ? message : null,
      response_data: { message, ...(data ?? {}), timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error logging integration:', (err as Error)?.message || err);
  }
}
