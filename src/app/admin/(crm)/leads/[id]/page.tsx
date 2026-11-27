import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { adminProfiles, leads } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { Card, DefinitionList, Forbidden, PageHeader } from '@/components/crm/ui';
import { getAdminI18n } from '@/lib/i18n/server';
import { clickIdTypes, leadTimeline } from '@/lib/marketing/leads';
import { whatsappDigits } from '@/lib/marketing/settings';
import { LeadEditor, LeadNoteForm } from '@/components/marketing/admin/LeadForms';
import { STATUS_COLORS } from '@/components/marketing/admin/Bits';

export const dynamic = 'force-dynamic';

export default async function LeadPage({ params }: { params: { id: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('leads.read')) return <Forbidden what="leads" />;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0 || id > 2 ** 31) notFound();
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, id) });
  if (!lead) notFound();
  const { t, f, label } = getAdminI18n(admin);
  const [timeline, team] = await Promise.all([
    leadTimeline(id),
    db.select({ email: adminProfiles.email }).from(adminProfiles).where(eq(adminProfiles.status, 'active')),
  ]);
  const wa = whatsappDigits(lead.phone);
  const tel = lead.phone?.replace(/[^\d+]/g, '');
  const clicks = clickIdTypes(lead);

  return (
    <>
      <PageHeader
        title={`${lead.name || t('marketing.leads.noName')} · #${lead.id}`}
        back={{ href: '/admin/leads', label: t('common.nav.leads') }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className={`crm-badge ${STATUS_COLORS[lead.status]}`}>{t(`marketing.status.${lead.status}`)}</span>
            <span>{label(lead.contact_method)}</span>
            <span className="text-zayro-gray">{f.instant(lead.created_at)}</span>
          </span>
        }
        actions={
          <>
            {tel && (
              <a href={`tel:${tel}`} className="crm-btn">
                {t('marketing.lead.call')}
              </a>
            )}
            {wa && (
              <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener" className="crm-btn">
                WhatsApp
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="crm-btn">
                {t('marketing.lead.emailAction')}
              </a>
            )}
            {lead.customer_id && admin.can('customers.read') && (
              <Link href={`/admin/customers/${lead.customer_id}`} className="crm-btn">
                {t('marketing.lead.customer')}
              </Link>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 grid gap-4 content-start min-w-0">
          <Card title={t('marketing.lead.deal')}>
            <LeadEditor
              canEdit={admin.can('leads.manage')}
              team={team.map((m) => m.email)}
              lead={{ id: lead.id, name: lead.name, phone: lead.phone, email: lead.email, status: lead.status, contact_method: lead.contact_method, revenue_cents: lead.revenue_cents, ad_spend_attributed_cents: lead.ad_spend_attributed_cents, lost_reason: lead.lost_reason, assigned_to: lead.assigned_to, notes: lead.notes }}
            />
          </Card>
          {lead.message && (
            <Card title={t('marketing.lead.message')}>
              <p className="whitespace-pre-wrap break-words text-sm">{lead.message}</p>
            </Card>
          )}
          <Card title={t('marketing.lead.timeline')}>
            {admin.can('leads.manage') && (
              <div className="mb-4">
                <LeadNoteForm leadId={lead.id} />
              </div>
            )}
            <ol className="grid gap-3 text-sm">
              {timeline.map((a) => (
                <li key={a.id} className="border-l-2 border-zayro-border pl-3">
                  <p className="font-medium text-zayro-dark">
                    {a.type === 'status'
                      ? t('marketing.timeline.status', { from: t.dynamic(`marketing.status.${a.from_value}`, a.from_value ?? ''), to: t.dynamic(`marketing.status.${a.to_value}`, a.to_value ?? '') })
                      : a.type === 'revenue'
                        ? t('marketing.timeline.revenue', { from: f.money(Number(a.from_value ?? 0)), to: f.money(Number(a.to_value ?? 0)) })
                        : a.type === 'assigned'
                          ? t('marketing.timeline.assigned', { to: a.to_value ?? t('marketing.lead.unassigned') })
                          : t(`marketing.timeline.${a.type}`)}
                  </p>
                  {a.body && <p className="whitespace-pre-wrap break-words text-zayro-gray">{a.type === 'edit' ? t('marketing.timeline.fields', { fields: a.body }) : a.body}</p>}
                  <p className="text-xs text-zayro-gray">
                    {f.instant(a.created_at)}
                    {a.actor_email ? ` · ${a.actor_email}` : ` · ${t('marketing.timeline.website')}`}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="grid gap-4 content-start min-w-0">
          <Card title={t('marketing.lead.attribution')}>
            <DefinitionList
              items={[
                [t('marketing.cols.platform'), t.dynamic(`analytics.platforms.${lead.platform}`, lead.platform)],
                ['utm_source', lead.utm_source],
                ['utm_medium', lead.utm_medium],
                ['utm_campaign', lead.utm_campaign],
                ['utm_content', lead.utm_content],
                ['utm_term', lead.utm_term],
                ...(lead.utm_id ? ([['utm_id', lead.utm_id]] as [string, string][]) : []),
                [t('marketing.cols.page'), lead.landing_page_slug ? <Link key="p" href={`/${lead.landing_page_slug}`} target="_blank">/{lead.landing_page_slug}</Link> : lead.landing_path],
                [t('marketing.lead.referrer'), lead.referrer ? <span key="r" className="break-all">{lead.referrer}</span> : null],
                [t('marketing.lead.clickIds'), clicks.length ? clicks.join(', ') : t('marketing.lead.noClickIds')],
              ]}
            />
            <p className="text-xs text-zayro-gray mt-3">{t('marketing.lead.clickIdsNote')}</p>
          </Card>
        </div>
      </div>
    </>
  );
}
