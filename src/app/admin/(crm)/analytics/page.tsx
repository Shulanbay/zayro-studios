import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { addDays, isDateString, todayInTz } from '@/lib/crm/time';
import { Card, Forbidden, Notice, PageHeader, StatCard } from '@/components/crm/ui';
import { getAdminI18n } from '@/lib/i18n/server';
import type { AdminI18n } from '@/lib/i18n';
import { AnalyticsRetryButton } from '@/components/crm/analytics';
import { allDestinationStatuses, analyticsOperationalStatus } from '@/lib/analytics/server/config';
import {
  ATTRIBUTION_MODELS,
  campaignBreakdown,
  deliveryHealth,
  funnels,
  overview,
  parseModel,
  platformBreakdown,
  segmentBreakdowns,
  timeSeries,
  type AttributionModel,
} from '@/lib/analytics/server/metrics';
import { change, consentAndTestSummary, filterOptions, hasFilters, kpis, parseFilters, platformComparison, previousRange, type KpiSet } from '@/lib/analytics/server/kpis';
import { PLATFORM_LABELS } from '@/lib/analytics/attribution';

export const dynamic = 'force-dynamic';

const PRESET_KEYS = ['today', 'yesterday', '7d', '30d', 'month', 'prev'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function presets(today: string) {
  const monthStart = `${today.slice(0, 8)}01`;
  const prevEnd = addDays(monthStart, -1);
  const ranges: Record<(typeof PRESET_KEYS)[number], [string, string]> = {
    today: [today, today],
    yesterday: [addDays(today, -1), addDays(today, -1)],
    '7d': [addDays(today, -6), today],
    '30d': [addDays(today, -29), today],
    month: [monthStart, today],
    prev: [`${prevEnd.slice(0, 8)}01`, prevEnd],
  };
  return PRESET_KEYS.map((key) => ({ key, from: ranges[key][0], to: ranges[key][1] }));
}

/** Small locale-aware helpers shared by the page's sections. */
function helpers({ t, f }: AdminI18n) {
  return {
    num: (v: number) => f.number(v),
    pct: (v: number | null) => (v === null ? '—' : f.percent(v, Math.abs(v) < 0.1 ? 1 : 0)),
    hrs: (h: number | null) =>
      h === null ? '—' : h < 48 ? t('analytics.duration.hours', { value: f.number(h, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) }) : t('analytics.duration.days', { value: f.number(h / 24, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) }),
    platform: (key: string, fallback: string) => t.dynamic(`analytics.platforms.${key}`, fallback),
  };
}

function rangeFrom(sp: { range?: string; from?: string; to?: string }) {
  const today = todayInTz();
  const list = presets(today);
  const preset = list.find((p) => p.key === sp.range);
  if (preset) return { from: preset.from, to: preset.to, key: preset.key };
  if (isDateString(sp.from) && isDateString(sp.to)) {
    let [from, to] = [sp.from, sp.to];
    if (from > to) [from, to] = [to, from];
    if (from < addDays(to, -400)) from = addDays(to, -400);
    return { from, to, key: 'custom' };
  }
  return { from: addDays(today, -29), to: today, key: '30d' };
}

function Bars({ data, value, label, format }: { data: { key: string; label: string }[]; value: (i: number) => number; label: string; format: (v: number) => string }) {
  const max = Math.max(1, ...data.map((_, i) => value(i)));
  return (
    <div role="img" aria-label={label} className="flex items-end gap-[2px] h-32 w-full overflow-hidden">
      {data.map((d, i) => (
        <div key={d.key} className="flex-1 min-w-[2px] bg-zayro-primary/80 rounded-t-sm" style={{ height: `${(value(i) / max) * 100}%` }} title={`${d.label}: ${format(value(i))}`} />
      ))}
    </div>
  );
}

function Info({ text }: { text: string }) {
  return (
    <span className="ml-1 text-zayro-gray cursor-help" title={text} aria-label={text}>
      ⓘ
    </span>
  );
}

function Delta({ i18n, now, before, invert = false, money = false, hours = false }: { i18n: AdminI18n; now: number | null; before: number | null; invert?: boolean; money?: boolean; hours?: boolean }) {
  const { t, f } = i18n;
  const h = helpers(i18n);
  const c = change(now, before);
  const prev = before === null ? '—' : money ? f.money(before) : hours ? h.hrs(before) : h.num(before);
  if (c === null) return <span className="text-zayro-gray">{t('analytics.delta.noPrior', { prev })}</span>;
  const good = invert ? c < 0 : c > 0;
  const tone = c === 0 ? 'text-zayro-gray' : good ? 'text-green-700' : 'text-red-700';
  return (
    <span className={tone}>
      {t('analytics.delta.change', { arrow: c > 0 ? '▲' : c < 0 ? '▼' : '•', change: f.percent(Math.abs(c), Math.abs(c) < 0.1 ? 1 : 0), prev })}
    </span>
  );
}

function Kpi({
  i18n,
  label,
  value,
  now,
  before,
  info,
  invert,
  money,
  hours,
  tone,
}: {
  i18n: AdminI18n;
  label: string;
  value: string;
  now: number | null;
  before: number | null;
  info: string;
  invert?: boolean;
  money?: boolean;
  hours?: boolean;
  tone?: 'good' | 'warn';
}) {
  return (
    <StatCard
      label={label}
      value={value}
      tone={tone}
      hint={
        <>
          <span className="block">{info}</span>
          <Delta i18n={i18n} now={now} before={before} invert={invert} money={money} hours={hours} />
        </>
      }
    />
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { range?: string; from?: string; to?: string; model?: string; platform?: string; source?: string; campaign?: string; service?: string };
}) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('analytics.read')) return <Forbidden what="marketing analytics" />;
  const i18n = getAdminI18n(admin);
  const { t, f } = i18n;
  const { num, pct, platform } = helpers(i18n);

  const range = rangeFrom(searchParams);
  const model: AttributionModel = parseModel(searchParams.model);
  // Access log: who looked at which period (no customer data is shown here).
  await writeAudit({
    actor: { id: admin.id, email: admin.email },
    operation: 'analytics.view',
    entityType: 'analytics',
    entityId: 'dashboard',
    metadata: { from: range.from, to: range.to, model, role: admin.roleName },
  }).catch(() => undefined);
  const filters = parseFilters(searchParams);
  const prev = previousRange(range);
  const [k, kPrev, comparison, options, diag] = await Promise.all([kpis(range, model, filters), kpis(prev, model, filters), platformComparison(range, model, filters), filterOptions(range), consentAndTestSummary(range)]);
  const [o, series, [bookingFunnel, tourFunnel, contactFunnel], platforms, campaigns, segments, health] = await Promise.all([
    overview(range),
    timeSeries(range),
    funnels(range),
    platformBreakdown(range, model),
    campaignBreakdown(range, model),
    segmentBreakdowns(range),
    deliveryHealth(range),
  ]);
  const statuses = allDestinationStatuses();
  const ownerView = admin.can('integrations.read');
  const seriesLabels = series.map((s) => ({ key: s.date, label: f.dateShort(s.date) }));
  const keepFilters = {
    ...(filters.platform ? { platform: filters.platform } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.campaign ? { campaign: filters.campaign } : {}),
    ...(filters.serviceId ? { service: String(filters.serviceId) } : {}),
  };
  const modelLabel = (key: AttributionModel) => t.dynamic(`analytics.models.${key}`, ATTRIBUTION_MODELS[key].label);
  const destinationName = (key: string, fallback: string) => t.dynamic(`analytics.destinations.names.${key}`, fallback);

  return (
    <>
      <PageHeader
        title={t('analytics.title')}
        description={t('analytics.description', { range: f.dateRange(range.from, range.to) })}
        actions={
          admin.can('analytics.export') ? (
            <a className="crm-btn" href={`/api/admin/analytics/export?${new URLSearchParams({ from: range.from, to: range.to, model }).toString()}`} download>
              {t('common.actions.exportCsv')}
            </a>
          ) : null
        }
      />

      <form method="get" className="card !p-4 mb-4 flex flex-wrap items-end gap-2" aria-label={t('analytics.form.label')}>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('analytics.form.presetsLabel')}>
          {presets(todayInTz()).map((p) => (
            <a
              key={p.key}
              href={`?${new URLSearchParams({ range: p.key, model, ...keepFilters }).toString()}`}
              className={`crm-btn ${range.key === p.key ? 'crm-btn-primary' : ''}`}
              aria-current={range.key === p.key ? 'true' : undefined}
            >
              {t(`analytics.presets.${p.key}`)}
            </a>
          ))}
        </div>
        <div>
          <label className="field-label" htmlFor="from">
            {t('analytics.form.from')}
          </label>
          <input id="from" type="date" name="from" defaultValue={range.from} lang={i18n.locale} />
        </div>
        <div>
          <label className="field-label" htmlFor="to">
            {t('analytics.form.to')}
          </label>
          <input id="to" type="date" name="to" defaultValue={range.to} lang={i18n.locale} />
        </div>
        <div className="min-w-0 max-w-full">
          <label className="field-label" htmlFor="model">
            {t('analytics.form.model')}
          </label>
          <select id="model" name="model" defaultValue={model}>
            {(Object.keys(ATTRIBUTION_MODELS) as AttributionModel[]).map((k) => (
              <option key={k} value={k}>
                {modelLabel(k)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 max-w-full">
          <label className="field-label" htmlFor="platform">
            {t('analytics.form.platform')}
          </label>
          <select id="platform" name="platform" defaultValue={filters.platform ?? ''}>
            <option value="">{t('analytics.form.all')}</option>
            {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {platform(key, label)}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 max-w-full">
          <label className="field-label" htmlFor="source">
            {t('analytics.form.source')}
          </label>
          <select id="source" name="source" defaultValue={filters.source ?? ''}>
            <option value="">{t('analytics.form.all')}</option>
            {options.sources.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 max-w-full">
          <label className="field-label" htmlFor="campaign">
            {t('analytics.form.campaign')}
          </label>
          <select id="campaign" name="campaign" defaultValue={filters.campaign ?? ''}>
            <option value="">{t('analytics.form.all')}</option>
            {options.campaigns.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 max-w-full">
          <label className="field-label" htmlFor="service">
            {t('analytics.form.service')}
          </label>
          <select id="service" name="service" defaultValue={filters.serviceId ? String(filters.serviceId) : ''}>
            <option value="">{t('analytics.form.all')}</option>
            {options.services.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="crm-btn crm-btn-primary">
          {t('common.actions.apply')}
        </button>
        {hasFilters(filters) && (
          <a className="crm-btn" href={`?${new URLSearchParams({ range: range.key === 'custom' ? '30d' : range.key, model }).toString()}`}>
            {t('common.actions.clearFilters')}
          </a>
        )}
      </form>

      <Notice tone="blue" title={t('analytics.howTo.title')}>
        {t('analytics.howTo.body')}
      </Notice>

      <h2 className="text-base font-semibold mt-4 mb-2">
        {t(hasFilters(filters) ? 'analytics.kpiHeadingFiltered' : 'analytics.kpiHeading', { range: f.dateRange(prev.from, prev.to) })}
      </h2>
      <KpiGrid i18n={i18n} k={k} p={kPrev} />

      <Card
        title={
          <>
            {t('analytics.platformsCard.title')}
            <Info text={t('analytics.platformsCard.info')} />
          </>
        }
        className="my-4"
      >
        {comparison.some((r) => r.spend !== null) ? (
          <Notice tone="blue" title={t('analytics.platformsCard.manualTitle')}>
            {t('analytics.platformsCard.manualBody')}{' '}
            {admin.can('marketing.spend') && (
              <a href="/admin/ad-spend" className="underline">
                {t('analytics.platformsCard.manageSpend')}
              </a>
            )}
          </Notice>
        ) : (
          <Notice tone="amber" title={t('analytics.costNotConfigured')}>
            {t('analytics.platformsCard.costBody')}{' '}
            {admin.can('marketing.spend') && (
              <a href="/admin/ad-spend" className="underline">
                {t('analytics.platformsCard.manageSpend')}
              </a>
            )}
          </Notice>
        )}
        <div className="overflow-x-auto mt-3">
          <table className="crm-table text-sm min-w-[1100px]">
            <thead>
              <tr>
                {(['platform', 'campaign', 'clicks', 'visits', 'leads', 'starts', 'completed', 'convRate', 'spend', 'cpl', 'cpa', 'revenue', 'roas'] as const).map((h) => (
                  <th key={h} scope="col">
                    {t(`analytics.platformsCard.cols.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.length === 0 && (
                <tr>
                  <td colSpan={13} className="text-zayro-gray">
                    {t('analytics.noData')}
                  </td>
                </tr>
              )}
              {comparison.map((r) => (
                <tr key={`${r.platform}-${r.campaign}`}>
                  <th scope="row" className="font-medium text-left">
                    {platform(r.platform, r.platformLabel)}
                  </th>
                  <td className="break-all">{r.campaign}</td>
                  <td>{num(r.clicks)}</td>
                  <td>{num(r.visits)}</td>
                  <td>{num(r.leads)}</td>
                  <td>{num(r.bookingStarts)}</td>
                  <td>{num(r.completed)}</td>
                  <td>{pct(r.conversionRate)}</td>
                  {r.spend === null ? (
                    <td className="text-zayro-gray" title={t('analytics.costNotConfigured')}>
                      {t('analytics.platformsCard.notConfigured')}
                    </td>
                  ) : (
                    <td title={t('analytics.platformsCard.manualTitle')}>{f.money(r.spend)}</td>
                  )}
                  <td className={r.spend === null || r.leads === 0 ? 'text-zayro-gray' : ''}>{r.spend !== null && r.leads > 0 ? f.money(Math.round(r.spend / r.leads)) : '—'}</td>
                  <td className={r.spend === null || r.completed === 0 ? 'text-zayro-gray' : ''}>{r.spend !== null && r.completed > 0 ? f.money(Math.round(r.spend / r.completed)) : '—'}</td>
                  <td title={r.leadRevenue > 0 ? t('analytics.platformsCard.revenueSplit', { online: f.money(r.revenue), offline: f.money(r.leadRevenue) }) : undefined}>{f.money(r.revenue + r.leadRevenue)}</td>
                  <td className={r.spend ? '' : 'text-zayro-gray'}>{r.spend ? `${f.number((r.revenue + r.leadRevenue) / r.spend, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}×` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <h2 className="text-base font-semibold mt-6 mb-2">{t('analytics.overview.heading')}</h2>
      <section aria-label={t('analytics.overview.label')} className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
        <StatCard label={t('analytics.overview.visitors')} value={num(o.visitors)} hint={t('analytics.overview.visitorsHint')} />
        <StatCard label={t('analytics.overview.sessions')} value={num(o.sessions)} hint={t('analytics.overview.sessionsHint')} />
        <StatCard label={t('analytics.overview.pageViews')} value={num(o.pageViews)} hint={t('analytics.overview.pageViewsHint', { count: o.cookielessPageViews })} />
        <StatCard label={t('analytics.overview.engaged')} value={num(o.engagedSessions)} hint={t('analytics.overview.engagedHint')} />
        <StatCard label={t('analytics.overview.bookingStarts')} value={num(o.bookingStartSessions)} hint={t('analytics.overview.bookingStartsHint', { count: o.cookielessBookingStarts })} />
        <StatCard label={t('analytics.overview.checkouts')} value={num(o.checkouts)} hint={t('analytics.overview.checkoutsHint')} />
        <StatCard label={t('analytics.overview.paid')} value={num(o.paidBookings)} hint={t('analytics.overview.paidHint')} tone="good" />
        <StatCard label={t('analytics.overview.tours')} value={num(o.tours)} hint={t('analytics.overview.toursHint')} />
        <StatCard label={t('analytics.overview.leads')} value={num(o.leads)} hint={t('analytics.overview.leadsHint')} />
        <StatCard label={t('analytics.overview.visitorToPaid')} value={pct(o.rates.visitorToPaid)} hint={t('analytics.overview.visitorToPaidHint')} />
        <StatCard label={t('analytics.overview.startToCheckout')} value={pct(o.rates.startToCheckout)} hint={t('analytics.overview.startToCheckoutHint')} />
        <StatCard label={t('analytics.overview.checkoutToPurchase')} value={pct(o.rates.checkoutToPurchase)} hint={t('analytics.overview.checkoutToPurchaseHint')} />
        <StatCard label={t('analytics.overview.gross')} value={f.money(o.gross)} hint={t('analytics.overview.grossHint')} />
        <StatCard label={t('analytics.overview.refunds')} value={f.money(o.refunds)} hint={t('analytics.overview.refundsHint')} tone={o.refunds ? 'warn' : 'default'} />
        <StatCard label={t('analytics.overview.net')} value={f.money(o.net)} hint={t('analytics.overview.netHint')} />
        <StatCard label={t('analytics.overview.aov')} value={o.averageOrderValue === null ? '—' : f.money(o.averageOrderValue)} hint={t('analytics.overview.aovHint')} />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card
          title={
            <>
              {t('analytics.charts.visitors')}
              <Info text={t('analytics.charts.visitorsInfo')} />
            </>
          }
        >
          <Bars data={seriesLabels} value={(i) => series[i].visitors} label={t('analytics.charts.visitorsAria')} format={num} />
        </Card>
        <Card
          title={
            <>
              {t('analytics.charts.paid')}
              <Info text={t('analytics.charts.paidInfo')} />
            </>
          }
        >
          <Bars data={seriesLabels} value={(i) => series[i].paid} label={t('analytics.charts.paidAria')} format={num} />
        </Card>
        <Card
          title={
            <>
              {t('analytics.charts.revenue')}
              <Info text={t('analytics.charts.revenueInfo')} />
            </>
          }
        >
          <Bars data={seriesLabels} value={(i) => series[i].gross} label={t('analytics.charts.revenueAria')} format={(v) => f.money(v)} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {[
          { key: 'booking', title: t('analytics.funnels.booking'), steps: bookingFunnel },
          { key: 'tour', title: t('analytics.funnels.tour'), steps: tourFunnel },
          { key: 'contact', title: t('analytics.funnels.contact'), steps: contactFunnel },
        ].map((fn) => {
          const max = Math.max(1, ...fn.steps.map((s) => s.value));
          return (
            <Card key={fn.key} title={fn.title}>
              <ol className="space-y-2">
                {fn.steps.map((s) => (
                  <li key={s.key}>
                    <div className="flex justify-between text-sm gap-2">
                      <span className="min-w-0">
                        {t.dynamic(`analytics.funnels.steps.${s.key}.label`, s.label)}
                        <Info text={t.dynamic(`analytics.funnels.steps.${s.key}.definition`, s.definition)} />
                      </span>
                      <span className="tabular-nums font-semibold shrink-0">
                        {num(s.value)} <span className="text-xs text-zayro-gray font-normal">{t.dynamic(`analytics.funnels.population.${s.population}`, s.population)}</span>
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded" aria-hidden="true">
                      <div className="h-2 bg-zayro-primary rounded" style={{ width: `${(s.value / max) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-zayro-gray mt-3">{t('analytics.funnels.footnote')}</p>
            </Card>
          );
        })}
      </div>

      <Card
        title={
          <>
            {t('analytics.bySource.title', { model: modelLabel(model) })}
            <Info text={t('analytics.bySource.info')} />
          </>
        }
        className="mb-4"
      >
        <div className="overflow-x-auto">
          <table className="crm-table text-sm min-w-[900px]">
            <thead>
              <tr>
                {(['source', 'visitors', 'sessions', 'starts', 'checkouts', 'paid', 'tours', 'leads', 'convRate', 'gross', 'refunds', 'net', 'aov'] as const).map((h) => (
                  <th key={h} scope="col">
                    {t(`analytics.bySource.cols.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {platforms.length === 0 && (
                <tr>
                  <td colSpan={13} className="text-zayro-gray">
                    {t('analytics.noData')}
                  </td>
                </tr>
              )}
              {platforms.map((p) => (
                <tr key={p.platform}>
                  <th scope="row" className="font-medium text-left">
                    {platform(p.platform, p.label)}
                  </th>
                  <td>{num(p.visitors)}</td>
                  <td>{num(p.sessions)}</td>
                  <td>{num(p.bookingStarts)}</td>
                  <td>{num(p.checkouts)}</td>
                  <td>{num(p.paidBookings)}</td>
                  <td>{num(p.tours)}</td>
                  <td>{num(p.leads)}</td>
                  <td title={t('analytics.bySource.convRateTitle')}>{pct(p.conversionRate)}</td>
                  <td>{f.money(p.gross)}</td>
                  <td>{f.money(p.refunds)}</td>
                  <td>{f.money(p.net)}</td>
                  <td>{p.averageOrderValue === null ? '—' : f.money(p.averageOrderValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={
          <>
            {t('analytics.byCampaign.title')}
            <Info text={t('analytics.byCampaign.info')} />
          </>
        }
        className="mb-4"
      >
        <div className="overflow-x-auto">
          <table className="crm-table text-sm min-w-[1000px]">
            <thead>
              <tr>
                {(['source', 'medium', 'campaign', 'content', 'landing', 'sessions', 'starts', 'checkouts', 'conversions', 'gross', 'refunds', 'net'] as const).map((h) => (
                  <th key={h} scope="col">
                    {t(`analytics.byCampaign.cols.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-zayro-gray">
                    {t('analytics.noCampaignData')}
                  </td>
                </tr>
              )}
              {campaigns.slice(0, 50).map((c, i) => (
                <tr key={`${c.source}-${c.medium}-${c.campaign}-${c.content}-${c.landingPath}-${i}`}>
                  {/* Source / medium / campaign / content are UTM values: shown as captured, never translated. */}
                  <td>{c.source === 'Other (small)' && c.medium === '—' ? t('analytics.byCampaign.otherSmall') : c.source}</td>
                  <td>{c.medium}</td>
                  <td className="break-all">{c.campaign}</td>
                  <td className="break-all">{c.content}</td>
                  <td className="break-all">{c.landingPath}</td>
                  <td>{num(c.sessions)}</td>
                  <td>{num(c.bookingStarts)}</td>
                  <td>{num(c.checkouts)}</td>
                  <td title={t('analytics.byCampaign.conversionsTitle')}>{num(c.conversions)}</td>
                  <td>{f.money(c.gross)}</td>
                  <td>{f.money(c.refunds)}</td>
                  <td>{f.money(c.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card title={t('analytics.segments.landing')}>
          <SimpleTable i18n={i18n} rows={segments.landing} cols={[t('analytics.segments.landingCol'), t('analytics.segments.sessions'), t('analytics.segments.converted')]} />
        </Card>
        <Card title={t('analytics.segments.services')}>
          <div className="overflow-x-auto">
            <table className="crm-table text-sm [&_th]:whitespace-normal">
              <thead>
                <tr>
                  <th scope="col">{t('analytics.segments.item')}</th>
                  <th scope="col">{t('analytics.segments.category')}</th>
                  <th scope="col">{t('analytics.segments.itemsSold')}</th>
                  <th scope="col">{t('analytics.segments.revenuePreTax')}</th>
                </tr>
              </thead>
              <tbody>
                {o.byService.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-zayro-gray">
                      {t('analytics.noData')}
                    </td>
                  </tr>
                )}
                {o.byService.map((s) => (
                  <tr key={`${s.category}-${s.name}`}>
                    <td>{s.name}</td>
                    <td>{t.dynamic(`analytics.categories.${s.category}`, s.category)}</td>
                    <td>{num(s.items)}</td>
                    <td>{f.money(s.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={t('analytics.segments.device')}>
          <SimpleTable
            i18n={i18n}
            rows={segments.device.map((r) => ({ ...r, label: t.dynamic(`analytics.segments.devices.${r.label}`, r.label) }))}
            cols={[t('analytics.segments.deviceCol'), t('analytics.segments.sessions'), t('analytics.segments.converted')]}
          />
        </Card>
        <Card
          title={
            <>
              {t('analytics.segments.returning')}
              <Info text={t('analytics.segments.returningInfo')} />
            </>
          }
        >
          <SimpleTable
            i18n={i18n}
            rows={segments.returning.map((r) => ({ ...r, label: t.dynamic(`analytics.segments.visitorTypes.${r.label}`, r.label) }))}
            cols={[t('analytics.segments.visitorType'), t('analytics.segments.sessions'), t('analytics.segments.converted')]}
          />
        </Card>
        <Card
          title={
            <>
              {t('analytics.segments.weekday')}
              <Info text={t('analytics.segments.weekdayInfo')} />
            </>
          }
        >
          <div className="crm-table-wrap">
          <table className="crm-table text-sm [&_th]:whitespace-normal">
            <thead>
              <tr>
                <th scope="col">{t('analytics.segments.day')}</th>
                <th scope="col">{t('analytics.segments.sessions')}</th>
                <th scope="col">{t('analytics.segments.paid')}</th>
              </tr>
            </thead>
            <tbody>
              {segments.weekday.map((d) => (
                <tr key={d.label}>
                  <td>{WEEKDAYS.includes(d.label) ? f.weekday(WEEKDAYS.indexOf(d.label)) : d.label}</td>
                  <td>{num(d.sessions)}</td>
                  <td>{num(d.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
        <Card
          title={
            <>
              {t('analytics.segments.hour')}
              <Info text={t('analytics.segments.hourInfo')} />
            </>
          }
        >
          <Bars data={segments.hour.map((h) => ({ key: h.label, label: f.time(`${h.label}:00`) }))} value={(i) => segments.hour[i].paid} label={t('analytics.segments.hourAria')} format={num} />
          <div className="flex justify-between text-xs text-zayro-gray mt-1" aria-hidden="true">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card
          title={
            <>
              {t('analytics.consent.title')}
              <Info text={t('analytics.consent.info')} />
            </>
          }
        >
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {(
              [
                ['choices', diag.choices],
                ['acceptAll', diag.acceptAll],
                ['rejectAll', diag.rejectAll],
                ['custom', diag.custom],
                ['withdraw', diag.withdraw],
                ['analyticsOn', diag.analyticsOn],
                ['advertisingOn', diag.advertisingOn],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-2 border-b border-zayro-border py-1">
                <dt className="text-zayro-gray min-w-0">{t(`analytics.consent.${key}`)}</dt>
                <dd className="font-semibold tabular-nums">{num(Number(value))}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card
          title={
            <>
              {t('analytics.testEvents.title')}
              <Info text={t('analytics.testEvents.info')} />
            </>
          }
        >
          {diag.testDeliveries.length === 0 ? (
            <p className="text-sm text-zayro-gray">{t('analytics.testEvents.empty')}</p>
          ) : (
            <div className="crm-table-wrap">
            <table className="crm-table text-sm [&_th]:whitespace-normal">
              <thead>
                <tr>
                  <th scope="col">{t('analytics.testEvents.destination')}</th>
                  <th scope="col">{t('analytics.testEvents.status')}</th>
                  <th scope="col">{t('analytics.testEvents.count')}</th>
                </tr>
              </thead>
              <tbody>
                {diag.testDeliveries.map((d) => (
                  <tr key={`${d.destination}-${d.status}`}>
                    <td>{destinationName(d.destination, d.destination)}</td>
                    <td>{t.dynamic(`common.status.${d.status}`, d.status)}</td>
                    <td>{num(d.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Card>
      </div>

      <Card title={t('analytics.destinations.title')} actions={admin.can('integrations.retry') ? <AnalyticsRetryButton /> : null} className="mb-4">
        {ownerView && !analyticsOperationalStatus().activeInThisEnvironment && <p className="text-sm font-medium text-amber-800 mb-2">{t('analytics.destinations.vendorsOff')}</p>}
        <p className="text-sm text-zayro-gray mb-3">
          {t('analytics.destinations.note')}
          {!ownerView && ` ${t('analytics.destinations.ownersOnly')}`}
        </p>
        <div className="overflow-x-auto">
          <table className="crm-table text-sm min-w-[760px]">
            <thead>
              <tr>
                {(['destination', 'channel', 'status', 'delivered', 'pending', 'failed', 'skipped', 'last'] as const).map((h) => (
                  <th key={h} scope="col">
                    {t(`analytics.destinations.cols.${h}`)}
                  </th>
                ))}
                {ownerView && <th scope="col">{t('analytics.destinations.cols.error')}</th>}
              </tr>
            </thead>
            <tbody>
              {statuses.map((s) => {
                const rows = health.rows.filter((r) => r.destination === s.destination);
                const count = (st: string[]) => rows.filter((r) => st.includes(r.status)).reduce((a, r) => a + r.n, 0);
                const last = rows.map((r) => r.last_ok).filter(Boolean).sort().pop();
                const err = rows.find((r) => r.last_error)?.last_error;
                return (
                  <tr key={s.destination}>
                    <th scope="row" className="text-left font-medium">
                      {destinationName(s.destination, s.label)}
                    </th>
                    <td>{t(`analytics.destinations.channels.${s.channel}`)}</td>
                    <td>{s.configured ? (s.testMode ? t('analytics.destinations.configuredTest') : t('analytics.destinations.configured')) : t('analytics.destinations.notConfigured')}</td>
                    <td>{num(count(['delivered']))}</td>
                    <td>{num(count(['pending']))}</td>
                    <td>{num(count(['failed', 'dead']))}</td>
                    <td>{num(count(['skipped']))}</td>
                    <td>{last ? f.instant(last) : '—'}</td>
                    {ownerView && <td className="text-xs break-all">{err ?? (s.missing.length ? t('analytics.destinations.missing', { names: s.missing.join(', ') }) : '—')}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-sm mt-3">
          {t('analytics.destinations.dedup', {
            list: health.dedup.map((d) => `${platform(d.platform, d.platform)} ${pct(d.coverage)}`).join(' · '),
            epik: pct(health.missingEpikShare),
          })}
        </p>
      </Card>

      <details className="card !p-4 text-sm">
        <summary className="font-semibold cursor-pointer">{t('analytics.definitions.summary')}</summary>
        <dl className="mt-3 space-y-2">
          {(['visitor', 'session', 'bookingStart', 'checkout', 'paid', 'money', 'attribution', 'dates'] as const).map((key) => (
            <div key={key}>
              <dt className="font-medium">{t(`analytics.definitions.${key}`)}</dt>
              <dd>{t(`analytics.definitions.${key}Text`)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}

function SimpleTable({ i18n, rows, cols }: { i18n: AdminI18n; rows: { label: string; sessions: number; converted: number }[]; cols: [string, string, string] }) {
  const { num } = helpers(i18n);
  return (
    <div className="crm-table-wrap">
    <table className="crm-table text-sm [&_th]:whitespace-normal">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={3} className="text-zayro-gray">
              {i18n.t('analytics.noData')}
            </td>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="break-all">{r.label}</td>
            <td>{num(r.sessions)}</td>
            <td>{num(r.converted)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

function KpiGrid({ i18n, k, p }: { i18n: AdminI18n; k: KpiSet; p: KpiSet }) {
  const { t, f } = i18n;
  const { num, pct, hrs } = helpers(i18n);
  const money = (v: number | null) => (v === null ? '—' : f.money(v));
  return (
    <section aria-label={t('analytics.kpiLabel')} className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-4">
      <Kpi i18n={i18n} label={t('analytics.kpi.visitors')} value={num(k.visitors)} now={k.visitors} before={p.visitors} info={t('analytics.kpi.visitorsInfo')} />
      <Kpi i18n={i18n} label={t('analytics.kpi.sessions')} value={num(k.sessions)} now={k.sessions} before={p.sessions} info={t('analytics.kpi.sessionsInfo')} />
      <Kpi i18n={i18n} label={t('analytics.kpi.newReturning')} value={`${num(k.newVisitors)} / ${num(k.returningVisitors)}`} now={k.newVisitors} before={p.newVisitors} info={t('analytics.kpi.newReturningInfo')} />
      <Kpi i18n={i18n} label={t('analytics.kpi.pageViews')} value={num(k.pageViews)} now={k.pageViews} before={p.pageViews} info={t('analytics.kpi.pageViewsInfo')} />
      <Kpi i18n={i18n} label={t('analytics.kpi.leads')} value={num(k.leads)} now={k.leads} before={p.leads} info={t('analytics.kpi.leadsInfo')} />
      <Kpi i18n={i18n} label={t('analytics.kpi.bookingStarts')} value={num(k.bookingStarts)} now={k.bookingStarts} before={p.bookingStarts} info={t('analytics.kpi.bookingStartsInfo')} />
      <Kpi i18n={i18n} label={t('analytics.kpi.confirmed')} value={num(k.confirmedBookings)} now={k.confirmedBookings} before={p.confirmedBookings} info={t('analytics.kpi.confirmedInfo', { paid: k.paidBookings, tours: k.tours })} tone="good" />
      <Kpi i18n={i18n} label={t('analytics.kpi.cancelled')} value={num(k.cancelledBookings)} now={k.cancelledBookings} before={p.cancelledBookings} info={t('analytics.kpi.cancelledInfo')} invert />
      <Kpi i18n={i18n} label={t('analytics.kpi.abandoned')} value={num(k.abandonedBookings)} now={k.abandonedBookings} before={p.abandonedBookings} info={t('analytics.kpi.abandonedInfo')} invert />
      <Kpi i18n={i18n} label={t('analytics.kpi.gross')} value={f.money(k.gross)} now={k.gross} before={p.gross} info={t('analytics.kpi.grossInfo', { net: f.money(k.net), refunds: f.money(k.refunds) })} money />
      <Kpi i18n={i18n} label={t('analytics.kpi.aov')} value={money(k.averageOrderValue)} now={k.averageOrderValue} before={p.averageOrderValue} info={t('analytics.kpi.aovInfo')} money />
      <Kpi i18n={i18n} label={t('analytics.kpi.conversion')} value={pct(k.conversionRate)} now={k.conversionRate} before={p.conversionRate} info={t('analytics.kpi.conversionInfo')} />
      <Kpi i18n={i18n} label={t('analytics.kpi.leadToBooking')} value={pct(k.leadToBooking)} now={k.leadToBooking} before={p.leadToBooking} info={t('analytics.kpi.leadToBookingInfo')} />
      <Kpi i18n={i18n} label={t('analytics.kpi.timeToPurchase')} value={hrs(k.avgHoursToPurchase)} now={k.avgHoursToPurchase} before={p.avgHoursToPurchase} info={t('analytics.kpi.timeToPurchaseInfo')} invert hours />
      <StatCard label={t('analytics.kpi.cost')} value="—" hint={t('analytics.costNotConfigured')} />
    </section>
  );
}
