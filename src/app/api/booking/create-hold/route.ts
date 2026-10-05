import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { temporaryHolds } from '@/lib/db/schema';
import { checkTimeSlotConflict, isSlotActuallyAvailable, lockStudioDates, timeToMinutes } from '@/lib/availability';
import { findBookableService } from '@/lib/catalogData';
import { quoteBooking, quoteForClient } from '@/lib/bookingQuote';
import { normalizeAddonChoices, normalizeUnits } from '@/lib/bookingOptions';
import { enforceRateLimit, isHoneypotTripped } from '@/lib/crm/rateLimit';
import { isDateString, isTimeString } from '@/lib/crm/time';
import { HOLD_MINUTES, releaseHold } from '@/lib/holds';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  customer_email: z.string().trim().email().max(255),
  service_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  booking_date: z.string().refine(isDateString, 'Invalid booking_date format'),
  start_time: z.string().refine(isTimeString, 'Invalid time format'),
  end_time: z.string().refine(isTimeString, 'Invalid time format'),
  duration_minutes: z.number().int().positive(),
  /** The hold this browser had before (picking another time gives it back). */
  previous_hold_id: z.string().uuid().optional().nullable(),
  /** Hours for services sold by the hour (default 1). */
  hours: z.number().int().min(1).max(24).optional(),
  /** Chosen extras: [{ id, quantity }]. Prices always come from the database. */
  addons: z.array(z.object({ id: z.number().int().positive(), quantity: z.number().int().min(0).max(20) })).max(30).optional(),
  website: z.string().optional(),
});

/**
 * Reserves a slot for one customer while they confirm or pay. The server
 * re-checks everything (service, duration, business hours, cutoff, buffers,
 * other bookings, holds, blocked time) under the studio's per-date lock, so
 * two people can never hold overlapping times — whatever the services.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'create-hold', 30, 600);
  if (limited) return limited;

  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await request.json();
    if (isHoneypotTripped(raw)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const missing = parsed.error.issues.some((i) => i.code === 'invalid_type' && i.received === 'undefined');
      const error = missing
        ? 'Missing required fields'
        : issue.path[0] === 'customer_email'
          ? 'Invalid email format'
          : issue.message || 'Invalid request';
      return NextResponse.json({ error }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { customer_email, booking_date, start_time, end_time, duration_minutes } = body;
  const email = customer_email.trim();

  if (timeToMinutes(end_time) <= timeToMinutes(start_time)) {
    return NextResponse.json({ error: 'Invalid time range' }, { status: 400 });
  }

  try {
    // Rejects inactive, quote-only and hidden services and monthly packages
    // (a package purchase never occupies a time slot).
    const lookup = await findBookableService(body.service_id);
    if (!lookup.ok) {
      return NextResponse.json({ error: lookup.error }, { status: lookup.status });
    }
    const service = lookup.service;

    const units = normalizeUnits(body.hours, service);
    if (units === null) {
      return NextResponse.json({ error: 'That session length is not available for this service.' }, { status: 400 });
    }
    const totalMinutes = service.duration_minutes * units;
    if (totalMinutes !== duration_minutes) {
      return NextResponse.json({ error: 'Duration does not match service' }, { status: 400 });
    }
    if (timeToMinutes(end_time) - timeToMinutes(start_time) !== totalMinutes) {
      return NextResponse.json({ error: 'Time range does not match the service duration' }, { status: 400 });
    }

    const choices = normalizeAddonChoices(body.addons);
    if (choices === null) return NextResponse.json({ error: 'Invalid extras' }, { status: 400 });
    const quoted = await quoteBooking(service, units, choices);
    if (!quoted.ok) return NextResponse.json({ error: quoted.error }, { status: 400 });
    const selectionKey = JSON.stringify(quoted.selection);

    // Picking another time: give the previous hold back first (its own
    // email only — a hold id alone can't release someone else's slot here).
    if (body.previous_hold_id) {
      const previous = await db.query.temporaryHolds.findFirst({ where: eq(temporaryHolds.id, body.previous_hold_id) });
      if (previous && previous.status === 'active' && previous.customer_email.trim().toLowerCase() === email.toLowerCase()) {
        await releaseHold(previous.id, 'Customer picked another time');
      }
    }

    const holdId = crypto.randomUUID();
    const now = new Date();
    const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60 * 1000);

    // Everything from here happens inside a single transaction guarded by a
    // Postgres advisory lock keyed on the date. The studio is one room, so
    // this serializes concurrent create-hold requests for that day across
    // all services — the conflict check and the insert are effectively
    // atomic, and two people clicking overlapping slots (even for different
    // services) cannot both succeed.
    const result = await db.transaction(async (tx) => {
      await lockStudioDates(tx, [booking_date]);

      // The same customer asking again for the same slot (double click,
      // retry after a network error) gets their existing hold back.
      const [existing] = await tx
        .select()
        .from(temporaryHolds)
        .where(
          and(
            sql`lower(trim(${temporaryHolds.customer_email})) = ${email.toLowerCase()}`,
            eq(temporaryHolds.service_id, service.id),
            eq(temporaryHolds.booking_date, booking_date),
            eq(temporaryHolds.start_time, start_time),
            eq(temporaryHolds.status, 'active'),
            gt(temporaryHolds.hold_expires_at, now)
          )
        )
        .limit(1);
      if (existing && existing.end_time === end_time) {
        // Same slot, possibly different extras: keep the hold, update what it was quoted for.
        if (JSON.stringify(existing.selection ?? {}) !== selectionKey) {
          await tx.update(temporaryHolds).set({ selection: quoted.selection }).where(eq(temporaryHolds.id, existing.id));
        }
        return { kind: 'existing' as const, id: existing.id, expiresAt: new Date(existing.hold_expires_at) };
      }
      if (existing) {
        // Same start, different length: replace the customer's own hold.
        await tx.update(temporaryHolds).set({ status: 'cancelled' }).where(eq(temporaryHolds.id, existing.id));
      }

      if (await checkTimeSlotConflict(booking_date, start_time, end_time, tx)) return { kind: 'conflict' as const };

      // Defense in depth: confirm the requested slot is one the server
      // would actually offer (correct business hours, buffers, advance
      // notice), not just "nothing else booked at this exact time".
      if (!(await isSlotActuallyAvailable(booking_date, start_time, end_time, duration_minutes, tx))) {
        return { kind: 'conflict' as const };
      }

      await tx.insert(temporaryHolds).values({
        id: holdId,
        customer_email: email,
        service_id: service.id,
        booking_date,
        start_time,
        end_time,
        duration_minutes,
        status: 'active',
        hold_expires_at: holdExpiresAt,
        selection: quoted.selection,
        created_at: now,
      });
      return { kind: 'created' as const, id: holdId, expiresAt: holdExpiresAt };
    });

    if (result.kind === 'conflict') {
      return NextResponse.json(
        { error: 'That time was just booked or is no longer available. Please choose another time.', conflict_type: 'booking_or_hold' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      hold_id: result.id,
      status: 'active',
      hold_expires_at: result.expiresAt.toISOString(),
      // Server-computed price for the summary; the client never sends a price.
      pricing: quoteForClient(quoted.quote),
    });
  } catch (error) {
    console.error('Error creating hold:', (error as Error)?.message || error);
    return NextResponse.json({ error: 'We could not reserve that time right now. Please try again in a moment.' }, { status: 500 });
  }
}
