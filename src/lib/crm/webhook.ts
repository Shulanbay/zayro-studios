import type Stripe from 'stripe';
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookings, payments, purchases, services, temporaryHolds, webhookEvents } from '@/lib/db/schema';
import type { Booking, Purchase } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/types';
import { pgErrorCode } from '@/lib/db/types';
import { checkTimeSlotConflict, lockStudioDates } from '@/lib/availability';
import { toDateOnly } from '@/lib/utils';
import { runPostConfirmationSideEffects } from '@/lib/postConfirmation';
import { logIntegration } from '@/lib/integrationSync';
import { sendOwnerPaymentReviewEmail } from '@/lib/email';
import { writeAudit } from './audit';
import { createPurchase, orderNumberForBooking, recomputeRefundState } from './purchases';
import { refreshCustomerStats } from './customers';
import { decimalToCents } from './money';
import { getStripe, resyncSheetsForPurchase, upsertRefundFromStripe } from './refunds';

/**
 * Stripe webhook processing with database-backed idempotency.
 *
 * Every event is recorded once in webhook_events (unique provider + event
 * id) and *claimed* before processing, so a duplicate or concurrent
 * delivery can't run the handler twice. A handler failure marks the event
 * failed and returns 500 so Stripe retries; an admin can also re-run a
 * failed event from Integrations (re-fetched from Stripe).
 *
 * Only a minimal, non-personal summary of each event is stored.
 */

export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
  'charge.refunded',
  'refund.updated',
  'refund.created',
] as const;

export type WebhookOutcome = { httpStatus: number; body: Record<string, unknown> };

/** A processing attempt older than this is considered crashed and may be retried. */
const STALE_LOCK = sql`now() - interval '5 minutes'`;

export function safeEventSummary(event: Stripe.Event): Record<string, unknown> {
  const obj = event.data.object as unknown as Record<string, any>;
  const metadata = (obj?.metadata ?? {}) as Record<string, string>;
  return {
    type: event.type,
    livemode: event.livemode,
    objectType: obj?.object ?? null,
    objectId: obj?.id ?? null,
    status: obj?.status ?? null,
    paymentStatus: obj?.payment_status ?? null,
    amount: obj?.amount_total ?? obj?.amount ?? null,
    amountRefunded: obj?.amount_refunded ?? null,
    currency: obj?.currency ?? null,
    paymentIntent: typeof obj?.payment_intent === 'string' ? obj.payment_intent : obj?.payment_intent?.id ?? null,
    bookingId: metadata.bookingId ?? null,
    holdId: metadata.holdId ?? null,
    refundId: metadata.refundId ?? null,
  };
}

/** Entry point from the route (after signature verification) and from admin retries. */
export async function processStripeEvent(event: Stripe.Event): Promise<WebhookOutcome> {
  await db
    .insert(webhookEvents)
    .values({ provider: 'stripe', external_event_id: event.id, event_type: event.type, status: 'received', safe_payload: safeEventSummary(event) })
    .onConflictDoNothing();

  const claimed = await db
    .update(webhookEvents)
    .set({ status: 'processing', attempts: sql`${webhookEvents.attempts} + 1`, locked_at: new Date(), error: null })
    .where(
      and(
        eq(webhookEvents.provider, 'stripe'),
        eq(webhookEvents.external_event_id, event.id),
        or(
          inArray(webhookEvents.status, ['received', 'failed']),
          and(eq(webhookEvents.status, 'processing'), lt(webhookEvents.locked_at, STALE_LOCK))
        )
      )
    )
    .returning({ id: webhookEvents.id });

  if (claimed.length === 0) {
    const existing = await db.query.webhookEvents.findFirst({
      where: and(eq(webhookEvents.provider, 'stripe'), eq(webhookEvents.external_event_id, event.id)),
    });
    if (existing?.status === 'processed') {
      return { httpStatus: 200, body: { received: true, duplicate: true } };
    }
    // Another delivery is working on it right now; let Stripe retry later.
    return { httpStatus: 409, body: { error: 'Event is being processed' } };
  }

  const eventRowId = claimed[0].id;
  try {
    const result = await dispatch(event);
    await db
      .update(webhookEvents)
      .set({ status: 'processed', processed_at: new Date(), locked_at: null, safe_payload: { ...safeEventSummary(event), result: result.status } })
      .where(eq(webhookEvents.id, eventRowId));
    return { httpStatus: 200, body: { received: true, ...result } };
  } catch (error) {
    const message = ((error as Error)?.message || String(error)).slice(0, 500);
    await db.update(webhookEvents).set({ status: 'failed', error: message, locked_at: null }).where(eq(webhookEvents.id, eventRowId));
    console.error(`[stripe-webhook] ${event.type} ${event.id} failed: ${message}`);
    return { httpStatus: 500, body: { error: 'Processing failed; Stripe will retry' } };
  }
}

