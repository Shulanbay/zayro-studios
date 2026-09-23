import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  temporaryHolds,
  services,
  payments,
  bookings,
  customers,
  integrationLogs,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { calculatePricing } from '@/lib/pricing';
import { generateBookingId, isValidEmail, isValidPhone } from '@/lib/utils';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { holdId, firstName, lastName, email, phone, company, notes } = body;

    // Validate required fields
    if (!holdId || !firstName || !lastName || !email || !phone) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    if (!isValidPhone(phone)) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }

    // ========================================
    // RETRIEVE AND VALIDATE HOLD
    // ========================================
    const hold = await db.query.temporaryHolds.findFirst({
      where: eq(temporaryHolds.id, holdId),
    });

    if (!hold) {
      await logIntegration('stripe', null, 'failed', 'Hold not found');
      return NextResponse.json(
        { error: 'Booking hold not found' },
        { status: 404 }
      );
    }

    const now = new Date();

    if (hold.hold_expires_at <= now) {
      await logIntegration('stripe', null, 'failed', 'Hold expired');
      return NextResponse.json(
        { error: 'Booking hold has expired. Please select a new time slot.' },
        { status: 410 }
      );
    }

    if (hold.status !== 'active') {
      await logIntegration('stripe', null, 'failed', 'Hold not active');
      return NextResponse.json(
        { error: 'Booking hold is no longer active' },
        { status: 409 }
      );
    }

    // A hold created for a different customer's email cannot be checked out
    // by someone else supplying different contact details.
    if (hold.customer_email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json(
        { error: 'This hold belongs to a different customer' },
        { status: 403 }
      );
    }

    // ========================================
    // GET SERVICE AND CALCULATE PRICING (SERVER-SIDE, AUTHORITATIVE)
    // ========================================
    const service = await db.query.services.findFirst({
      where: eq(services.id, hold.service_id),
    });

    if (!service || !service.is_active) {
      await logIntegration('stripe', null, 'failed', 'Service not found or inactive');
      return NextResponse.json(
        { error: 'Service not found' },
        { status: 404 }
      );
    }

    const pricing = await calculatePricing(hold.service_id);

    if (!pricing) {
      await logIntegration('stripe', null, 'failed', 'Pricing calculation failed');
      return NextResponse.json(
        { error: 'Could not calculate pricing' },
        { status: 500 }
      );
    }

    // Free services never go through Stripe — the client must call
    // /api/booking/confirm-free instead. This also blocks a tampered
    // client from routing a paid service into a "free" confirmation path,
    // since the server (not the client) decides which path is valid.
    if (pricing.total <= 0) {
      return NextResponse.json(
        { error: 'This service has no charge; use the free booking confirmation instead.', freeBooking: true },
        { status: 400 }
      );
    }

    // ========================================
    // CREATE STRIPE CHECKOUT SESSION
    // ========================================
    const bookingDateTime = `${hold.booking_date} ${hold.start_time} ET`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: pricing.currency.toLowerCase(),
            product_data: {
              name: service.name,
              description: `Studio Session - ${bookingDateTime}`,
              metadata: {
                serviceId: service.id.toString(),
                holdId: hold.id,
              },
            },
            // Charge the tax-inclusive total as a single line item so the
            // amount Stripe actually collects matches what the webhook
            // validates against (pricing.total). The subtotal/tax split is
            // still shown to the customer in our own UI and emails.
            unit_amount: pricing.total,
          },
          quantity: 1,
        },
      ],
      billing_address_collection: 'required',
      customer_email: email,
      success_url: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/booking/cancel?hold_id=${holdId}`,
      mode: 'payment',
      metadata: {
        holdId: hold.id,
        serviceId: service.id.toString(),
        customerEmail: email,
        customerFirstName: firstName,
        customerLastName: lastName,
        customerPhone: phone,
        companyName: company || '',
        notes: notes || '',
      },
      expires_at: Math.floor(hold.hold_expires_at.getTime() / 1000),
    });

    // ========================================
    // CREATE PAYMENT_PENDING BOOKING
    // ========================================
    const bookingIdString = generateBookingId();
    const bookingId = crypto.randomUUID();

    let customerId: string;
    const existingCustomer = await db.query.customers.findFirst({
      where: eq(customers.email, email),
    });

    if (existingCustomer) {
      customerId = existingCustomer.id;
      await db
        .update(customers)
        .set({ first_name: firstName, last_name: lastName, phone, company: company || null, updated_at: now })
        .where(eq(customers.id, existingCustomer.id));
    } else {
      const newCustomers = await db
        .insert(customers)
        .values({
          email,
          first_name: firstName,
          last_name: lastName,
          phone,
          company: company || null,
        })
        .returning();

      customerId = newCustomers[0].id;
    }

    await db.insert(bookings).values({
      id: bookingId,
      booking_id: bookingIdString,
      customer_id: customerId,
      service_id: hold.service_id,
      booking_date: hold.booking_date,
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
      created_at: now,
      updated_at: now,
    });

    await db.insert(payments).values({
      booking_id: bookingId,
      stripe_payment_id: session.id,
      amount: (pricing.total / 100).toFixed(2),
      currency: pricing.currency,
      status: 'pending',
      metadata: {
        holdId: hold.id,
        serviceId: service.id,
        checkoutSessionId: session.id,
        customerEmail: email,
        createdAt: now.toISOString(),
      },
    });

    await logIntegration('stripe', bookingId, 'success', 'Stripe session created', {
      sessionId: session.id,
      holdId: hold.id,
      amount: pricing.total / 100,
    });

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
  } catch (error: any) {
    console.error('Error creating checkout session:', error);

    await logIntegration('stripe', null, 'failed', 'Stripe session creation error', {
      error: error.message,
      code: error.code,
    });

    return NextResponse.json(
      { error: 'Failed to create payment session' },
      { status: 500 }
    );
  }
}

async function logIntegration(
  type: 'stripe',
  bookingId: string | null,
  status: 'pending' | 'success' | 'failed',
  message: string,
  data?: any
) {
  try {
    await db.insert(integrationLogs).values({
      integration_type: type,
      booking_id: bookingId ? (bookingId as any) : null,
      status: status,
      error_message: status === 'failed' ? message : null,
      response_data: data ? { ...data, timestamp: new Date().toISOString() } : null,
    });
  } catch (err) {
    console.error('Error logging integration:', err);
  }
}
