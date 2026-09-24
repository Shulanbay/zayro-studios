import { NextRequest, NextResponse } from 'next/server';
import { actorOf, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { errorResponse } from '@/lib/crm/errors';
import { uuid } from '@/lib/crm/validation';
import { retryEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/** Re-sends one failed/skipped email. Email only — never touches Calendar or Sheets; a sent email is never re-sent. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'integrations.retry');
  if (!guard.ok) return guard.response;
  try {
    const id = uuid.parse(params.id);
    const result = await retryEmail(id);
    await writeAudit({
      actor: actorOf(guard.admin),
      operation: 'integration.retry_email',
      entityType: 'email_log',
      entityId: id,
      outcome: result.sent ? 'success' : 'failed',
      metadata: { status: result.status, error: result.error ?? null },
    });
    if (!result.sent) return NextResponse.json({ error: `Email ${result.status}${result.error ? `: ${result.error}` : ''}` }, { status: 502 });
    return NextResponse.json({ message: result.status === 'duplicate' ? 'Already sent earlier — not sent again' : 'Email sent' });
  } catch (error) {
    return errorResponse(error, 'retry email');
  }
}
