import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import {
  temporaryHolds,
  bookings,
  payments,
  services,
  integrationLogs,
} from '@/lib/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { calculatePricing } from '@/lib/pricing';
import { overlaps, timeToMinutes } from '@/lib/availability';
import { toDateOnly } from '@/lib/utils';
import { runPostConfirmationSideEffects } from '@/lib/postConfirmation';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = (await headers()).get('stripe-signature');

  if (!signature) {
    await logWebhook(null, 'failed', 'Missing stripe-signature header');
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 401 }
    );
  }

  // ========================================
  // VERIFY WEBHOOK SIGNATURE
  // ========================================
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    await logWebhook(null, 'failed', `Signature verification failed: ${err.message}`);
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json(
      { error: 'Invalid webhook signature' },
      { status: 401 }
    );
  }

  // ========================================
  // HANDLE RELEVANT EVENTS
  // ========================================
  if (event.type === 'checkout.session.completed') {
    return handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
  }

  if (event.type === 'charge.succeeded') {
    return handleChargeSucceeded(event.data.object as Stripe.Charge);
  }

  // Acknowledge other event types
  return NextResponse.json({ received: true });
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  try {
    const metadata = session.metadata as Record<string, string>;
    const holdId = metadata?.holdId;
    const serviceId = metadata?.serviceId ? parseInt(metadata.serviceId) : null;

    if (!holdId || !serviceId) {
      await logWebhook(session.id, 'failed', 'Missing metadata in session');
      return NextResponse.json(
        { error: 'Missing metadata' },
        { status: 400 }
      );
    }

    // ========================================
    // RETRIEVE HOLD
    // ========================================
    const hold = await db.query.temporaryHolds.findFirst({
      where: eq(temporaryHolds.id, holdId),
    });

    if (!hold) {
      await logWebhook(session.id, 'failed', 'Hold not found', { holdId });
      return NextResponse.json(
        { error: 'Hold not found' },
        { status: 404 }
      );
    }

    // Check if this payment has already been processed (idempotency)
    const existingBooking = await db.query.bookings.findFirst({
      where: and(
        eq(bookings.stripe_session_id, session.id),
        eq(bookings.status, 'confirmed')
      ),
    });

    if (existingBooking) {
      await logWebhook(session.id, 'success', 'Booking already confirmed (idempotent)', {
        bookingId: existingBooking.id,
      });
      return NextResponse.json({
        received: true,
        status: 'already_processed',
        bookingId: existingBooking.id,
      });
    }

    // ========================================
    // VALIDATE PRICING
    // ========================================
    const pricing = await calculatePricing(serviceId);

    if (!pricing) {
      await logWebhook(session.id, 'failed', 'Could not calculate pricing');
      return NextResponse.json(
        { error: 'Pricing validation failed' },
        { status: 500 }
      );
    }

    // Verify amount matches (in cents)
    const expectedTotal = pricing.total;
    const actualTotal = session.amount_total || 0;

    if (actualTotal !== expectedTotal) {
      await logWebhook(session.id, 'failed', 'Payment amount mismatch', {
        expected: expectedTotal,
        actual: actualTotal,
        holdId,
      });
      return NextResponse.json(
        { error: 'Payment amount mismatch' },
        { status: 400 }
      );
    }

    // Verify currency
    if (session.currency?.toUpperCase() !== 'USD') {
      await logWebhook(session.id, 'failed', 'Currency mismatch', {
        expected: 'USD',
        actual: session.currency,
      });
      return NextResponse.json(
        { error: 'Currency mismatch' },
        { status: 400 }
      );
    }

    // Customer already created during checkout session creation

    // ========================================
    // CONFIRM PAYMENT_PENDING BOOKING (ATOMIC TRANSACTION)
    // ========================================
    const now = new Date();

    try {
      // Get the payment_pending booking created during checkout
      const existingBooking = await db.query.bookings.findFirst({
        where: eq(bookings.stripe_session_id, session.id),
      });

      if (!existingBooking) {
        await logWebhook(session.id, 'failed', 'Payment_pending booking not found', {
          sessionId: session.id,
        });
        return NextResponse.json(
          { error: 'Booking not found' },
          { status: 404 }
        );
      }

      // Our hold (15 min) is shorter than Stripe's minimum session
      // lifetime (30 min), so a payment can land after the hold object
      // itself has expired. Don't trust the hold's own status for that —
      // re-check the actual slot for a conflicting CONFIRMED booking made
      // by someone else in the meantime. Payment already succeeded either
      // way, so on conflict we flag for manual review/refund instead of
      // silently double-booking the slot.
      // The studio is one room, so any confirmed booking (for any service)
      // whose time range overlaps this one is a conflict.
      const sameDayConfirmed = await db.query.bookings.findMany({
        where: and(
          eq(bookings.booking_date, toDateOnly(existingBooking.booking_date)),
          eq(bookings.status, 'confirmed')
        ),
      });
      const conflictingBooking = sameDayConfirmed.find(
        (b) =>
          b.id !== existingBooking.id &&
          overlaps(
            timeToMinutes(existingBooking.start_time),
            timeToMinutes(existingBooking.end_time),
            timeToMinutes(b.start_time),
            timeToMinutes(b.end_time)
          )
      );

      if (conflictingBooking) {
        await logWebhook(session.id, 'failed', 'Slot was booked by someone else before this payment landed — needs manual refund review', {
          bookingId: existingBooking.id,
          conflictingBookingId: conflictingBooking.id,
          holdId,
        });
        return NextResponse.json({
          received: true,
          status: 'conflict_needs_manual_review',
          bookingId: existingBooking.id,
        });
      }

      // Update and confirm the booking in a transaction. The status guard
      // makes this a compare-and-set: if two deliveries of the same event
      // race past the idempotency check above, only one of them flips the
      // booking to confirmed and runs the side effects below.
      const didConfirm = await db.transaction(async (tx) => {
        // Update booking to confirmed
        const updated = await tx
          .update(bookings)
          .set({
            status: 'confirmed',
            payment_status: 'succeeded',
            stripe_payment_id: session.payment_intent as string,
            updated_at: now,
          })
          .where(and(eq(bookings.id, existingBooking.id), ne(bookings.status, 'confirmed')))
          .returning({ id: bookings.id });

        if (updated.length === 0) return false;

        // Mark hold as converted
        await tx
          .update(temporaryHolds)
          .set({
            status: 'converted_to_booking',
          })
          .where(eq(temporaryHolds.id, holdId));

        // Update payment record
        await tx
          .update(payments)
          .set({
            status: 'succeeded',
            updated_at: now,
          })
          .where(eq(payments.stripe_payment_id, session.id));

        return true;
      });

      if (!didConfirm) {
        await logWebhook(session.id, 'success', 'Booking already confirmed by a concurrent delivery (idempotent)', {
          bookingId: existingBooking.id,
        });
        return NextResponse.json({
          received: true,
          status: 'already_processed',
          bookingId: existingBooking.id,
        });
      }

      await logWebhook(session.id, 'success', 'Booking confirmed from webhook', {
        bookingId: existingBooking.id,
        bookingIdString: existingBooking.booking_id,
        holdId,
      });

      // Email + owner notification + calendar event. Best-effort: a
      // failure here is logged but never reverses the confirmed booking.
      const confirmedService = await db.query.services.findFirst({
        where: eq(services.id, existingBooking.service_id),
      });
      if (confirmedService) {
        const confirmedBooking = await db.query.bookings.findFirst({
          where: eq(bookings.id, existingBooking.id),
        });
        if (confirmedBooking) {
          await runPostConfirmationSideEffects(confirmedBooking, confirmedService).catch((err) =>
            console.error('Post-confirmation side effects failed:', err)
          );
        }
      }

      return NextResponse.json({
        received: true,
        status: 'booking_confirmed',
        bookingId: existingBooking.id,
        bookingIdString: existingBooking.booking_id,
      });
    } catch (err: any) {
      await logWebhook(session.id, 'failed', `Transaction failed: ${err.message}`, {
        holdId,
        error: err.message,
      });

      console.error('Error creating booking from webhook:', err);
      return NextResponse.json(
        { error: 'Failed to create booking' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error handling checkout.session.completed:', error);

    await logWebhook(null, 'failed', `Checkout handling error: ${error.message}`);

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function handleChargeSucceeded(charge: Stripe.Charge) {
  // Update payment record if needed
  try {
    const paymentId = charge.payment_intent as string;

    if (paymentId) {
      const now = new Date();
      await db
        .update(payments)
        .set({
          status: 'succeeded',
          updated_at: now,
        })
        .where(eq(payments.stripe_payment_id, paymentId));
    }

    await logWebhook(charge.id, 'success', 'Charge succeeded', {
      amount: charge.amount,
      currency: charge.currency,
    });

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Error handling charge.succeeded:', error);
    await logWebhook(null, 'failed', `Charge handling error: ${error.message}`);
    return NextResponse.json({ received: true }); // Still return 200 to acknowledge
  }
}

async function logWebhook(
  sessionId: string | null,
  status: 'success' | 'failed',
  message: string,
  data?: any
) {
  try {
    await db.insert(integrationLogs).values({
      integration_type: 'stripe',
      booking_id: null,
      status: status,
      error_message: status === 'failed' ? message : null,
      response_data: {
        sessionId,
        message,
        ...data,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Error logging webhook:', err);
  }
}
