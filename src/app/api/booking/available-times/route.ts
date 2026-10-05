import { NextRequest, NextResponse } from 'next/server';
import { getAvailableTimeSlotsForDate } from '@/lib/availability';
import { findBookableService } from '@/lib/catalogData';
import { normalizeUnits } from '@/lib/bookingOptions';
import { isDateString } from '@/lib/crm/time';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const serviceId = searchParams.get('service_id');
  const date = searchParams.get('date');

  if (!serviceId || !date) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }
  if (!isDateString(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  try {
    const lookup = await findBookableService(serviceId);
    if (!lookup.ok) {
      return NextResponse.json({ error: lookup.error }, { status: lookup.status });
    }

    // The slot length always comes from the service itself, so a 45-minute
    // headshot and a 2-hour brand shoot see different availability.
    const units = normalizeUnits(searchParams.get('hours') ?? undefined, lookup.service);
    if (units === null) return NextResponse.json({ error: 'That session length is not available for this service.' }, { status: 400 });
    const durationMinutes = lookup.service.duration_minutes * units;
    const slots = await getAvailableTimeSlotsForDate(date, durationMinutes);

    return NextResponse.json(
      { date, duration_minutes: durationMinutes, time_slots: slots, timezone: 'America/New_York' },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    // An outage must not look like "fully booked".
    console.error('Error fetching available times:', (error as Error)?.message || error);
    return NextResponse.json(
      { error: 'Availability is temporarily unavailable. Please try again in a moment.' },
      { status: 503 }
    );
  }
}
