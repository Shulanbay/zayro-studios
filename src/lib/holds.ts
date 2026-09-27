import type Stripe from 'stripe';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { bookings, payments, temporaryHolds } from './db/schema';
import type { Booking, TemporaryHold } from './db/schema';
import type { Executor } from './db/types';
import { getStripe } from './crm/refunds';
import { releaseUnpaidSession } from './crm/webhook';

/**
 * Temporary-hold lifecycle shared by the public booking routes.
 *
 *  - A hold is created for one customer email, one service and one slot.
 *  - Starting Checkout stretches the hold to the Checkout session's own
 *    expiry, so the slot stays blocked for exactly as long as the customer
 *    can still pay (Stripe sessions live ≥ 30 minutes).
 *  - A hold has at most one open Checkout session; asking again reuses it.
 *  - Leaving Checkout ("back" / cancel page) or picking another time
 *    releases the hold: its open session is expired in Stripe first, so an
 *    old tab can't pay for a slot that was given back.
 */

export const HOLD_MINUTES = Math.max(5, parseInt(process.env.TEMPORARY_HOLD_DURATION_MINUTES || '15', 10) || 15);

/** Serialises everything that acts on one hold (transaction scoped). */
export async function lockHold(tx: Executor, holdId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`hold:${holdId}`}))`);
}

export function holdIsUsable(hold: Pick<TemporaryHold, 'status' | 'hold_expires_at'>, now = new Date()) {
  return hold.status === 'active' && new Date(hold.hold_expires_at).getTime() > now.getTime();
}

/** Unpaid Checkout bookings started from this hold (normally zero or one). */
export async function pendingCheckoutsForHold(exec: Executor, holdId: string): Promise<Booking[]> {
  const rows = await exec
    .select({ bookingId: payments.booking_id })
    .from(payments)
    .where(and(eq(payments.status, 'pending'), sql`${payments.metadata}->>'holdId' = ${holdId}`));
  if (rows.length === 0) return [];
  return exec.query.bookings.findMany({
    where: and(
      inArray(
        bookings.id,
        rows.map((r) => r.bookingId)
      ),
      inArray(bookings.status, ['pending', 'payment_pending'])
    ),
  });
}

export type ReleaseResult =
  | { released: true }
  | { released: false; reason: 'not_found' | 'not_active' | 'paid' | 'stripe_unavailable'; status?: string };

/**
 * Gives a hold back: expires its open Checkout session(s) in Stripe,
 * cancels the unpaid booking + purchase they created and frees the slot.
 * If the customer already paid (session complete), nothing is released —
 * the webhook confirms that booking.
 */
export async function releaseHold(holdId: string, reason = 'Checkout cancelled by the customer'): Promise<ReleaseResult> {
  const hold = await db.query.temporaryHolds.findFirst({ where: eq(temporaryHolds.id, holdId) });
  if (!hold) return { released: false, reason: 'not_found' };
  if (hold.status !== 'active') return { released: false, reason: 'not_active', status: hold.status };

  const pending = await pendingCheckoutsForHold(db, holdId);
  if (pending.length > 0) {
    const stripe = getStripe();
    if (!stripe) return { released: false, reason: 'stripe_unavailable' };
    for (const booking of pending) {
      if (!booking.stripe_session_id) continue;
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.expire(booking.stripe_session_id);
      } catch {
        // Already expired or completed — ask Stripe which.
        session = await stripe.checkout.sessions.retrieve(booking.stripe_session_id);
      }
      if (session.status === 'complete') return { released: false, reason: 'paid' };
      await releaseUnpaidSession(session, 'cancelled', reason);
    }
  }

  await db
    .update(temporaryHolds)
    .set({ status: 'cancelled' })
    .where(and(eq(temporaryHolds.id, holdId), eq(temporaryHolds.status, 'active')));
  return { released: true };
}
