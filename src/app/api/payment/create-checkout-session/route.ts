import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { temporaryHolds, services, payments, bookings, integrationLogs } from '@/lib/db/schema';
import { calculatePricing } from '@/lib/pricing';
import { checkBookable } from '@/lib/catalogData';
import { generateBookingId, isValidPhone, getBaseUrl, formatBookingDateUTC, toDateOnly } from '@/lib/utils';
import { upsertCustomer } from '@/lib/crm/customers';
import { createPurchase, orderNumberForBooking } from '@/lib/crm/purchases';
import { enforceRateLimit, isHoneypotTripped } from '@/lib/crm/rateLimit';
import { decimalToCents } from '@/lib/crm/money';
import { getStripe } from '@/lib/crm/refunds';
import { formatTimeLabel } from '@/lib/crm/time';
import { lockHold, pendingCheckoutsForHold } from '@/lib/holds';

/** Checkout session lifetime: Stripe's minimum is 30 minutes, plus a minute of clock slack. */
const CHECKOUT_MINUTES = 31;

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  holdId: z.string().trim().uuid(),
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
            : first.path[0] === 'holdId'
              ? 'Your time slot reservation was not found. Please choose a time again.'
            : `Invalid ${String(first.path[0] ?? 'input')}`;
      return NextResponse.json({ error }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const stripe = getStripe();
  if (!stripe) {
    await logStripe(null, 'failed', 'STRIPE_SECRET_KEY is not configured');
    return NextResponse.json({ error: 'Online payment is temporarily unavailable. Please try again shortly.' }, { status: 503 });
  }

  // Set when a new Checkout session exists, so a failed database write can
  // expire it again instead of leaving a payable session behind.
  let createdSessionId: string | null = null;

  try {
    const { holdId, firstName, lastName, email, phone, company, notes } = body;
    const baseUrl = getBaseUrl(request);

    const outcome = await db.transaction(async (tx) => {
      // One request per hold at a time: a double click or a retry can't
      // start two Checkout sessions (and two pending bookings) for one slot.
      await lockHold(tx, holdId);

      const hold = await tx.query.temporaryHolds.findFirst({ where: eq(temporaryHolds.id, holdId) });
      if (!hold) return { kind: 'error' as const, status: 404, error: 'Booking hold not found', log: 'Hold not found' };
      // A hold created for one email can't be checked out by someone else.
      if (hold.customer_email.trim().toLowerCase() !== email.toLowerCase()) {
        return { kind: 'error' as const, status: 403, error: 'This hold belongs to a different customer' };
      }

      // Asked again for the same hold (double click, back button, retry):
      // hand back the session that already exists instead of a second one.
      const [prior] = await pendingCheckoutsForHold(tx, hold.id);
      if (prior?.stripe_session_id) {
        const existing = await stripe.checkout.sessions.retrieve(prior.stripe_session_id);
        if (existing.status === 'complete') {
          return { kind: 'error' as const, status: 409, error: 'This booking has already been paid.', alreadyPaid: true, sessionId: existing.id };
        }
        if (existing.status === 'open' && existing.url) {
          await tx
            .update(bookings)
            .set({
              customer_first_name: firstName,
              customer_last_name: lastName,
              customer_phone: phone,
              company_name: company || null,
              notes: notes || null,
              updated_at: new Date(),
            })
            .where(eq(bookings.id, prior.id));
          return {
            kind: 'ok' as const,
            reused: true,
            bookingId: prior.id,
            session: existing,
            pricing: {
              subtotal: decimalToCents(prior.subtotal),
              taxAmount: decimalToCents(prior.tax_amount),
              total: decimalToCents(prior.total_amount),
              currency: 'USD',
            },
          };
        }
        // An expired session: its booking is released by the webhook; the
        // hold (stretched to that session's expiry) is no longer usable.
      }

      const now = new Date();
      if (new Date(hold.hold_expires_at) <= now) {
        return { kind: 'error' as const, status: 410, error: 'Booking hold has expired. Please select a new time slot.' };
      }
      if (hold.status !== 'active') {
        return { kind: 'error' as const, status: 409, error: 'Booking hold is no longer active' };
      }

      const service = await tx.query.services.findFirst({ where: eq(services.id, hold.service_id) });
      if (!service || !service.is_active) {
        return { kind: 'error' as const, status: 404, error: 'Service not found', log: 'Service not found or inactive' };
      }
      const bookable = checkBookable(service);
      if (!bookable.ok) return { kind: 'error' as const, status: bookable.status, error: bookable.error };

      const pricing = await calculatePricing(hold.service_id);
      if (!pricing) return { kind: 'error' as const, status: 500, error: 'Could not calculate pricing' };
      // Free services never go through Stripe — the server decides the path.
      if (pricing.total <= 0) {
        return {
          kind: 'error' as const,
          status: 400,
          error: 'This service has no charge; use the free booking confirmation instead.',
          freeBooking: true,
        };
      }

      const bookingUuid = crypto.randomUUID();
      const bookingIdString = generateBookingId();
      const bookingDate = toDateOnly(hold.booking_date);

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: pricing.currency.toLowerCase(),
              product_data: {
                name: service.name,
                description: `Studio Session - ${formatBookingDateUTC(bookingDate)}, ${formatTimeLabel(hold.start_time)} ET`,
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
        cancel_url: `${baseUrl}/booking/cancel?hold_id=${hold.id}`,
        mode: 'payment',
        metadata: { bookingId: bookingUuid, holdId: hold.id, serviceId: service.id.toString() },
        payment_intent_data: { metadata: { bookingId: bookingUuid } },
        // Stripe requires 30 minutes to 24 hours; the hold is stretched to
        // the same instant below, so the slot is blocked for exactly as long
        // as this session can be paid.
        expires_at: Math.floor(now.getTime() / 1000) + CHECKOUT_MINUTES * 60,
      });
      createdSessionId = session.id;
      const sessionExpiresAt = new Date((session.expires_at ?? Math.floor(now.getTime() / 1000) + CHECKOUT_MINUTES * 60) * 1000);

      const stretched = await tx
        .update(temporaryHolds)
        .set({ hold_expires_at: sessionExpiresAt })
        .where(and(eq(temporaryHolds.id, hold.id), eq(temporaryHolds.status, 'active')))
        .returning({ id: temporaryHolds.id });
      if (stretched.length === 0) throw new Error('Hold changed while starting checkout');

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
      return { kind: 'ok' as const, reused: false, bookingId: bookingUuid, session, pricing };
    });

    if (outcome.kind === 'error') {
      if ('log' in outcome && outcome.log) await logStripe(null, 'failed', outcome.log);
      const { kind: _kind, status, log: _log, ...rest } = outcome as typeof outcome & { log?: string };
      return NextResponse.json(rest, { status });
    }

    if (!outcome.reused) {
      await logStripe(outcome.bookingId, 'success', 'Stripe session created', {
        sessionId: outcome.session.id,
        holdId,
        amount: outcome.pricing.total / 100,
      });
    }

    return NextResponse.json({
      checkoutUrl: outcome.session.url,
      sessionId: outcome.session.id,
      expiresAt: outcome.session.expires_at ? new Date(outcome.session.expires_at * 1000).toISOString() : null,
      pricing: {
        subtotal: (outcome.pricing.subtotal / 100).toFixed(2),
        taxAmount: (outcome.pricing.taxAmount / 100).toFixed(2),
        total: (outcome.pricing.total / 100).toFixed(2),
        currency: outcome.pricing.currency,
      },
    });
  } catch (error) {
    // Don't leave a payable Checkout session without a booking behind it.
    if (createdSessionId) await stripe.checkout.sessions.expire(createdSessionId).catch(() => undefined);
    console.error('Error creating checkout session:', (error as Error)?.message || error);
    await logStripe(null, 'failed', 'Stripe session creation error', { error: (error as Error)?.message?.slice(0, 300) ?? 'unknown' });
    return NextResponse.json({ error: 'We could not start the payment. Please try again in a moment.' }, { status: 500 });
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
