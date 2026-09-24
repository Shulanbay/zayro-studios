import { NextRequest, NextResponse } from 'next/server';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { errorResponse } from '@/lib/crm/errors';
import { rescheduleSchema, uuid } from '@/lib/crm/validation';
import { rescheduleBooking } from '@/lib/crm/bookings';

export const dynamic = 'force-dynamic';

/** Moves a confirmed booking and/or switches its service. Never changes what was paid. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'bookings.update');
  if (!guard.ok) return guard.response;
  try {
    const id = uuid.parse(params.id);
    const v = rescheduleSchema.parse(await readJsonObject(request));
    const { booking, effects } = await rescheduleBooking(id, v, actorOf(guard.admin));
    return NextResponse.json({ id: booking.id, effects, message: `Moved to ${v.date} ${v.startTime}` });
  } catch (error) {
    return errorResponse(error, 'reschedule booking');
  }
}
