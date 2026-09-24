import { NextRequest, NextResponse } from 'next/server';
import { actorOf, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { errorResponse } from '@/lib/crm/errors';
import { retryWebhookEvent } from '@/lib/crm/webhook';

export const dynamic = 'force-dynamic';

/** Re-fetches a failed Stripe event from Stripe and processes it again (idempotent). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'integrations.retry');
  if (!guard.ok) return guard.response;
  try {
    if (!/^evt_[A-Za-z0-9]+$/.test(params.id)) return NextResponse.json({ error: 'Invalid event id' }, { status: 400 });
    const outcome = await retryWebhookEvent(params.id);
    await writeAudit({
      actor: actorOf(guard.admin),
      operation: 'integration.retry_webhook',
      entityType: 'webhook_event',
      entityId: params.id,
      outcome: outcome.httpStatus < 300 ? 'success' : 'failed',
      metadata: { httpStatus: outcome.httpStatus, result: outcome.body },
    });
    if (outcome.httpStatus >= 300) return NextResponse.json({ error: String(outcome.body.error ?? 'Retry failed') }, { status: outcome.httpStatus });
    return NextResponse.json({ message: `Processed: ${String(outcome.body.status ?? 'ok')}` });
  } catch (error) {
    return errorResponse(error, 'retry webhook');
  }
}
