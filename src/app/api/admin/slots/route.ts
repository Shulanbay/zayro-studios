import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { services } from '@/lib/db/schema';
import { requirePermission } from '@/lib/crm/auth';
import { loadDayContext, slotsFromContext } from '@/lib/availability';
import { isDateString } from '@/lib/crm/time';

export const dynamic = 'force-dynamic';

/**
 * Staff availability preview for a date: every grid slot for the service's
 * length (or ?duration=), with why the day is closed if it is. Ignores the
 * customer notice window; can exclude the booking being rescheduled.
 */
export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, 'bookings.read');
  if (!guard.ok) return guard.response;
  const sp = request.nextUrl.searchParams;
  const date = sp.get('date') ?? '';
  if (!isDateString(date)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });

  let duration = parseInt(sp.get('duration') ?? '', 10);
  const serviceId = parseInt(sp.get('serviceId') ?? '', 10);
  if (Number.isInteger(serviceId)) {
    const service = await db.query.services.findFirst({ where: eq(services.id, serviceId) });
    if (!service) return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    duration = service.duration_minutes;
  }
  if (!Number.isInteger(duration) || duration < 5 || duration > 16 * 60) duration = 60;

  const exclude = sp.get('excludeBookingId');
  const ctx = await loadDayContext(date, db, {
    ignoreCutoff: sp.get('public') !== '1',
    excludeBookingId: exclude && /^[0-9a-f-]{36}$/i.test(exclude) ? exclude : undefined,
  });
  return NextResponse.json({
    date,
    duration,
    open: ctx.open,
    closedReason: ctx.closedReason,
    override: ctx.override ? { kind: ctx.override.kind, reason: ctx.override.reason } : null,
    slots: slotsFromContext(ctx, duration),
  });
}
