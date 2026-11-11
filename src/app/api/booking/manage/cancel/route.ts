import { NextRequest } from 'next/server';
import { cancelByCustomer } from '@/lib/manageBooking';
import { manageRoute } from '@/lib/manageRoute';

export const dynamic = 'force-dynamic';

/** Cancels at least 24 hours ahead and refunds to the original payment method. Safe to repeat. */
export async function POST(request: NextRequest) {
  return manageRoute(request, 'cancel', 10, async (body) => cancelByCustomer(body.token));
}
