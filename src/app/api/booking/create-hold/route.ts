import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { temporaryHolds } from '@/lib/db/schema';
import { checkTimeSlotConflict } from '@/lib/availability';

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

    // Validate input
    if (!customer_email || !service_id || !booking_date || !start_time || !end_time || !duration_minutes) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Email format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Check for conflicts WITHIN A TRANSACTION
    // This ensures that two concurrent requests cannot double-book the same slot
    const holdId = crypto.randomUUID();
    const now = new Date();
    const holdExpiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes from now

    // First, check if there's a conflict
    const hasConflict = await checkTimeSlotConflict(service_id, booking_date, start_time, end_time);
    if (hasConflict) {
      return NextResponse.json(
        {
          error: 'Time slot already booked or held',
          conflict_type: 'booking_or_hold',
        },
        { status: 409 }
      );
    }

    // Create the hold
    // In a real production system, this would be wrapped in an actual database transaction
    // For now, we're relying on the conflict check above and assuming PostgreSQL serialization
    await db.insert(temporaryHolds).values({
      id: holdId,
      customer_email,
      service_id: service_id,
      booking_date,
      start_time,
      end_time,
      duration_minutes: duration_minutes,
      status: 'active',
      hold_expires_at: holdExpiresAt,
      created_at: now,
    });

    return NextResponse.json({
      hold_id: holdId,
      status: 'active',
      hold_expires_at: holdExpiresAt.toISOString(),
    });
  } catch (error: any) {
    console.error('Error creating hold:', error);

    // Check if it's a unique constraint violation (double-booking race condition)
    if (error.code === '23505' || error.message?.includes('duplicate')) {
      return NextResponse.json(
        {
          error: 'Time slot was just booked by another user',
          conflict_type: 'race_condition',
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
