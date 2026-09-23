import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { temporaryHolds, services } from '@/lib/db/schema';
import { checkTimeSlotConflict, isSlotActuallyAvailable, timeToMinutes } from '@/lib/availability';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const TEMPORARY_HOLD_MINUTES = parseInt(process.env.TEMPORARY_HOLD_DURATION_MINUTES || '15');

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      customer_email,
      service_id,
      booking_date,
      start_time,
      end_time,
      duration_minutes,
    } = body;

    // Validate input — email is required up-front so a hold is never
    // created without knowing who it belongs to.
    if (!customer_email || !service_id || !booking_date || !start_time || !end_time || !duration_minutes) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (!isValidEmail(customer_email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) {
      return NextResponse.json({ error: 'Invalid booking_date format' }, { status: 400 });
    }

    if (timeToMinutes(end_time) <= timeToMinutes(start_time)) {
      return NextResponse.json({ error: 'Invalid time range' }, { status: 400 });
    }

    const service = await db.query.services.findFirst({
      where: eq(services.id, service_id),
    });

    if (!service || !service.is_active) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    if (service.duration_minutes !== duration_minutes) {
      return NextResponse.json({ error: 'Duration does not match service' }, { status: 400 });
    }

    const holdId = crypto.randomUUID();
    const now = new Date();
    const holdExpiresAt = new Date(now.getTime() + TEMPORARY_HOLD_MINUTES * 60 * 1000);

    // Everything from here happens inside a single transaction guarded by a
    // Postgres advisory lock keyed on (service_id, date). This serializes
    // concurrent create-hold requests for the same service/day so the
    // conflict check and the insert are effectively atomic — two people
    // clicking the same slot at the same instant cannot both succeed.
    const lockKey = `${service_id}:${booking_date}`;

    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

        const hasConflict = await checkTimeSlotConflict(service_id, booking_date, start_time, end_time);
        if (hasConflict) {
          return { conflict: true as const };
        }

        // Defense in depth: confirm the requested slot is one the server
        // would actually offer (correct business hours, buffers, advance
        // notice), not just "nothing else booked at this exact time".
        const isReal = await isSlotActuallyAvailable(service_id, booking_date, start_time, end_time, duration_minutes);
        if (!isReal) {
          return { conflict: true as const };
        }

        await tx.insert(temporaryHolds).values({
          id: holdId,
          customer_email,
          service_id,
          booking_date,
          start_time,
          end_time,
          duration_minutes,
          status: 'active',
          hold_expires_at: holdExpiresAt,
          created_at: now,
        });

        return { conflict: false as const };
      });

      if (result.conflict) {
        return NextResponse.json(
          {
            error: 'Time slot already booked or held',
            conflict_type: 'booking_or_hold',
          },
          { status: 409 }
        );
      }
    } catch (txError: any) {
      if (txError.code === '23505' || txError.message?.includes('duplicate')) {
        return NextResponse.json(
          {
            error: 'Time slot was just booked by another user',
            conflict_type: 'race_condition',
          },
          { status: 409 }
        );
      }
      throw txError;
    }

    return NextResponse.json({
      hold_id: holdId,
      status: 'active',
      hold_expires_at: holdExpiresAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error creating hold:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
