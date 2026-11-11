import { NextRequest } from 'next/server';
import { rescheduleAvailability } from '@/lib/manageBooking';
import { manageRoute } from '@/lib/manageRoute';

export const dynamic = 'force-dynamic';

/** Free dates in a range, or free start times on one date, for moving this booking. */
export async function POST(request: NextRequest) {
  return manageRoute(request, 'reschedule-availability', 120, async (body) =>
    rescheduleAvailability(body.token, {
      from: typeof body.from === 'string' ? body.from : undefined,
      to: typeof body.to === 'string' ? body.to : undefined,
      date: typeof body.date === 'string' ? body.date : undefined,
    })
  );
}