type Result = { status: string; bookingId?: string };

async function dispatch(event: Stripe.Event): Promise<Result> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      // Delayed payment methods complete Checkout before the money arrives.
      if (session.payment_status === 'unpaid') return { status: 'awaiting_async_payment' };
      return confirmPaidSession(session);
    }
    case 'checkout.session.async_payment_succeeded':
      return confirmPaidSession(event.data.object as Stripe.Checkout.Session);
    case 'checkout.session.async_payment_failed':
      return releaseUnpaidSession(event.data.object as Stripe.Checkout.Session, 'failed', 'Payment failed');
    case 'checkout.session.expired':
      return releaseUnpaidSession(event.data.object as Stripe.Checkout.Session, 'cancelled', 'Checkout expired without payment');
    case 'payment_intent.payment_failed':
      return recordPaymentAttemptFailed(event.data.object as Stripe.PaymentIntent);
    case 'charge.refunded':
      return syncChargeRefunds(event.data.object as Stripe.Charge);
    case 'refund.created':
    case 'refund.updated':
      return syncRefund(event.data.object as Stripe.Refund);
    default:
      return { status: 'ignored' };
  }
}

// ---------------------------------------------------------------------------
// Checkout → booking confirmation
// ---------------------------------------------------------------------------

async function findSessionBooking(exec: Executor, session: Stripe.Checkout.Session): Promise<Booking | undefined> {
  const bySession = await exec.query.bookings.findFirst({ where: eq(bookings.stripe_session_id, session.id) });
  if (bySession) return bySession;
  const id = session.metadata?.bookingId;
  return id ? exec.query.bookings.findFirst({ where: eq(bookings.id, id) }) : undefined;
}

/** Bookings created by pre-CRM code during a deploy have no purchase yet. */
async function ensurePurchase(tx: Executor, booking: Booking): Promise<Purchase> {
  if (booking.purchase_id) {
    const existing = await tx.query.purchases.findFirst({ where: eq(purchases.id, booking.purchase_id) });
    if (existing) return existing;
  }
  const byNumber = await tx.query.purchases.findFirst({ where: eq(purchases.order_number, orderNumberForBooking(booking.booking_id)) });
  const service = await tx.query.services.findFirst({ where: eq(services.id, booking.service_id) });
  const purchase =
    byNumber ??
    (await createPurchase(tx, {
      orderNumber: orderNumberForBooking(booking.booking_id),
      customerId: booking.customer_id,
      type: service?.category === 'tour' ? 'studio_tour' : 'individual',
      status: 'pending',
      taxCents: decimalToCents(booking.tax_amount),
      paymentMethod: 'stripe',
      stripeCheckoutSessionId: booking.stripe_session_id,
      items: [
        {
          itemType: 'service',
          referenceId: booking.service_id,
          description: `${service?.name ?? 'Studio session'} — ${toDateOnly(booking.booking_date)} ${booking.start_time}–${booking.end_time} ET`,
          unitPriceCents: decimalToCents(booking.subtotal),
          metadata: { bookingId: booking.booking_id, createdBy: 'webhook' },
        },
      ],
    }));
  await tx.update(bookings).set({ purchase_id: purchase.id }).where(eq(bookings.id, booking.id));
  return purchase;
}

