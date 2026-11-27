import { NextRequest, NextResponse } from 'next/server';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { createLead } from '@/lib/marketing/leads';
import { leadCreateSchema } from '@/lib/marketing/validation';
import { classifyTouch, cleanUtm } from '@/lib/analytics/attribution';

export const dynamic = 'force-dynamic';

/** Add a lead by hand (WhatsApp, Telegram, a phone call, Instagram DM…). */
export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'leads.manage');
  if (!guard.ok) return guard.response;
  const parsed = leadCreateSchema.safeParse(await readJsonObject(request));
  if (!parsed.success) return NextResponse.json({ error: `Invalid ${String(parsed.error.issues[0]?.path[0] ?? 'input')}` }, { status: 400 });
  const v = parsed.data;
  if (!v.name && !v.phone && !v.email) return NextResponse.json({ error: 'Add a name, phone or email' }, { status: 400 });
  const utm = { utm_source: cleanUtm(v.utm_source) ?? undefined, utm_medium: cleanUtm(v.utm_medium) ?? undefined, utm_campaign: cleanUtm(v.utm_campaign) ?? undefined };
  const c = classifyTouch({ utm, clickIdTypes: [], referrerHost: null });
  const lead = await createLead(
    { name: v.name, phone: v.phone, email: v.email || null, message: v.message, contact_method: v.contact_method, status: v.status, revenue_cents: v.revenue, notes: v.notes, created_by: guard.admin.email },
    {
      utm_source: utm.utm_source ?? null,
      utm_medium: utm.utm_medium ?? null,
      utm_campaign: utm.utm_campaign ?? null,
      platform: utm.utm_source ? c.platform : 'direct',
      landing_page_slug: v.landing_page_slug && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.landing_page_slug) ? v.landing_page_slug : null,
    }
  );
  await writeAudit({ actor: actorOf(guard.admin), operation: 'lead.create', entityType: 'lead', entityId: lead.id, after: { status: lead.status, contactMethod: lead.contact_method, source: lead.utm_source } });
  return NextResponse.json({ id: lead.id, message: 'Lead added' });
}
