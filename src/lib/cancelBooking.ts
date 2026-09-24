import { and, eq, inArray } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from './db';
import { bookings, purchases, services, temporaryHolds } from './db/schema';
import type { Booking } from './db/schema';
import { toDateOnly } from './utils';
import { logIntegration, withBookingLock } from './integrationSync';
import { markCalendarEventCancelled, type CalendarCancelResult } from './googleCalendar';
import { markBookingCancelledInSheet, type SheetsCancelResult } from './googleSheets';
import { sendCancellationEmail } from './email';
import { writeAudit, type AuditActor } from './crm/audit';
import { restoreCredit } from './crm/packages';
import { refreshCustomerStats } from './crm/customers';

/**
 * Admin cancellation of a single booking.
 *
 * - Only pending / payment_pending / confirmed bookings can be cancelled.
 *   The status flip is a compare-and-set, so two admins clicking at once
 *   can't both "win".
 * - Never refunds. A paid booking keeps its payment; the admin decides on a
 *   refund separately (Purchases → Refund), and the booking is flagged
 *   until that decision is made.
 * - An unpaid purchase is cancelled; an open Stripe Checkout session is
 *   expired so the customer can no longer pay for a released slot.
 * - A package credit used by the booking is restored.
 * - Any active hold for the same slot is released, so the slot frees up
 *   immediately.
 * - The Calendar event is marked CANCELLED (never deleted) and the sheet row
 *   is updated in place (never removed).
 * - The customer is emailed only when `notifyCustomer` is set.
 */

export const CANCELLABLE_STATUSES = ['pending', 'payment_pending', 'confirmed'] as const;

export interface CancelOptions {
  reason?: string | null;
  notifyCustomer?: boolean;
}

export type CancelBookingResult =
  | {
      ok: true;
      booking: Booking;
      previousStatus: string;
      holdsReleased: number;
      creditRestored: { restored: boolean; message: string };
      stripeSession: { status: 'expired' | 'not_open' | 'none' | 'failed'; message: string };
      calendar: CalendarCancelResult;
      sheets: SheetsCancelResult;
      email: { status: string; message: string };
      needsRefundDecision: boolean;
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

export async function cancelBooking(
  bookingUuid: string,
  actor: AuditActor | string,
  options: CancelOptions = {}
): Promise<CancelBookingResult> {
  const who: AuditActor = typeof actor === 'string' ? { email: actor } : actor;
  const cancelledBy = who.email || 'admin';
  const reason = options.reason?.trim().slice(0, 1000) || null;

  const before = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingUuid) });
  if (!before) return { ok: false, httpStatus: 404, error: 'Booking not found' };
  if (!(CANCELLABLE_STATUSES as readonly string[]).includes(before.status)) {
    return { ok: false, httpStatus: 409, error: `A ${before.status} booking cannot be cancelled` };
  }

  const paid = before.payment_status === 'succeeded' && parseFloat(before.total_amount) > 0;

  const txResult = await db.transaction(async (tx) => {
    const now = new Date();
    const updated = await tx
      .update(bookings)
      .set({
        status: 'cancelled',
        cancelled_at: now,
        cancellation_reason: reason,
        updated_by_admin_id: who.id ?? null,
        updated_at: now,
        ...(paid ? { needs_refund_review: true, review_reason: 'Paid booking cancelled — decide whether to refund' } : {}),
      })
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

    // Nothing was collected → the purchase is simply cancelled.
    if (before.purchase_id) {
      await tx
        .update(purchases)
        .set({ status: 'cancelled', updated_at: now })
        .where(and(eq(purchases.id, before.purchase_id), eq(purchases.status, 'pending')));
      if (paid) {
        await tx
          .update(purchases)
          .set({ needs_refund_review: true, review_reason: 'Booking cancelled — decide whether to refund', updated_at: now })
          .where(and(eq(purchases.id, before.purchase_id), inArray(purchases.status, ['paid', 'partially_refunded'])));
      }
    }

    const creditRestored = await restoreCredit(tx, { bookingId: bookingUuid, actor: who, reason: 'Booking cancelled' });
    await refreshCustomerStats(tx, before.customer_id);

    await writeAudit(
      {
        actor: who,
        operation: 'booking.cancel',
        entityType: 'booking',
        entityId: bookingUuid,
        before: { status: before.status, paymentStatus: before.payment_status },
        after: { status: 'cancelled' },
        metadata: { reason, holdsReleased: released.length, creditRestored: creditRestored.restored, refundIssued: false },
      },
      tx
    );

    return { booking: updated[0], holdsReleased: released.length, creditRestored };
  });

  if (!txResult) {
    return { ok: false, httpStatus: 409, error: 'Booking was changed by someone else; reload and try again' };
  }
  const { booking, holdsReleased, creditRestored } = txResult;

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

  let email = { status: 'not_requested', message: 'Customer not notified' };
  if (options.notifyCustomer && service) {
    const sent = await sendCancellationEmail({ booking, service });
    email = { status: sent.status, message: sent.sent ? 'Cancellation email sent' : `Email ${sent.status}: ${sent.error ?? ''}`.trim() };
    await logIntegration('email', booking.id, sent.sent ? 'success' : 'failed', email.message);
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

  return {
    ok: true,
    booking,
    previousStatus: before.status,
    holdsReleased,
    creditRestored,
    stripeSession,
    calendar,
    sheets,
    email,
    needsRefundDecision: paid,
  };
}
