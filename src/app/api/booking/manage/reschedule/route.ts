import { NextRequest } from 'next/server';
import { rescheduleByCustomer } from '@/lib/manageBooking';
import { manageRoute } from '@/lib/manageRoute';

export const dynamic = 'force-dynamic';

/** Moves the booking to a new free time (same service, length, setup and extras). */
export async function POST(request: NextRequest) {
  return manageRoute(request, 'reschedule', 10, async (body) => rescheduleByCustomer(body.token, { date: body.date, startTime: body.startTime }));
}
