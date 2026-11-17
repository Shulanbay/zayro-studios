import { NextRequest, NextResponse } from 'next/server';
import { processDueDeliveries } from '@/lib/analytics/server/deliveries';
import { cleanupAnalytics } from '@/lib/analytics/server/retention';
import { authorisedCron } from '@/lib/analytics/server/cron';

export const dynamic = 'force-dynamic';

/**
 * Scheduled job (vercel.json crons: every 10 minutes, and daily with
 * ?cleanup=1): retries due analytics deliveries and applies the retention
 * policy.
 * Responds with counts only.
 */
export async function GET(request: NextRequest) {
  if (!authorisedCron(request.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const deliveries = await processDueDeliveries({ limit: 100 });
    const cleanup = request.nextUrl.searchParams.get('cleanup') === '1' ? await cleanupAnalytics() : null;
    return NextResponse.json({ deliveries, cleanup });
  } catch (error) {
    console.error('[analytics] delivery job failed:', ((error as Error)?.message || String(error)).slice(0, 200));
    return NextResponse.json({ error: 'Delivery job failed' }, { status: 500 });
  }
}
