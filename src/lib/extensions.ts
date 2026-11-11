import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { bookingExtensions, purchases, temporaryHolds } from './db/schema';
import type { BookingExtension } from './db/schema';
import type { Executor } from './db/types';
import Stripe from 'stripe';

// Own client (like cancelBooking.ts) so this module has no import cycle with crm/refunds.
let stripeClient: Stripe | null = null;
function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

/**
 * Unpaid extra-time checkouts. Shared by Manage Booking and by every path
 * that moves or cancels a booking, so an old extension Checkout can never be
 * paid for a booking that has since changed, and its hold never keeps
 * blocking time the booking no longer needs.
 */

/** Marks an unpaid extension (and its purchase and hold) as given up. Conditional, so it never touches a paid one. */
export async function abandonExtension(tx: Executor, ext: BookingExtension, status: 'cancelled' | 'failed') {
  const now = new Date();
  await tx.update(bookingExtensions).set({ status, updated_at: now }).where(and(eq(bookingExtensions.id, ext.id), eq(bookingExtensions.status, 'pending')));
  await tx.update(purchases).set({ status, updated_at: now }).where(and(eq(purchases.id, ext.purchase_id), eq(purchases.status, 'pending')));
  if (ext.hold_id) {
    await tx.update(temporaryHolds).set({ status: 'cancelled' }).where(and(eq(temporaryHolds.id, ext.hold_id), eq(temporaryHolds.status, 'active')));
  }
}

/**
 * After a booking is cancelled or moved: expire every open extra-time
 * Checkout for it and release its hold. A session Stripe reports as already
 * paid is left alone (the webhook records it and flags it for a refund).
 * Never throws; returns how many were released.
 */
export async function releasePendingExtensions(bookingUuid: string): Promise<number> {
  try {
    const pending = await db.query.bookingExtensions.findMany({ where: and(eq(bookingExtensions.booking_id, bookingUuid), eq(bookingExtensions.status, 'pending')) });
    if (pending.length === 0) return 0;
    const stripe = getStripe();
    let released = 0;
    for (const ext of pending) {
      if (ext.stripe_checkout_session_id) {
        if (!stripe) continue; // Can't confirm the session is unpaid; leave it to the expiry webhook.
        const session = await stripe.checkout.sessions.retrieve(ext.stripe_checkout_session_id).catch(() => null);
        if (!session || session.status === 'complete') continue;
        if (session.status === 'open') {
          const expired = await stripe.checkout.sessions.expire(session.id).catch(() => null);
          if (!expired || expired.status === 'complete') continue;
        }
      }
      await db.transaction((tx) => abandonExtension(tx, ext, 'cancelled'));
      released++;
    }
    return released;
  } catch (error) {
    console.error('[extensions] could not release pending extensions:', (error as Error)?.message || error);
    return 0;
  }
}
