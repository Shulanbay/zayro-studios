import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { availabilityOverrides, bookings } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { CrmError, errorResponse } from '@/lib/crm/errors';
import { dateStr, timeStr } from '@/lib/crm/validation';
import { lockStudioDates, ROOM_HOLDING_STATUSES } from '@/lib/availability';
import { addDays, wallTimeToUtc } from '@/lib/crm/time';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    date: dateStr,
    kind: z.enum(['custom_hours', 'holiday', 'day_off', 'closure']),
    start_time: timeStr.optional().nullable(),
    end_time: timeStr.optional().nullable(),
    reason: z.string().trim().max(255).optional().nullable(),
  })
  .strict()
  .refine((v) => v.kind !== 'custom_hours' || (v.start_time && v.end_time && v.end_time > v.start_time), {
    message: 'Custom hours need an opening time before the closing time',
    path: ['end_time'],
  });

/** One date's hours: a holiday / day off / closure, or custom opening hours. Replaces any existing override for that date. */
export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'availability.manage');
  if (!guard.ok) return guard.response;
  try {
    const v = schema.parse(await readJsonObject(request));
    const closed = v.kind !== 'custom_hours';
    const row = await db.transaction(async (tx) => {
      await lockStudioDates(tx, [v.date]);
      // Warn instead of silently stranding customers: bookings outside the new hours.
      const dayStart = wallTimeToUtc(v.date, closed ? '00:00' : v.start_time!);
      const dayEnd = closed ? wallTimeToUtc(addDays(v.date, 1), '00:00') : wallTimeToUtc(v.date, v.end_time!);
      const all = await tx.query.bookings.findMany({
        where: and(inArray(bookings.status, [...ROOM_HOLDING_STATUSES]), lt(bookings.starts_at, wallTimeToUtc(addDays(v.date, 1), '00:00')), gt(bookings.ends_at, wallTimeToUtc(v.date, '00:00'))),
      });
      const outside = all.filter((b) => (closed ? true : b.starts_at! < dayStart || b.ends_at! > dayEnd));
      if (outside.length > 0) {
        throw new CrmError(`${outside.length} booking(s) that day would fall outside the new hours (${outside.map((b) => b.booking_id).join(', ')}). Reschedule them first.`, 409);
      }
      const [saved] = await tx
        .insert(availabilityOverrides)
        .values({ room_id: 1, date: v.date, kind: v.kind, is_closed: closed, start_time: closed ? null : v.start_time, end_time: closed ? null : v.end_time, reason: v.reason || null, created_by: guard.admin.email })
        .onConflictDoUpdate({
          target: [availabilityOverrides.room_id, availabilityOverrides.date],
          set: { kind: v.kind, is_closed: closed, start_time: closed ? null : v.start_time, end_time: closed ? null : v.end_time, reason: v.reason || null, updated_at: new Date() },
        })
        .returning();
      await writeAudit({ actor: actorOf(guard.admin), operation: 'availability.set_override', entityType: 'availability_override', entityId: v.date, after: v }, tx);
      return saved;
    });
    return NextResponse.json({ id: row.id, message: 'Date override saved' });
  } catch (error) {
    return errorResponse(error, 'save override');
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await requirePermission(request, 'availability.manage');
  if (!guard.ok) return guard.response;
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const [removed] = await db.delete(availabilityOverrides).where(eq(availabilityOverrides.id, id)).returning();
  if (!removed) return NextResponse.json({ error: 'Override not found' }, { status: 404 });
  await writeAudit({ actor: actorOf(guard.admin), operation: 'availability.remove_override', entityType: 'availability_override', entityId: removed.date, before: removed });
  return NextResponse.json({ message: 'Override removed — regular weekly hours apply again' });
}