async function confirmPaidSession(session: Stripe.Checkout.Session): Promise<Result> {
  const booking = await findSessionBooking(db, session);
  if (!booking) throw new Error(`No booking for Checkout session ${session.id}`);

  // The amount must match the price this booking was created with — never
  // the service's current price, which an admin may have changed since.
  const expected = decimalToCents(booking.total_amount);
  if ((session.amount_total ?? -1) !== expected || session.currency?.toLowerCase() !== 'usd') {
    await flagForReview(booking, session, `Paid amount ${session.amount_total} ${session.currency} does not match the booking total ${expected} usd`);
    return { status: 'amount_mismatch_needs_review', bookingId: booking.id };
  }

  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  const holdId = session.metadata?.holdId ?? null;
  const date = toDateOnly(booking.booking_date);

  const outcome = await db
    .transaction(async (tx) => {
      await lockStudioDates(tx, [date]);
      const fresh = await tx.query.bookings.findFirst({ where: eq(bookings.id, booking.id) });
      if (!fresh) throw new Error('Booking vanished');
      const purchase = await ensurePurchase(tx, fresh);
      const now = new Date();

      const recordPayment = async (purchaseReview: string | null) => {
        await tx
          .update(purchases)
          .set({
            status: purchase.status === 'pending' || purchase.status === 'cancelled' || purchase.status === 'failed' ? 'paid' : purchase.status,
            stripe_payment_intent_id: paymentIntent,
            stripe_checkout_session_id: session.id,
            purchased_at: purchase.purchased_at ?? now,
            ...(purchaseReview ? { needs_refund_review: true, review_reason: purchaseReview } : {}),
            updated_at: now,
          })
          .where(eq(purchases.id, purchase.id));
        await tx.update(payments).set({ status: 'succeeded', updated_at: now }).where(eq(payments.stripe_payment_id, session.id));
      };

      if (fresh.status === 'confirmed' && fresh.payment_status === 'succeeded') {
        return { kind: 'already' as const, booking: fresh, purchase };
      }

      if (fresh.status !== 'pending' && fresh.status !== 'payment_pending') {
        // Paid after the booking was cancelled (e.g. an old Checkout tab): keep
        // the money on record, don't resurrect the booking or its slot.
        const reason = `Payment received for a ${fresh.status} booking — refund or rebook`;
        await tx
          .update(bookings)
          .set({ payment_status: 'succeeded', stripe_payment_id: paymentIntent, needs_refund_review: true, review_reason: reason, updated_at: now })
          .where(eq(bookings.id, fresh.id));
        await recordPayment(reason);
        return { kind: 'review' as const, booking: fresh, purchase, reason };
      }

      // Our hold (15 min) is shorter than a Checkout session (≥ 30 min), so
      // re-check the slot: another booking, a hold or blocked time may have
      // taken it since. Our own hold doesn't count.
      const clash = await checkTimeSlotConflict(date, fresh.start_time, fresh.end_time, tx, {
        excludeBookingId: fresh.id,
        excludeHoldId: holdId ?? undefined,
      });
      if (clash) {
        const reason = 'Slot was taken before this payment arrived — refund or rebook';
        await tx
          .update(bookings)
          .set({
            status: 'cancelled',
            cancelled_at: now,
            cancellation_reason: reason,
            payment_status: 'succeeded',
            stripe_payment_id: paymentIntent,
            needs_refund_review: true,
            review_reason: reason,
            updated_at: now,
          })
          .where(eq(bookings.id, fresh.id));
        await recordPayment(reason);
        return { kind: 'review' as const, booking: fresh, purchase, reason };
      }

      const [confirmed] = await tx
        .update(bookings)
        .set({ status: 'confirmed', payment_status: 'succeeded', stripe_payment_id: paymentIntent, updated_at: now })
        .where(and(eq(bookings.id, fresh.id), inArray(bookings.status, ['pending', 'payment_pending'])))
        .returning();
      if (holdId) {
        await tx.update(temporaryHolds).set({ status: 'converted_to_booking' }).where(eq(temporaryHolds.id, holdId));
      }
      await recordPayment(null);
      await refreshCustomerStats(tx, confirmed.customer_id);
      await writeAudit(
        { actor: { email: 'stripe-webhook' }, operation: 'booking.confirm_paid', entityType: 'booking', entityId: confirmed.id, after: { paymentIntent, amountCents: expected } },
        tx
      );
      return { kind: 'confirmed' as const, booking: confirmed, purchase };
    })
    .catch(async (error) => {
      // The exclusion constraint caught an overlap the checks above missed.
      if (pgErrorCode(error) !== '23P01') throw error;
      const reason = 'Slot overlaps a confirmed booking — refund or rebook';
      await flagForReview(booking, session, reason, true);
      return { kind: 'flagged' as const };
    });

  if (outcome.kind === 'flagged') return { status: 'conflict_needs_review', bookingId: booking.id };

  if (outcome.kind === 'review') {
    await logIntegration('stripe', booking.id, 'failed', outcome.reason, { sessionId: session.id });
    const fresh = (await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) })) ?? booking;
    await sendOwnerPaymentReviewEmail({ booking: fresh, orderNumber: outcome.purchase.order_number, amountCents: expected, reason: outcome.reason });
    return { status: 'needs_review', bookingId: booking.id };
  }

  if (outcome.kind === 'already') return { status: 'already_processed', bookingId: booking.id };

  await logIntegration('stripe', booking.id, 'success', 'Booking confirmed from webhook', { sessionId: session.id });
  const service = await db.query.services.findFirst({ where: eq(services.id, outcome.booking.service_id) });
  if (service) {
    await runPostConfirmationSideEffects(outcome.booking, service).catch((err) =>
      console.error('Post-confirmation side effects failed:', (err as Error)?.message || err)
    );
  }
  return { status: 'booking_confirmed', bookingId: booking.id };
}

