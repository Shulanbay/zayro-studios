import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { availability } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { errorResponse } from '@/lib/crm/errors';

export const dynamic = 'force-dynamic';

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');

const patchSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    start_time: HHMM.optional(),
    end_time: HHMM.optional(),
    is_available: z.boolean().optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, 'bookings.read');
  if (!guard.ok) return guard.response;
  const rows = await db.query.availability.findMany({ orderBy: (a, { asc }) => [asc(a.id)] });
  return NextResponse.json(rows);
}

/** Weekly opening hours for one weekday. */
export async function PATCH(request: NextRequest) {
  const guard = await requirePermission(request, 'availability.manage');
  if (!guard.ok) return guard.response;
  try {
    const body = patchSchema.parse(await readJsonObject(request));
    const before = await db.query.availability.findFirst({ where: eq(availability.id, body.id) });
    if (!before) return NextResponse.json({ error: 'Day not found' }, { status: 404 });

    const start = body.start_time ?? before.start_time;
    const end = body.end_time ?? before.end_time;
    if (end <= start) return NextResponse.json({ error: 'Closing time must be after opening time' }, { status: 400 });

    const [updated] = await db
      .update(availability)
      .set({ start_time: start, end_time: end, is_available: body.is_available ?? before.is_available, updated_at: new Date() })
      .where(eq(availability.id, body.id))
      .returning();

    await writeAudit({
      actor: actorOf(guard.admin),
      operation: 'availability.update_hours',
      entityType: 'availability',
      entityId: before.day_of_week,
      before: { start: before.start_time, end: before.end_time, open: before.is_available },
      after: { start: updated.start_time, end: updated.end_time, open: updated.is_available },
    });
    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error, 'update availability');
  }
}
