import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, LEAD_CONTACT_METHODS, LEAD_STATUSES } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { parsePage } from '@/lib/crm/range';
import { Card, EmptyState, Forbidden, Money, PageHeader, Pagination } from '@/components/crm/ui';
import { withParams } from '@/components/crm/ui-utils';
import { getAdminI18n } from '@/lib/i18n/server';
import { LEAD_PAGE_SIZE, leadFilterOptions, leadSummary, leadWhere, listLeads, type LeadFilters } from '@/lib/marketing/leads';
import LeadBoard from '@/components/marketing/admin/LeadBoard';
import { AddLeadButton } from '@/components/marketing/admin/LeadForms';
import { STATUS_COLORS } from '@/components/marketing/admin/Bits';

export const dynamic = 'force-dynamic';

export default async function LeadsPage({ searchParams }: { searchParams: LeadFilters & { view?: string; add?: string; page?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('leads.read')) return <Forbidden what="leads" />;
  const { t, f, label } = getAdminI18n(admin);
  const view = searchParams.view === 'list' ? 'list' : 'board';
  const filters: LeadFilters = { q: searchParams.q, status: searchParams.status, platform: searchParams.platform, source: searchParams.source, campaign: searchParams.campaign, page: searchParams.page, method: searchParams.method, from: searchParams.from, to: searchParams.to };
  // The board shows every status side by side, so its status filter is ignored.
  const boardFilters = { ...filters, status: undefined };
  const page = parsePage(searchParams.page);
  const [options, summary, board, list] = await Promise.all([
    leadFilterOptions(),
    leadSummary(view === 'board' ? boardFilters : filters),
    view === 'board' ? db.query.leads.findMany({ where: leadWhere(boardFilters), orderBy: [desc(leads.created_at)], limit: 400 }) : Promise.resolve([]),
    view === 'list' ? listLeads(filters, { page }) : Promise.resolve({ rows: [], total: 0 }),
  ]);
  const params = Object.fromEntries(Object.entries({ ...filters, view }).filter(([k, v]) => k !== 'page' && typeof v === 'string' && v)) as Record<string, string>;
  const exportQuery = new URLSearchParams(Object.entries(filters).filter(([, v]) => typeof v === 'string' && v) as [string, string][]).toString();
  const canEdit = admin.can('leads.manage');

  return (
    <>
      <PageHeader
        title={t('common.nav.leads')}
        description={t('marketing.leads.description', { count: summary.total, revenue: f.money(summary.revenueCents) })}
        actions={
          <>
            <a href={`/api/admin/leads/export?${exportQuery}`} className="crm-btn">
              {t('common.actions.exportCsv')}
            </a>
            {canEdit && (
              <a href={`/api/admin/leads/export?${exportQuery}&format=google_offline`} className="crm-btn" title={t('marketing.leads.offlineHint')}>
                {t('marketing.leads.offlineExport')}
              </a>
            )}
            {canEdit && <AddLeadButton openInitially={searchParams.add === '1'} />}
          </>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {LEAD_STATUSES.map((s) => (
          <Link key={s} href={withParams('/admin/leads', { ...params, view: 'list' }, { status: s })} className={`rounded-xl border px-3 py-2 ${STATUS_COLORS[s]} ${filters.status === s ? 'ring-2 ring-zayro-primary' : ''}`}>
            <span className="block text-xs break-words">{t(`marketing.status.${s}`)}</span>
            <span className="block text-xl font-bold tabular-nums">{f.number(summary.byStatus[s])}</span>
          </Link>
        ))}
      </div>

      <form method="get" className="card !p-4 mb-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 items-end" aria-label={t('marketing.leads.filters')}>
        <input type="hidden" name="view" value={view} />
        <div className="col-span-2">
          <label className="field-label" htmlFor="lf-q">
            {t('marketing.leads.search')}
          </label>
          <input id="lf-q" name="q" defaultValue={filters.q} placeholder={t('marketing.leads.searchPlaceholder')} />
        </div>
        {view === 'list' && (
          <Select id="lf-status" name="status" label={t('marketing.lead.status')} value={filters.status} any={t('common.all')} options={LEAD_STATUSES.map((s) => [s, t(`marketing.status.${s}`)])} />
        )}
        <Select id="lf-platform" name="platform" label={t('marketing.cols.platform')} value={filters.platform} any={t('common.all')} options={options.platform.map((p) => [p, t.dynamic(`analytics.platforms.${p}`, p)])} />
        <Select id="lf-source" name="source" label={t('marketing.lead.source')} value={filters.source} any={t('common.all')} options={options.source.map((s) => [s, s])} />
        <Select id="lf-campaign" name="campaign" label={t('marketing.lead.campaign')} value={filters.campaign} any={t('common.all')} options={options.campaign.map((s) => [s, s])} />
        <Select id="lf-page" name="page" label={t('marketing.cols.page')} value={filters.page} any={t('common.all')} options={options.page.map((s) => [s, `/${s}`])} />
        <Select id="lf-method" name="method" label={t('marketing.lead.method')} value={filters.method} any={t('common.all')} options={LEAD_CONTACT_METHODS.map((m) => [m, label(m)])} />
        <div>
          <label className="field-label" htmlFor="lf-from">
            {t('sessions.list.from')}
          </label>
          <input id="lf-from" type="date" name="from" defaultValue={filters.from} />
        </div>
        <div>
          <label className="field-label" htmlFor="lf-to">
            {t('sessions.list.to')}
          </label>
          <input id="lf-to" type="date" name="to" defaultValue={filters.to} />
        </div>
        <div className="col-span-2 md:col-span-4 xl:col-span-8 flex flex-wrap gap-2 items-center">
          <button type="submit" className="crm-btn crm-btn-primary">
            {t('common.actions.apply')}
          </button>
          <Link href={`/admin/leads?view=${view}`} className="crm-btn">
            {t('common.actions.clearFilters')}
          </Link>
          <div className="ml-auto flex gap-1" role="group" aria-label={t('marketing.leads.view')}>
            <Link href={withParams('/admin/leads', params, { view: 'board' })} className={`crm-btn crm-btn-sm ${view === 'board' ? 'crm-btn-primary' : ''}`}>
              {t('marketing.leads.board')}
            </Link>
            <Link href={withParams('/admin/leads', params, { view: 'list' })} className={`crm-btn crm-btn-sm ${view === 'list' ? 'crm-btn-primary' : ''}`}>
              {t('marketing.leads.list')}
            </Link>
          </div>
        </div>
      </form>

      {view === 'board' ? (
        board.length === 0 ? (
          <Card>
            <EmptyState title={t('marketing.leads.emptyTitle')} body={t('marketing.leads.emptyBody')} />
          </Card>
        ) : (
          <LeadBoard canEdit={canEdit} leads={board.map((l) => ({ id: l.id, name: l.name, phone: l.phone, email: l.email, status: l.status, platform: l.platform, utm_source: l.utm_source, utm_campaign: l.utm_campaign, landing_page_slug: l.landing_page_slug, contact_method: l.contact_method, revenue_cents: l.revenue_cents, created_at: l.created_at.toISOString() }))} />
        )
      ) : (
        <>
          <Card>
            {list.rows.length === 0 ? (
              <EmptyState title={t('marketing.leads.emptyTitle')} body={t('marketing.leads.emptyBody')} />
            ) : (
              <div className="crm-table-wrap -mx-5 md:-mx-6 -my-5 md:-my-6">
                <table className="crm-table min-w-[900px]">
                  <thead>
                    <tr>
                      {(['lead', 'contact', 'status', 'source', 'page', 'revenue', 'created'] as const).map((c) => (
                        <th key={c} scope="col">
                          {t(`marketing.leads.cols.${c}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <Link href={`/admin/leads/${l.id}`} className="font-medium">
                            {l.name || t('marketing.leads.noName')}
                          </Link>
                          <div className="text-xs text-zayro-gray">#{l.id} · {label(l.contact_method)}</div>
                        </td>
                        <td className="text-sm">
                          {l.phone && <div className="whitespace-nowrap">{l.phone}</div>}
                          {l.email && <div className="text-xs text-zayro-gray break-all">{l.email}</div>}
                        </td>
                        <td>
                          <span className={`crm-badge ${STATUS_COLORS[l.status]}`}>{t(`marketing.status.${l.status}`)}</span>
                        </td>
                        <td className="text-sm">
                          {t.dynamic(`analytics.platforms.${l.platform}`, l.platform)}
                          <div className="text-xs text-zayro-gray break-all">{[l.utm_source, l.utm_campaign].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="text-xs font-mono">{l.landing_page_slug ? `/${l.landing_page_slug}` : l.landing_path ?? '—'}</td>
                        <td>
                          <Money cents={l.revenue_cents} />
                        </td>
                        <td className="text-xs text-zayro-gray whitespace-nowrap">{f.instant(l.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Pagination base="/admin/leads" params={params} page={page} pageSize={LEAD_PAGE_SIZE} total={list.total} />
        </>
      )}
    </>
  );
}

function Select({ id, name, label, value, any, options }: { id: string; name: string; label: string; value?: string; any: string; options: [string, string][] }) {
  return (
    <div className="min-w-0">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} name={name} defaultValue={value ?? ''}>
        <option value="">{any}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
