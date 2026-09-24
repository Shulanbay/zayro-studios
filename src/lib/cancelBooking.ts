import { and, eq, inArray } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from './db';
import { bookings, services, temporaryHolds } from './db/schema';
import type { Booking } from './db/schema';
import { toDateOnly } from './utils';
import { logIntegration, withBookingLock } from './integrationSync';
import { markCalendarEventCancelled, type CalendarCancelResult } from './googleCalendar';
import { markBookingCancelledInSheet, type SheetsCancelResult } from './googleSheets';

/**
 * Admin cancellation of a single booking.
 *
 * - Only pending / payment_pending / confirmed bookings can be cancelled.
 *   The status flip is a compare-and-set, so two admins clicking at once
 *   can't both "win".
 * - The booking row, its payment row and the Stripe payment are kept; this
 *   never refunds. A paid booking must be refunded in Stripe separately.
 * - An open Stripe Checkout session for an unpaid booking is expired so the
 *   customer can no longer pay for a slot that has been released.
 * - Any active hold for the same slot is released, and because availability
 *   only counts confirmed bookings and active holds, the slot frees up
 *   immediately.
 * - The Calendar event is marked CANCELLED (never deleted) and the sheet row
 *   is updated in place (never removed).
 */

export const CANCELLABLE_STATUSES = ['pending', 'payment_pending', 'confirmed'] as const;

export type CancelBookingResult =
  | {
      ok: true;
      booking: Booking;
      previousStatus: string;
      holdsReleased: number;
      stripeSession: { status: 'expired' | 'not_open' | 'none' | 'failed'; message: string };
      calendar: CalendarCancelResult;
      sheets: SheetsCancelResult;
    }
  | { ok: false; httpStatus: number; error: string };

let stripeClient: Stripe | null = null;
function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

async function expireOpenCheckoutSession(
  sessionId: string
): Promise<{ status: 'expired' | 'not_open' | 'failed'; message: string }> {
  const stripe = getStripe();
  if (!stripe) return { status: 'failed', message: 'STRIPE_SECRET_KEY is not configured' };
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status !== 'open') {
      return { status: 'not_open', message: `Checkout session is ${session.status}; left as is` };
    }
    await stripe.checkout.sessions.expire(sessionId);
    return { status: 'expired', message: 'Open Checkout session expired so it can no longer be paid' };
  } catch (err) {
    return { status: 'failed', message: `Could not expire Checkout session: ${(err as Error)?.message || err}` };
  }
}

export async function cancelBooking(bookingUuid: string, cancelledBy: string): Promise<CancelBookingResult> {
  const before = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingUuid) });
  if (!before) return { ok: false, httpStatus: 404, error: 'Booking not found' };
  if (!(CANCELLABLE_STATUSES as readonly string[]).includes(before.status)) {
    return { ok: false, httpStatus: 409, error: `A ${before.status} booking cannot be cancelled` };
  }

  const txResult = await db.transaction(async (tx) => {
    const updated = await tx
      .update(bookings)
      .set({ status: 'cancelled', updated_at: new Date() })
      .where(and(eq(bookings.id, bookingUuid), inArray(bookings.status, [...CANCELLABLE_STATUSES])))
      .returning();
    if (updated.length === 0) return null;

    const released = await tx
      .update(temporaryHolds)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(temporaryHolds.status, 'active'),
          eq(temporaryHolds.customer_email, before.customer_email),
          eq(temporaryHolds.service_id, before.service_id),
          eq(temporaryHolds.booking_date, toDateOnly(before.booking_date)),
          eq(temporaryHolds.start_time, before.start_time)
        )
      )
      .returning({ id: temporaryHolds.id });

    return { booking: updated[0], holdsReleased: released.length };
  });

  if (!txResult) {
    return { ok: false, httpStatus: 409, error: 'Booking was changed by someone else; reload and try again' };
  }
  const { booking, holdsReleased } = txResult;

  const stripeSession =
    before.stripe_session_id && before.status !== 'confirmed'
      ? await expireOpenCheckoutSession(before.stripe_session_id)
      : { status: 'none' as const, message: 'No unpaid Checkout session to expire' };

  const service = await db.query.services.findFirst({ where: eq(services.id, booking.service_id) });

  // Same per-booking locks as the sync, so a concurrent retry can't
  // rewrite the row/event between our read and our update.
  const calendar: CalendarCancelResult =
    (await withBookingLock('google_calendar', booking.id, (_tx, fresh) =>
      markCalendarEventCancelled(fresh, cancelledBy)
    ).catch((err) => ({ status: 'failed' as const, message: String((err as Error)?.message || err) }))) ??
    { status: 'skipped', message: 'Booking not found' };

  const sheets: SheetsCancelResult = service
    ? (await withBookingLock('google_sheets', booking.id, (_tx, fresh) => markBookingCancelledInSheet(fresh, service)).catch(
        (err) => ({ status: 'failed' as const, rowId: null, message: String((err as Error)?.message || err) })
      )) ?? { status: 'skipped', rowId: null, message: 'Booking not found' }
    : { status: 'skipped', rowId: null, message: 'Service not found' };

  if (calendar.status !== 'skipped') {
    await logIntegration('google_calendar', booking.id, calendar.status === 'failed' || calendar.status === 'not_configured' ? 'failed' : 'success', calendar.message, {
      operation: `cancel_${calendar.status}`,
    });
  }
  if (sheets.status !== 'skipped') {
    await logIntegration('google_sheets', booking.id, sheets.status === 'updated' ? 'success' : 'failed', sheets.message, {
      operation: `cancel_${sheets.status}`,
      range: sheets.rowId,
    });
  }

  await logIntegration('admin', booking.id, 'success', `Booking ${booking.booking_id} cancelled by ${cancelledBy}`, {
    action: 'cancel_booking',
    previousStatus: before.status,
    paymentStatus: booking.payment_status,
    holdsReleased,
    stripeSession: stripeSession.status,
    calendar: calendar.status,
    sheets: sheets.status,
    refundIssued: false,
  });

  return { ok: true, booking, previousStatus: before.status, holdsReleased, stripeSession, calendar, sheets };
}