/** Records a payment that can't confirm its booking, outside the failed transaction. */
async function flagForReview(booking: Booking, session: Stripe.Checkout.Session, reason: string, cancel = false) {
  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  await db.transaction(async (tx) => {
    const fresh = (await tx.query.bookings.findFirst({ where: eq(bookings.id, booking.id) })) ?? booking;
    const purchase = await ensurePurchase(tx, fresh);
    const now = new Date();
    await tx
      .update(bookings)
      .set({
        ...(cancel && (fresh.status === 'pending' || fresh.status === 'payment_pending')
          ? { status: 'cancelled' as const, cancelled_at: now, cancellation_reason: reason }
          : {}),
        payment_status: 'succeeded',
        stripe_payment_id: paymentIntent,
        needs_refund_review: true,
        review_reason: reason,
        updated_at: now,
      })
      .where(eq(bookings.id, fresh.id));
    await tx
      .update(purchases)
      .set({
        status: ['pending', 'cancelled', 'failed'].includes(purchase.status) ? 'paid' : purchase.status,
        stripe_payment_intent_id: paymentIntent,
        purchased_at: purchase.purchased_at ?? now,
        needs_refund_review: true,
        review_reason: reason,
        updated_at: now,
      })
      .where(eq(purchases.id, purchase.id));
    await tx.update(payments).set({ status: 'succeeded', updated_at: now }).where(eq(payments.stripe_payment_id, session.id));
    await writeAudit({ actor: { email: 'stripe-webhook' }, operation: 'payment.needs_review', entityType: 'booking', entityId: fresh.id, metadata: { reason } }, tx);
  });
  await logIntegration('stripe', booking.id, 'failed', reason, { sessionId: session.id });
  const fresh = (await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) })) ?? booking;
  const purchase = fresh.purchase_id ? await db.query.purchases.findFirst({ where: eq(purchases.id, fresh.purchase_id) }) : null;
  await sendOwnerPaymentReviewEmail({ booking: fresh, orderNumber: purchase?.order_number ?? '', amountCents: session.amount_total ?? 0, reason });
}

