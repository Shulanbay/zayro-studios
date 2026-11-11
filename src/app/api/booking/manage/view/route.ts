import { NextRequest } from 'next/server';
import { manageViewForToken } from '@/lib/manageBooking';
import { manageRoute } from '@/lib/manageRoute';

export const dynamic = 'force-dynamic';

/** The booking a Manage Booking token opens. Unknown, revoked and malformed tokens get the same answer. */
export async function POST(request: NextRequest) {
  return manageRoute(request, 'view', 60, async (body) => ({ booking: await manageViewForToken(body.token) }));
}
