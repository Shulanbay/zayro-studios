import Stripe from 'stripe';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookings, purchases, refunds, services } from '@/lib/db/schema';
import type { Refund } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/types';
import { cancelBooking } from '@/lib/cancelBooking';
import { syncSheetsForBooking, logIntegration } from '@/lib/integrationSync';
import { sendRefundEmail } from '@/lib/email';
import { writeAudit, type AuditActor } from './audit';
import { CrmError, conflict, notFound } from './errors';
import { recomputeRefundState } from './purchases';

/**
 * Refunds. The refund row is committed (status pending) *before* Stripe is
 * called, and its id is the Stripe idempotency key — so a double click, a
 * retry or a crash between the two can never refund twice. The refund
 * webhooks reconcile the same row (matched by metadata.refundId or the
 * Stripe refund id). Purchase totals are always re-derived from succeeded
 * refunds.
 */

let stripeClient: Stripe | null = null;
export function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

export function mapStripeRefundStatus(status: string | null | undefined): Refund['status'] {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    case 'requires_action':
      return 'requires_action';
    default:
      return 'pending';
  }
}

/** Amount still refundable: total minus succeeded and in-flight refunds. */
export async function refundableCents(exec: Executor, purchaseId: string): Promise<{ total: number; refunded: number; inFlight: number; available: number }> {
  const purchase = await exec.query.purchases.findFirst({ where: eq(purchases.id, purchaseId) });
  if (!purchase) throw notFound('Purchase');
  const [row] = await exec
    .select({
      succeeded: sql<number>`coalesce(sum(${refunds.amount_cents}) filter (where ${refunds.status} = 'succeeded'), 0)::int`,
      inFlight: sql<number>`coalesce(sum(${refunds.amount_cents}) filter (where ${refunds.status} in ('pending', 'requires_action')), 0)::int`,
    })
    .from(refunds)
    .where(eq(refunds.purchase_id, purchaseId));
  const refunded = Number(row?.succeeded ?? 0);
  const inFlight = Number(row?.inFlight ?? 0);
  return { total: purchase.total_cents, refunded, inFlight, available: Math.max(0, purchase.total_cents - refunded - inFlight) };
}

export interface RefundRequest {
  purchaseId: string;
  amountCents: number;
  reason: string;
  bookingId?: string | null;
  /** What the admin saw as refundable; a mismatch means the page is stale. */
  expectedAvailableCents: number;
  cancelBooking?: boolean;
  notifyCustomer?: boolean;
}

export async function issueRefund(req: RefundRequest, actor: AuditActor) {
  if (!Number.isInteger(req.amountCents) || req.amountCents <= 0) throw new CrmError('Refund amount must be more than $0.00');
  if (!req.reason.trim()) throw new CrmError('A refund reason is required');

  // 1. Validate and record the refund intent under a row lock.
  const refund = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM purchases WHERE id = ${req.purchaseId} FOR UPDATE`);
    const purchase = await tx.query.purchases.findFirst({ where: eq(purchases.id, req.purchaseId) });
    if (!purchase) throw notFound('Purchase');
    if (!['paid', 'partially_refunded'].includes(purchase.status)) {
      throw new CrmError(`A ${purchase.status} purchase can't be refunded`, 409);
    }
    if (purchase.payment_method === 'stripe' && !purchase.stripe_payment_intent_id) {
      throw new CrmError('This purchase has no Stripe payment to refund', 409);
    }
    const { available } = await refundableCents(tx, purchase.id);
    if (available !== req.expectedAvailableCents) {
      throw conflict('The refundable amount changed since you opened this dialog; reload and try again');
    }
    if (req.amountCents > available) throw new CrmError('That is more than the refundable amount');

    let bookingId = req.bookingId ?? null;
    if (bookingId) {
      const b = await tx.query.bookings.findFirst({ where: and(eq(bookings.id, bookingId), eq(bookings.purchase_id, purchase.id)) });
      if (!b) throw new CrmError('That booking does not belong to this purchase');
    } else {
      const linked = await tx.query.bookings.findFirst({ where: eq(bookings.purchase_id, purchase.id) });
      bookingId = linked?.id ?? null;
    }

    const manual = purchase.payment_method !== 'stripe';
    const [row] = await tx
      .insert(refunds)
      .values({
        purchase_id: purchase.id,
        booking_id: bookingId,
        amount_cents: req.amountCents,
        status: manual ? 'succeeded' : 'pending',
        reason: req.reason.trim().slice(0, 1000),
        requested_by: actor.email ?? null,
        requested_by_admin_id: actor.id ?? null,
        source: 'admin',
      })
      .returning();
    if (manual) await recomputeRefundState(tx, purchase.id);
    await writeAudit(
      {
        actor,
        operation: 'refund.request',
        entityType: 'purchase',
        entityId: purchase.id,
        after: { refundId: row.id, amountCents: req.amountCents, reason: row.reason, method: purchase.payment_method },
        metadata: { availableBefore: available, orderNumber: purchase.order_number },
      },
      tx
    );
    return { row, purchase, manual };
  });

  // 2. Stripe (outside the transaction; idempotent on the refund id).
  let final: Refund = refund.row;
  if (!refund.manual) {
    const stripe = getStripe();
    let update: Partial<Refund>;
    if (!stripe) {
      update = { status: 'failed', failure_reason: 'STRIPE_SECRET_KEY is not configured' };
    } else {
      try {
        const created = await stripe.refunds.create(
          {
            payment_intent: refund.purchase.stripe_payment_intent_id!,
            amount: req.amountCents,
            reason: 'requested_by_customer',
            metadata: { refundId: refund.row.id, purchaseId: refund.purchase.id, bookingId: refund.row.booking_id ?? '' },
          },
          { idempotencyKey: `zayro-refund-${refund.row.id}` }
        );
        update = { stripe_refund_id: created.id, status: mapStripeRefundStatus(created.status), failure_reason: created.failure_reason ?? null };
      } catch (error) {
        update = { status: 'failed', failure_reason: ((error as Error)?.message || 'Stripe refund failed').slice(0, 500) };
      }
    }
    final = await db.transaction(async (tx) => {
      const [row] = await tx.update(refunds).set({ ...update, updated_at: new Date() }).where(eq(refunds.id, refund.row.id)).returning();
      await recomputeRefundState(tx, refund.purchase.id);
      return row;
    });
  }

  await writeAudit({
    actor,
    operation: 'refund.result',
    entityType: 'refund',
    entityId: final.id,
    outcome: final.status === 'failed' ? 'failed' : 'success',
    after: { status: final.status, stripeRefundId: final.stripe_refund_id, failure: final.failure_reason },
  });

  // 3. Follow-ups; none of them can undo the refund.
  if (final.status === 'succeeded' || final.status === 'pending') {
    await clearReviewFlags(refund.purchase.id);
  }
  let cancellation: Awaited<ReturnType<typeof cancelBooking>> | null = null;
  if (req.cancelBooking && final.booking_id && final.status !== 'failed') {
    cancellation = await cancelBooking(final.booking_id, actor, { reason: `Refunded: ${req.reason}`, notifyCustomer: false });
  }
  await resyncSheetsForPurchase(refund.purchase.id);
  let email: { sent: boolean; status: string; error?: string } | null = null;
  if (req.notifyCustomer && final.status !== 'failed') {
    email = await sendRefundEmail(final.id);
    if (final.booking_id) {
      await logIntegration('email', final.booking_id, email.sent ? 'success' : 'failed', email.sent ? 'Refund email sent' : `Refund email ${email.status}`);
    }
  }
  return { refund: final, cancellation, email };
}

