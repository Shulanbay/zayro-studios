import { NextRequest } from 'next/server';
import { startExtension } from '@/lib/manageBooking';
import { manageRoute } from '@/lib/manageRoute';
import { getBaseUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** Starts Stripe Checkout for extra time right after the session. The booking changes only once paid. */
export async function POST(request: NextRequest) {
  return manageRoute(request, 'extend', 10, async (body) => startExtension(body.token, body.hours, getBaseUrl(request)));
}