/** Async payment failed / Checkout expired: release the unpaid booking. */
async function releaseUnpaidSession(session: Stripe.Checkout.Session, purchaseStatus: 'failed' | 'cancelled', reason: string): Promise<Result> {
  const booking = await findSessionBooking(db, session);
  if (!booking) return { status: 'no_booking' };
  const released = await db.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(bookings)
      .set({
        status: 'cancelled',
        cancelled_at: now,
        cancellation_reason: reason,
        payment_status: purchaseStatus === 'failed' ? 'failed' : 'pending',
        updated_at: now,
      })
      .where(and(eq(bookings.id, booking.id), inArray(bookings.status, ['pending', 'payment_pending'])))
      .returning();
    if (!updated) return false;
    if (updated.purchase_id) {
      await tx
        .update(purchases)
        .set({ status: purchaseStatus, updated_at: now })
        .where(and(eq(purchases.id, updated.purchase_id), eq(purchases.status, 'pending')));
    }
    await tx.update(payments).set({ status: 'failed', updated_at: now }).where(and(eq(payments.stripe_payment_id, session.id), eq(payments.status, 'pending')));
    const holdId = session.metadata?.holdId;
    if (holdId) {
      await tx.update(temporaryHolds).set({ status: 'cancelled' }).where(and(eq(temporaryHolds.id, holdId), eq(temporaryHolds.status, 'active')));
    }
    return true;
  });
  await logIntegration('stripe', booking.id, released ? 'success' : 'failed', released ? reason : `${reason}; booking was already ${booking.status}`, {
    sessionId: session.id,
  });
  return { status: released ? 'released' : 'unchanged', bookingId: booking.id };
}

async function recordPaymentAttemptFailed(intent: Stripe.PaymentIntent): Promise<Result> {
  const bookingId = intent.metadata?.bookingId;
  const booking = bookingId ? await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) }) : undefined;
  if (!booking) return { status: 'no_booking' };
  // The customer can still retry inside the same Checkout session, so the
  // booking stays payment_pending; the attempt is recorded for staff.
  const message = `Card payment attempt failed: ${intent.last_payment_error?.code ?? intent.last_payment_error?.decline_code ?? 'declined'}`;
  await logIntegration('stripe', booking.id, 'failed', message, { paymentIntent: intent.id });
  return { status: 'attempt_failed_recorded', bookingId: booking.id };
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

async function syncChargeRefunds(charge: Stripe.Charge): Promise<Result> {
  let list = charge.refunds?.data;
  if (!list) {
    const stripe = getStripe();
    list = stripe ? (await stripe.refunds.list({ charge: charge.id, limit: 100 })).data : [];
  }
  const purchaseIds = new Set<string>();
  await db.transaction(async (tx) => {
    for (const refund of list ?? []) {
      const r = await upsertRefundFromStripe(tx, refund);
      if (r.purchaseId) purchaseIds.add(r.purchaseId);
    }
    for (const id of Array.from(purchaseIds)) await recomputeRefundState(tx, id);
  });
  for (const id of Array.from(purchaseIds)) await resyncSheetsForPurchase(id);
  return { status: purchaseIds.size ? 'refunds_synced' : 'no_matching_purchase' };
}

async function syncRefund(refund: Stripe.Refund): Promise<Result> {
  let purchaseId: string | null = null;
  await db.transaction(async (tx) => {
    const r = await upsertRefundFromStripe(tx, refund);
    purchaseId = r.purchaseId;
    if (purchaseId) await recomputeRefundState(tx, purchaseId);
  });
  if (purchaseId) await resyncSheetsForPurchase(purchaseId);
  return { status: purchaseId ? 'refund_synced' : 'no_matching_purchase' };
}

/** Admin retry of a failed event: re-fetch it from Stripe and run it again. */
export async function retryWebhookEvent(externalEventId: string): Promise<WebhookOutcome> {
  const stripe = getStripe();
  if (!stripe) return { httpStatus: 503, body: { error: 'STRIPE_SECRET_KEY is not configured' } };
  const row = await db.query.webhookEvents.findFirst({
    where: and(eq(webhookEvents.provider, 'stripe'), eq(webhookEvents.external_event_id, externalEventId)),
  });
  if (!row) return { httpStatus: 404, body: { error: 'Event not found' } };
  if (row.status === 'processed') return { httpStatus: 409, body: { error: 'Event was already processed' } };
  const event = await stripe.events.retrieve(externalEventId);
  return processStripeEvent(event);
}
