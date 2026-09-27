import { NextRequest, NextResponse } from 'next/server';
import { getAvailableDates, getBookingRules } from '@/lib/availability';
import { findBookableService } from '@/lib/catalogData';
import { addDays, daysBetween, isDateString, todayInTz } from '@/lib/crm/time';

export const dynamic = 'force-dynamic';

/** At most this many days per request (the booking calendar asks a month at a time). */
const MAX_RANGE_DAYS = 62;

/**
 * Dates with at least one free slot for the service's duration, in studio
 * time (ET), clipped to today … today + booking horizon.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const serviceId = searchParams.get('service_id');
  const fromDate = searchParams.get('from_date');
  const toDate = searchParams.get('to_date');

  if (!serviceId || !fromDate || !toDate) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }
  if (!isDateString(fromDate) || !isDateString(toDate) || toDate < fromDate) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }
  if (daysBetween(fromDate, toDate) > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `Ask for at most ${MAX_RANGE_DAYS} days at a time` }, { status: 400 });
  }

  try {
    const lookup = await findBookableService(serviceId);
    if (!lookup.ok) {
      return NextResponse.json({ error: lookup.error }, { status: lookup.status });
    }

    const rules = await getBookingRules();
    const today = todayInTz();
    const available = await getAvailableDates(fromDate, toDate, lookup.service.duration_minutes, undefined, { rules });

    return NextResponse.json(
      {
        available_dates: available,
        min_date: today,
        max_date: addDays(today, rules.horizonDays),
        timezone: 'America/New_York',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error fetching available dates:', (error as Error)?.message || error);
    return NextResponse.json(
      { error: 'Availability is temporarily unavailable. Please try again in a moment.' },
      { status: 503 }
    );
  }
}
