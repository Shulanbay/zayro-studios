import { NextRequest } from 'next/server';
import { cancellationPreview } from '@/lib/manageBooking';
import { manageRoute } from '@/lib/manageRoute';

export const dynamic = 'force-dynamic';

/** What canceling would refund right now (server-computed). */
export async function POST(request: NextRequest) {
  return manageRoute(request, 'cancel-preview', 30, async (body) => cancellationPreview(body.token));
}
