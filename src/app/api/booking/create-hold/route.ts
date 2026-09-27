import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { temporaryHolds } from '@/lib/db/schema';
import { checkTimeSlotConflict, isSlotActuallyAvailable, lockStudioDates, timeToMinutes } from '@/lib/availability';
import { findBookableService } from '@/lib/catalogData';
import { calculatePricing } from '@/lib/pricing';
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
  website: z.string().optional(),
});

function money(cents: number) {
  return (cents / 100).toFixed(2);
}

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

    if (service.duration_minutes !== duration_minutes) {
      return NextResponse.json({ error: 'Duration does not match service' }, { status: 400 });
    }
    if (timeToMinutes(end_time) - timeToMinutes(start_time) !== service.duration_minutes) {
      return NextResponse.json({ error: 'Time range does not match the service duration' }, { status: 400 });
    }

    const pricing = await calculatePricing(service.id);
    if (!pricing) return NextResponse.json({ error: 'Could not calculate pricing' }, { status: 500 });

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
      if (existing) return { kind: 'existing' as const, id: existing.id, expiresAt: new Date(existing.hold_expires_at) };

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
      pricing: {
        subtotal: money(pricing.subtotal),
        taxAmount: money(pricing.taxAmount),
        total: money(pricing.total),
        taxRate: pricing.taxRate,
        currency: pricing.currency,
      },
    });
  } catch (error) {
    console.error('Error creating hold:', (error as Error)?.message || error);
    return NextResponse.json({ error: 'We could not reserve that time right now. Please try again in a moment.' }, { status: 500 });
  }
}
