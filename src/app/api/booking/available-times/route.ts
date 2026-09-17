import { NextRequest, NextResponse } from 'next/server';
import { getAvailableTimeSlotsForDate } from '@/lib/availability';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const serviceId = searchParams.get('service_id');
    const date = searchParams.get('date');
    const durationStr = searchParams.get('duration_minutes');

    if (!serviceId || !date || !durationStr) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const durationMinutes = parseInt(durationStr, 10);
    if (isNaN(durationMinutes) || durationMinutes <= 0) {
      return NextResponse.json(
        { error: 'Invalid duration' },
        { status: 400 }
      );
    }

    const slots = await getAvailableTimeSlotsForDate(
      parseInt(serviceId, 10),
      date,
      durationMinutes
    );

    return NextResponse.json({
      date,
      time_slots: slots,
    });
  } catch (error) {
    console.error('Error fetching available times:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
