import { NextRequest, NextResponse } from 'next/server';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { errorResponse } from '@/lib/crm/errors';
import { outcomeSchema, uuid } from '@/lib/crm/validation';
import { setBookingOutcome } from '@/lib/crm/bookings';

export const dynamic = 'force-dynamic';

/** Marks a session completed or no-show (or reopens it). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'bookings.update');
  if (!guard.ok) return guard.response;
  try {
    const id = uuid.parse(params.id);
    const { outcome } = outcomeSchema.parse(await readJsonObject(request));
    const booking = await setBookingOutcome(id, outcome, actorOf(guard.admin));
    return NextResponse.json({ status: booking.status, message: outcome === 'confirmed' ? 'Session reopened' : `Marked ${outcome.replace('_', '-')}` });
  } catch (error) {
    return errorResponse(error, 'set booking outcome');
  }
}