async function clearReviewFlags(purchaseId: string) {
  await db.update(purchases).set({ needs_refund_review: false, review_reason: null, updated_at: new Date() }).where(eq(purchases.id, purchaseId));
  await db.update(bookings).set({ needs_refund_review: false, review_reason: null, updated_at: new Date() }).where(eq(bookings.purchase_id, purchaseId));
}

/** Staff decided no refund is due (e.g. late cancellation): clear the review flag. */
export async function resolveRefundReview(purchaseId: string, note: string, actor: AuditActor) {
  if (!note.trim()) throw new CrmError('Say why no refund is needed');
  const purchase = await db.query.purchases.findFirst({ where: eq(purchases.id, purchaseId) });
  if (!purchase) throw notFound('Purchase');
  await clearReviewFlags(purchaseId);
  await writeAudit({
    actor,
    operation: 'refund.review_resolved',
    entityType: 'purchase',
    entityId: purchaseId,
    before: { needsRefundReview: purchase.needs_refund_review, reason: purchase.review_reason },
    after: { needsRefundReview: false },
    metadata: { note: note.trim().slice(0, 1000) },
  });
}

export async function resyncSheetsForPurchase(purchaseId: string) {
  const linked = await db.query.bookings.findMany({ where: eq(bookings.purchase_id, purchaseId) });
  for (const b of linked) {
    if (!b.google_sheets_row_id) continue;
    const service = await db.query.services.findFirst({ where: eq(services.id, b.service_id) });
    if (service) await syncSheetsForBooking(b, service);
  }
}

/**
 * Webhook side: create or update our refund row from a Stripe Refund.
 * Matches our own row by metadata.refundId (set when we created it), then
 * by Stripe id; a refund made in the Stripe Dashboard gets a new row.
 */
export async function upsertRefundFromStripe(tx: Executor, refund: Stripe.Refund): Promise<{ purchaseId: string | null; created: boolean }> {
  const status = mapStripeRefundStatus(refund.status);
  const ourId = typeof refund.metadata?.refundId === 'string' ? refund.metadata.refundId : null;

  let row = ourId ? await tx.query.refunds.findFirst({ where: eq(refunds.id, ourId) }) : undefined;
  if (!row) row = await tx.query.refunds.findFirst({ where: eq(refunds.stripe_refund_id, refund.id) });

  if (row) {
    await tx
      .update(refunds)
      .set({ stripe_refund_id: refund.id, status, failure_reason: refund.failure_reason ?? null, updated_at: new Date() })
      .where(eq(refunds.id, row.id));
    return { purchaseId: row.purchase_id, created: false };
  }

  const paymentIntent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
  if (!paymentIntent) return { purchaseId: null, created: false };
  const purchase = await tx.query.purchases.findFirst({ where: eq(purchases.stripe_payment_intent_id, paymentIntent) });
  if (!purchase) return { purchaseId: null, created: false };
  const booking = await tx.query.bookings.findFirst({ where: eq(bookings.purchase_id, purchase.id) });

  const inserted = await tx
    .insert(refunds)
    .values({
      purchase_id: purchase.id,
      booking_id: booking?.id ?? null,
      stripe_refund_id: refund.id,
      amount_cents: refund.amount,
      status,
      reason: refund.reason ? `Stripe: ${refund.reason}` : 'Refunded in the Stripe Dashboard',
      requested_by: 'stripe',
      source: 'stripe',
      failure_reason: refund.failure_reason ?? null,
    })
    .onConflictDoNothing({ target: refunds.stripe_refund_id })
    .returning({ id: refunds.id });
  return { purchaseId: purchase.id, created: inserted.length > 0 };
}

