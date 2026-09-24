import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { actorOf, requirePermission } from '@/lib/crm/auth';
import { db } from '@/lib/db';
import { bookings } from '@/lib/db/schema';
import { cancelBooking } from '@/lib/cancelBooking';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin-only cancellation of one booking. The body must repeat the booking's
 * human-readable ID ({ "confirmBookingId": "ZAY-…" }) as a server-side
 * confirmation, so a stray or replayed request for the wrong UUID can't
 * cancel anything. Never refunds; see lib/cancelBooking.ts.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'bookings.cancel');
  if (!guard.ok) return guard.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid booking id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const confirmBookingId = typeof body?.confirmBookingId === 'string' ? body.confirmBookingId.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason : null;
  const notifyCustomer = body?.notifyCustomer === true;

  const booking = await db.query.bookings.findFirst({ where: eq(bookings.id, params.id) });
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }
  if (!confirmBookingId || confirmBookingId !== booking.booking_id) {
    return NextResponse.json({ error: 'Confirmation does not match this booking' }, { status: 400 });
  }

  const result = await cancelBooking(booking.id, actorOf(guard.admin), { reason, notifyCustomer });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  }

  return NextResponse.json({
    bookingId: result.booking.booking_id,
    status: result.booking.status,
    previousStatus: result.previousStatus,
    paymentStatus: result.booking.payment_status,
    holdsReleased: result.holdsReleased,
    stripeSession: result.stripeSession,
    calendar: result.calendar,
    sheets: result.sheets,
    email: result.email,
    creditRestored: result.creditRestored,
    needsRefundDecision: result.needsRefundDecision,
    refundIssued: false,
  });
}
