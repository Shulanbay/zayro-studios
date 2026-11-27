import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { Card, Forbidden, Notice, PageHeader } from '@/components/crm/ui';
import { getAdminI18n } from '@/lib/i18n/server';
import type { AdminI18n } from '@/lib/i18n';
import { cockpit, type CockpitKpis } from '@/lib/marketing/cockpit';
import { parseMarketingRange, RANGE_PRESETS } from '@/lib/marketing/range';
import { leadSummary } from '@/lib/marketing/leads';
import { LEAD_STATUSES } from '@/lib/db/schema';
import { Bars, Metric, RangeTabs, STATUS_COLORS } from '@/components/marketing/admin/Bits';
import { PLATFORM_LABELS } from '@/lib/analytics/attribution';

export const dynamic = 'force-dynamic';

const change = (now: number | null, before: number | null) => (now === null || before === null ? null : before === 0 ? (now === 0 ? 0 : null) : (now - before) / before);

export default async function MarketingHubPage({ searchParams }: { searchParams: { range?: string; from?: string; to?: string; platform?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('analytics.read')) return <Forbidden what="marketing analytics" />;
  const i18n = getAdminI18n(admin);
  const { t, f } = i18n;
  const range = parseMarketingRange(searchParams);
  const platform = searchParams.platform && searchParams.platform in PLATFORM_LABELS ? searchParams.platform : undefined;
  const data = await cockpit(range, platform);
  const canLeads = admin.can('leads.read');
  const pipeline = canLeads ? await leadSummary({}) : null;
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ range: range.key === 'custom' ? undefined : range.key, from: range.key === 'custom' ? range.from : undefined, to: range.key === 'custom' ? range.to : undefined, platform, ...extra })) if (v) p.set(k, v);
    return `?${p.toString()}`;
  };
  const money = (c: number | null) => (c === null ? '—' : f.money(c));
  const roas = (r: number | null) => (r === null ? '—' : `${f.number(r, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}×`);
  const pct = (r: number | null) => (r === null ? '—' : f.percent(r, 1));
  const delta = (k: keyof CockpitKpis) => {
    const now = data.now[k] as number | null;
    const before = data.before[k] as number | null;
    const r = change(now, before);
    return { ratio: r, text: r === null ? t('marketing.hub.noPrior') : t('marketing.hub.vsPrev', { change: f.signedPercent(r) }) };
  };
  const done = data.checklist.filter((c) => c.done).length;

  return (
    <>
      <PageHeader
        title={t('marketing.hub.title')}
        description={t('marketing.hub.description', { range: f.dateRange(range.from, range.to) })}
        actions={
          <>
            {admin.can('leads.manage') && (
              <Link href="/admin/leads?add=1" className="crm-btn">
                {t('marketing.hub.addLead')}
              </Link>
            )}
            {admin.can('pages.manage') && (
              <Link href="/admin/pages?new=1" className="crm-btn crm-btn-primary">
                {t('marketing.hub.newPage')}
              </Link>
            )}
          </>
        }
      />

      <div className="card !p-4 mb-4 flex flex-wrap items-center gap-3 justify-between">
        <RangeTabs active={range.key} items={RANGE_PRESETS.map((k) => ({ key: k, label: t(`marketing.ranges.${k}`), href: q({ range: k, from: undefined, to: undefined }) }))} />
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="range" value={range.key === 'custom' ? '' : range.key} />
          <label className="sr-only" htmlFor="hub-platform">
            {t('marketing.hub.platform')}
          </label>
          <select id="hub-platform" name="platform" defaultValue={platform ?? ''} className="!w-auto max-w-full">
            <option value="">{t('marketing.hub.allPlatforms')}</option>
            {Object.keys(PLATFORM_LABELS).map((p) => (
              <option key={p} value={p}>
                {t.dynamic(`analytics.platforms.${p}`, PLATFORM_LABELS[p as keyof typeof PLATFORM_LABELS])}
              </option>
            ))}
          </select>
          <button type="submit" className="crm-btn crm-btn-sm">
            {t('common.actions.apply')}
          </button>
        </form>
      </div>

      {!data.now.hasSpend && (
        <div className="mb-4">
          <Notice tone="blue" title={t('marketing.hub.noSpendTitle')}>
            {t('marketing.hub.noSpendBody')}{' '}
            {admin.can('marketing.spend') && <Link href="/admin/ad-spend">{t('marketing.hub.enterSpend')}</Link>}
          </Notice>
        </div>
      )}

      <section aria-label={t('marketing.hub.kpis')} className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Metric label={t('marketing.kpi.spend')} value={money(data.now.hasSpend ? data.now.spendCents : null)} delta={delta('spendCents')} hint={t('marketing.kpi.spendHint')} invert />
        <Metric label={t('marketing.kpi.leads')} value={f.number(data.now.leads)} delta={delta('leads')} hint={t('marketing.kpi.leadsHint')} />
        <Metric label={t('marketing.kpi.cpl')} value={money(data.now.cplCents)} delta={delta('cplCents')} hint={t('marketing.kpi.cplHint')} invert />
        <Metric label={t('marketing.kpi.conversions')} value={f.number(data.now.conversions)} delta={delta('conversions')} hint={t('marketing.kpi.conversionsHint', { online: data.now.onlineBookings, crm: data.now.paidLeads })} />
        <Metric label={t('marketing.kpi.cpa')} value={money(data.now.cpaCents)} delta={delta('cpaCents')} hint={t('marketing.kpi.cpaHint')} invert />
        <Metric label={t('marketing.kpi.revenue')} value={f.money(data.now.revenueCents)} delta={delta('revenueCents')} hint={t('marketing.kpi.revenueHint', { online: f.money(data.now.onlineRevenueCents), crm: f.money(data.now.leadRevenueCents) })} />
        <Metric label={t('marketing.kpi.roas')} value={roas(data.now.roas)} delta={delta('roas')} hint={t('marketing.kpi.roasHint')} />
        <Metric label={t('marketing.kpi.leadToWon')} value={pct(data.now.leadToWon)} delta={delta('leadToWon')} hint={t('marketing.kpi.leadToWonHint')} />
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <Card title={t('marketing.hub.trend')} className="xl:col-span-2 min-w-0">
          <div className="grid gap-5">
            <div>
              <p className="text-xs font-semibold text-zayro-gray mb-1">{t('marketing.kpi.leads')}</p>
              <Bars values={data.series.map((s) => s.leads)} labels={data.series.map((s) => f.dateShort(s.date))} format={(v) => f.number(v)} title={t('marketing.hub.leadsPerDay')} />
            </div>
            <div>
              <p className="text-xs font-semibold text-zayro-gray mb-1">{t('marketing.kpi.spend')}</p>
              <Bars values={data.series.map((s) => s.spendCents)} labels={data.series.map((s) => f.dateShort(s.date))} format={(v) => f.money(v)} title={t('marketing.hub.spendPerDay')} />
            </div>
            <div className="flex justify-between text-[11px] text-zayro-gray" aria-hidden="true">
              <span>{f.dateShort(range.from)}</span>
              <span>{f.dateShort(range.to)}</span>
            </div>
          </div>
        </Card>
        <Card title={t('marketing.hub.checklist', { done, total: data.checklist.length })} className="min-w-0">
          <ul className="grid gap-2 text-sm">
            {data.checklist.map((c) => (
              <li key={c.key} className="flex items-start gap-2">
                <span aria-hidden="true" className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${c.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {c.done ? '✓' : ''}
                </span>
                <span className="min-w-0">
                  <Link href={c.href} className={c.done ? 'text-zayro-gray line-through decoration-zayro-gray/40' : 'font-medium'}>
                    {t(`marketing.checklist.${c.key}`)}
                  </Link>
                  <span className="sr-only">{c.done ? t('marketing.checklist.done') : t('marketing.checklist.todo')}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={t('marketing.hub.byPlatform')} className="mb-4">
        <PerfTable i18n={i18n} rows={data.platforms.map((r) => ({ key: r.platform, name: t.dynamic(`analytics.platforms.${r.platform}`, r.label), href: `/admin/leads?platform=${encodeURIComponent(r.platform)}`, ...r }))} first={t('marketing.cols.platform')} />
      </Card>

      <Card title={t('marketing.hub.byCampaign')} className="mb-4">
        <PerfTable
          i18n={i18n}
          rows={data.campaigns.map((r) => ({ key: `${r.platform}-${r.campaign}`, name: r.campaign === '(none)' ? t('marketing.hub.noCampaign') : r.campaign, sub: t.dynamic(`analytics.platforms.${r.platform}`, r.label), href: r.campaign !== '(none)' ? `/admin/leads?campaign=${encodeURIComponent(r.campaign)}` : undefined, ...r }))}
          first={t('marketing.cols.campaign')}
        />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title={t('marketing.hub.byPage')} actions={admin.can('pages.manage') ? <Link href="/admin/pages" className="crm-btn crm-btn-sm">{t('marketing.hub.allPages')}</Link> : null}>
          {data.pages.size === 0 ? (
            <p className="text-sm text-zayro-gray">{t('marketing.hub.noPageData')}</p>
          ) : (
            <div className="crm-table-wrap">
              <table className="crm-table text-sm [&_th]:whitespace-normal">
                <thead>
                  <tr>
                    <th scope="col">{t('marketing.cols.page')}</th>
                    <th scope="col">{t('marketing.cols.views')}</th>
                    <th scope="col">{t('marketing.cols.leads')}</th>
                    <th scope="col">{t('marketing.cols.convRate')}</th>
                    <th scope="col">{t('marketing.cols.revenue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.pages.values()]
                    .sort((a, b) => b.leads - a.leads || b.views - a.views)
                    .map((p) => (
                      <tr key={p.slug}>
                        <td className="font-mono text-xs">/{p.slug}</td>
                        <td>{f.number(p.views)}</td>
                        <td>{f.number(p.leads)}</td>
                        <td>{p.visitors > 0 ? f.percent(Math.min(1, p.leads / p.visitors), 1) : '—'}</td>
                        <td>{f.money(p.revenueCents)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {pipeline && (
          <Card title={t('marketing.hub.pipeline')} actions={<Link href="/admin/leads" className="crm-btn crm-btn-sm">{t('marketing.hub.openBoard')}</Link>}>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {LEAD_STATUSES.map((s) => (
                <Link key={s} href={`/admin/leads?status=${s}&view=list`} className={`rounded-xl border px-3 py-2 ${STATUS_COLORS[s]}`}>
                  <span className="block text-xs break-words">{t(`marketing.status.${s}`)}</span>
                  <span className="block text-xl font-bold tabular-nums">{f.number(pipeline.byStatus[s])}</span>
                </Link>
              ))}
            </div>
            <p className="text-xs text-zayro-gray mt-3">{t('marketing.hub.pipelineNote')}</p>
          </Card>
        )}
      </div>

      <details className="card !p-4 text-sm mt-4">
        <summary className="font-semibold cursor-pointer">{t('marketing.hub.definitions')}</summary>
        <ul className="mt-3 grid gap-1 list-disc pl-5 text-zayro-gray">
          {(['spend', 'leads', 'conversions', 'revenue', 'ratios'] as const).map((k) => (
            <li key={k}>{t(`marketing.definitions.${k}`)}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

interface PerfRow {
  key: string;
  name: string;
  sub?: string;
  href?: string;
  spendCents: number | null;
  adClicks: number | null;
  impressions: number | null;
  ctr: number | null;
  visits: number;
  leads: number;
  bookings: number;
  revenueCents: number;
  cplCents: number | null;
  cpaCents: number | null;
  roas: number | null;
}

function PerfTable({ i18n, rows, first }: { i18n: AdminI18n; rows: PerfRow[]; first: string }) {
  const { t, f } = i18n;
  if (rows.length === 0) return <p className="text-sm text-zayro-gray">{t('analytics.noData')}</p>;
  const money = (c: number | null) => (c === null ? '—' : f.money(c));
  return (
    <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
      <table className="crm-table text-sm min-w-[980px]">
        <thead>
          <tr>
            <th scope="col">{first}</th>
            {(['spend', 'impressions', 'clicks', 'ctr', 'visits', 'leads', 'cpl', 'bookings', 'cpa', 'revenue', 'roas'] as const).map((c) => (
              <th key={c} scope="col" className="text-right">
                {t(`marketing.cols.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="text-left font-medium min-w-[160px]">
                {r.href ? <Link href={r.href}>{r.name}</Link> : r.name}
                {r.sub && <div className="text-xs text-zayro-gray font-normal">{r.sub}</div>}
              </th>
              <td className="text-right tabular-nums">{money(r.spendCents)}</td>
              <td className="text-right tabular-nums">{r.impressions === null ? '—' : f.number(r.impressions)}</td>
              <td className="text-right tabular-nums">{r.adClicks === null ? '—' : f.number(r.adClicks)}</td>
              <td className="text-right tabular-nums">{r.ctr === null ? '—' : f.percent(r.ctr, 2)}</td>
              <td className="text-right tabular-nums">{f.number(r.visits)}</td>
              <td className="text-right tabular-nums">{f.number(r.leads)}</td>
              <td className="text-right tabular-nums">{money(r.cplCents)}</td>
              <td className="text-right tabular-nums">{f.number(r.bookings)}</td>
              <td className="text-right tabular-nums">{money(r.cpaCents)}</td>
              <td className="text-right tabular-nums">{f.money(r.revenueCents)}</td>
              <td className="text-right tabular-nums">{r.roas === null ? '—' : `${f.number(r.roas, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}×`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
