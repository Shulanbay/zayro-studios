import { NextRequest, NextResponse } from 'next/server';
import { actorOf, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { errorResponse } from '@/lib/crm/errors';
import { processDueDeliveries, requeueFailedDeliveries } from '@/lib/analytics/server/deliveries';

export const dynamic = 'force-dynamic';

/** Re-queues failed analytics deliveries and runs the queue once. Operational: integrations.retry, not analytics.* */
export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'integrations.retry');
  if (!guard.ok) return guard.response;
  try {
    const requeued = await requeueFailedDeliveries();
    const processed = await processDueDeliveries({ limit: 50 });
    await writeAudit({ actor: actorOf(guard.admin), operation: 'analytics.retry_deliveries', entityType: 'analytics', metadata: { requeued, ...processed } });
    return NextResponse.json({ requeued, processed });
  } catch (error) {
    return errorResponse(error, 'analytics delivery retry');
  }
}
