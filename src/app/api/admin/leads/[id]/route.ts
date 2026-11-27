import { NextRequest, NextResponse } from 'next/server';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { updateLead } from '@/lib/marketing/leads';
import { leadPatchSchema } from '@/lib/marketing/validation';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'leads.manage');
  if (!guard.ok) return guard.response;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const parsed = leadPatchSchema.safeParse(await readJsonObject(request));
  if (!parsed.success) return NextResponse.json({ error: `Invalid ${String(parsed.error.issues[0]?.path[0] ?? 'input')}` }, { status: 400 });
  const { revenue, ad_spend_attributed, email, ...rest } = parsed.data;
  const result = await updateLead(
    id,
    { ...rest, ...(email !== undefined ? { email: email || null } : {}), ...(revenue !== undefined ? { revenue_cents: revenue } : {}), ...(ad_spend_attributed !== undefined ? { ad_spend_attributed_cents: ad_spend_attributed } : {}) },
    guard.admin.email
  );
  if (!result) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  // Field names and statuses only — no contact details in the audit log.
  await writeAudit({
    actor: actorOf(guard.admin),
    operation: 'lead.update',
    entityType: 'lead',
    entityId: id,
    before: { status: result.before.status, revenueCents: result.before.revenue_cents },
    after: { status: result.after.status, revenueCents: result.after.revenue_cents, fields: Object.keys(parsed.data) },
  });
  return NextResponse.json({ lead: { id: result.after.id, status: result.after.status, revenue_cents: result.after.revenue_cents }, message: 'Lead updated' });
}
