import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, desc, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { blockedTimes, bookings } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { errorResponse } from '@/lib/crm/errors';
import { lockStudioDates, ROOM_HOLDING_STATUSES } from '@/lib/availability';
import { addDays, isDateString, isTimeString, utcToWall, wallTimeToUtc } from '@/lib/crm/time';
import { removeBlockedTimeEvent, syncBlockedTimeEvent } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';

/**
 * Blocked studio time. Input is ET wall-clock (date + HH:MM), stored as
 * real UTC instants. Blocks take effect immediately for public booking,
 * can repeat weekly, are mirrored to Google Calendar (best effort) and are
 * soft-deleted so the audit trail keeps them.
 */

const createSchema = z
  .object({
    date: z.string().refine(isDateString, 'must be YYYY-MM-DD'),
    start_time: z.string().refine(isTimeString, 'must be HH:MM'),
    end_date: z.string().refine(isDateString, 'must be YYYY-MM-DD').optional(),
    end_time: z.string().refine(isTimeString, 'must be HH:MM'),
    reason: z.string().trim().max(255).optional(),
    kind: z.enum(['block', 'maintenance', 'private_event', 'holiday']).default('block'),
    repeat_weekly: z.coerce.number().int().min(0).max(26).default(0),
  })
  .strict();

export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, 'bookings.read');
  if (!guard.ok) return guard.response;
  const rows = await db.query.blockedTimes.findMany({
    where: isNull(blockedTimes.deleted_at),
    orderBy: [desc(blockedTimes.start_datetime)],
    limit: 500,
  });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'availability.manage');
  if (!guard.ok) return guard.response;
  try {
    const input = createSchema.parse(await readJsonObject(request));
    const endDate = input.end_date ?? input.date;
    const firstStart = wallTimeToUtc(input.date, input.start_time);
    const firstEnd = wallTimeToUtc(endDate, input.end_time);
    if (firstEnd <= firstStart) return NextResponse.json({ error: 'The end must be after the start' }, { status: 400 });
    if (firstEnd.getTime() - firstStart.getTime() > 31 * 86400000) {
      return NextResponse.json({ error: 'A single block can be at most 31 days' }, { status: 400 });
    }

    const occurrences = Array.from({ length: input.repeat_weekly + 1 }, (_, i) => ({
      start: wallTimeToUtc(addDays(input.date, i * 7), input.start_time),
      end: wallTimeToUtc(addDays(endDate, i * 7), input.end_time),
    }));
    const seriesId = occurrences.length > 1 ? crypto.randomUUID() : null;
    const actor = actorOf(guard.admin);

    const created = await db.transaction(async (tx) => {
      // Same lock as public holds, so a block and a booking can't race.
      const dates = occurrences.flatMap((o) => {
        const out: string[] = [];
        for (let d = utcToWall(o.start).date; d <= utcToWall(o.end).date; d = addDays(d, 1)) out.push(d);
        return out;
      });
      await lockStudioDates(tx, dates);

      for (const o of occurrences) {
        const clash = await tx.query.bookings.findFirst({
          where: and(inArray(bookings.status, [...ROOM_HOLDING_STATUSES]), lt(bookings.starts_at, o.end), gt(bookings.ends_at, o.start)),
        });
        if (clash) {
          return { error: `Booking ${clash.booking_id} is already in that time (${utcToWall(o.start).date}). Reschedule or cancel it first.` };
        }
      }

      const rows = await tx
        .insert(blockedTimes)
        .values(
          occurrences.map((o) => ({
            start_datetime: o.start,
            end_datetime: o.end,
            reason: input.reason || null,
            kind: input.kind,
            series_id: seriesId,
            created_by: guard.admin.email,
            tz_version: 2,
          }))
        )
        .returning();
      await writeAudit(
        {
          actor,
          operation: 'blocked_time.create',
          entityType: 'blocked_time',
          entityId: seriesId ?? rows[0].id,
          after: { occurrences: rows.length, date: input.date, start: input.start_time, endDate, end: input.end_time, reason: input.reason, kind: input.kind },
        },
        tx
      );
      return { rows };
    });

    if ('error' in created) return NextResponse.json({ error: created.error }, { status: 409 });

    // Best effort: mirror to Google Calendar.
    const calendar = [];
    for (const row of created.rows) {
      const r = await syncBlockedTimeEvent(row);
      if (r.eventId) await db.update(blockedTimes).set({ google_calendar_event_id: r.eventId }).where(eq(blockedTimes.id, row.id));
      calendar.push(r.status);
    }
    return NextResponse.json({ rows: created.rows, calendar });
  } catch (error) {
    return errorResponse(error, 'create blocked time');
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await requirePermission(request, 'availability.manage');
  if (!guard.ok) return guard.response;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const [removed] = await db
    .update(blockedTimes)
    .set({ deleted_at: new Date(), deleted_by: guard.admin.email, updated_at: new Date() })
    .where(and(eq(blockedTimes.id, id), isNull(blockedTimes.deleted_at)))
    .returning();
  if (!removed) return NextResponse.json({ error: 'Blocked time not found' }, { status: 404 });

  await writeAudit({
    actor: actorOf(guard.admin),
    operation: 'blocked_time.delete',
    entityType: 'blocked_time',
    entityId: id,
    before: { start: removed.start_datetime, end: removed.end_datetime, reason: removed.reason },
  });
  const calendar = removed.google_calendar_event_id ? await removeBlockedTimeEvent(removed.google_calendar_event_id) : null;
  return NextResponse.json({ success: true, calendar: calendar?.status ?? 'none' });
}
