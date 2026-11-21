import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { addDays, formatDateLabel, isDateString, todayInTz } from '@/lib/crm/time';
import { formatCents } from '@/lib/crm/money';
import { Card, Forbidden, Notice, PageHeader, StatCard } from '@/components/crm/ui';
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

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);
const num = (v: number) => v.toLocaleString('en-US');

function presets(today: string) {
  const monthStart = `${today.slice(0, 8)}01`;
  const prevEnd = addDays(monthStart, -1);
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { key: '7d', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { key: '30d', label: 'Last 30 days', from: addDays(today, -29), to: today },
    { key: 'month', label: 'This month', from: monthStart, to: today },
    { key: 'prev', label: 'Previous month', from: `${prevEnd.slice(0, 8)}01`, to: prevEnd },
  ];
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

function Bars({ data, value, label, format = num }: { data: { label: string }[]; value: (i: number) => number; label: string; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((_, i) => value(i)));
  return (
    <div role="img" aria-label={label} className="flex items-end gap-[2px] h-32 w-full overflow-hidden">
      {data.map((d, i) => (
        <div key={d.label} className="flex-1 min-w-[2px] bg-zayro-primary/80 rounded-t-sm" style={{ height: `${(value(i) / max) * 100}%` }} title={`${d.label}: ${format(value(i))}`} />
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

function Delta({ now, before, invert = false, money = false }: { now: number | null; before: number | null; invert?: boolean; money?: boolean }) {
  const c = change(now, before);
  const prev = before === null ? '—' : money ? formatCents(before) : num(before);
  if (c === null) return <span className="text-zayro-gray">no prior data · prev {prev}</span>;
  const good = invert ? c < 0 : c > 0;
  const tone = c === 0 ? 'text-zayro-gray' : good ? 'text-green-700' : 'text-red-700';
  return (
    <span className={tone}>
      {c > 0 ? '▲' : c < 0 ? '▼' : '•'} {(Math.abs(c) * 100).toFixed(Math.abs(c) < 0.1 ? 1 : 0)}% vs previous period · prev {prev}
    </span>
  );
}

function Kpi({ label, value, now, before, info, invert, money, tone }: { label: string; value: string; now: number | null; before: number | null; info: string; invert?: boolean; money?: boolean; tone?: 'good' | 'warn' }) {
  return <StatCard label={label} value={value} tone={tone} hint={<><span className="block">{info}</span><Delta now={now} before={before} invert={invert} money={money} /></>} />;
}

const hrs = (h: number | null) => (h === null ? '—' : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { range?: string; from?: string; to?: string; model?: string; platform?: string; source?: string; campaign?: string; service?: string };
}) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('analytics.read')) return <Forbidden what="marketing analytics" />;

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
  const seriesLabels = series.map((s) => ({ label: s.date }));

  return (
    <>
      <PageHeader
        title="Marketing analytics"
        description={`${formatDateLabel(range.from)} – ${formatDateLabel(range.to)} · studio time (ET) · aggregated, no customer-level data`}
        actions={
          admin.can('analytics.export') ? (
            <a className="crm-btn" href={`/api/admin/analytics/export?${new URLSearchParams({ from: range.from, to: range.to, model }).toString()}`} download>
              Export CSV
            </a>
          ) : null
        }
      />

      <form method="get" className="card !p-4 mb-4 flex flex-wrap items-end gap-2" aria-label="Date range and attribution model">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Date range presets">
          {presets(todayInTz()).map((p) => (
            <a key={p.key} href={`?${new URLSearchParams({ range: p.key, model, ...(filters.platform ? { platform: filters.platform } : {}), ...(filters.source ? { source: filters.source } : {}), ...(filters.campaign ? { campaign: filters.campaign } : {}), ...(filters.serviceId ? { service: String(filters.serviceId) } : {}) }).toString()}`} className={`crm-btn ${range.key === p.key ? 'crm-btn-primary' : ''}`} aria-current={range.key === p.key ? 'true' : undefined}>
              {p.label}
            </a>
          ))}
        </div>
        <div>
          <label className="field-label" htmlFor="from">
            From
          </label>
          <input id="from" type="date" name="from" defaultValue={range.from} />
        </div>
        <div>
          <label className="field-label" htmlFor="to">
            To
          </label>
          <input id="to" type="date" name="to" defaultValue={range.to} />
        </div>
        <div>
          <label className="field-label" htmlFor="model">
            Attribution model
          </label>
          <select id="model" name="model" defaultValue={model}>
            {Object.entries(ATTRIBUTION_MODELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="platform">
            Ad platform
          </label>
          <select id="platform" name="platform" defaultValue={filters.platform ?? ''}>
            <option value="">All</option>
            {Object.entries(PLATFORM_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="source">
            Traffic source
          </label>
          <select id="source" name="source" defaultValue={filters.source ?? ''}>
            <option value="">All</option>
            {options.sources.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="campaign">
            Campaign
          </label>
          <select id="campaign" name="campaign" defaultValue={filters.campaign ?? ''}>
            <option value="">All</option>
            {options.campaigns.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="service">
            Service
          </label>
          <select id="service" name="service" defaultValue={filters.serviceId ? String(filters.serviceId) : ''}>
            <option value="">All</option>
            {options.services.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="crm-btn crm-btn-primary">
          Apply
        </button>
        {hasFilters(filters) && (
          <a className="crm-btn" href={`?${new URLSearchParams({ range: range.key === 'custom' ? '30d' : range.key, model }).toString()}`}>
            Clear filters
          </a>
        )}
      </form>

      <Notice tone="blue" title="How to read these numbers">
        Visits are counted only for visitors who allowed analytics cookies; bookings, revenue and refunds include everyone (they come from the booking database, the same as
        the main Dashboard). Revenue by source uses the attribution snapshot taken when each booking was created. Filters apply to the KPI cards and the platform table.
        Ad spend is not imported, so there is no cost per lead, cost per booking or ROAS.
      </Notice>

      <h2 className="text-base font-semibold mt-4 mb-2">
        KPIs{hasFilters(filters) ? ' (filtered)' : ''} · compared with {formatDateLabel(prev.from)} – {formatDateLabel(prev.to)}
      </h2>
      <KpiGrid k={k} p={kPrev} />

      <Card
        title={<>Advertising platforms &amp; campaigns<Info text="Clicks = sessions that arrived with that platform's ad click ID. Visits, leads and starts from consented sessions; completed bookings and revenue from the booking attribution snapshot (chosen model)." /></>}
        className="my-4"
      >
        <Notice tone="amber" title="Ad cost integration not configured">
          No ad platform spend is imported yet, so spend, cost per lead, cost per booking and ROAS are not shown (they are never estimated). To add them, connect
          each platform&apos;s reporting API (Google Ads API, Meta Marketing API, TikTok Business API, Reddit Ads API, X Ads API) — see ANALYTICS_SETUP.md → “Ad cost
          integration”.
        </Notice>
        <div className="overflow-x-auto mt-3">
          <table className="crm-table text-sm min-w-[1100px]">
            <thead>
              <tr>
                {['Platform', 'Campaign', 'Clicks', 'Visits', 'Leads', 'Booking starts', 'Completed', 'Conv. rate', 'Ad spend', 'Cost / lead', 'Cost / booking', 'Revenue', 'ROAS'].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.length === 0 && (
                <tr>
                  <td colSpan={13} className="text-zayro-gray">
                    No data in this range yet.
                  </td>
                </tr>
              )}
              {comparison.map((r) => (
                <tr key={`${r.platform}-${r.campaign}`}>
                  <th scope="row" className="font-medium text-left">
                    {r.platformLabel}
                  </th>
                  <td className="break-all">{r.campaign}</td>
                  <td>{num(r.clicks)}</td>
                  <td>{num(r.visits)}</td>
                  <td>{num(r.leads)}</td>
                  <td>{num(r.bookingStarts)}</td>
                  <td>{num(r.completed)}</td>
                  <td>{pct(r.conversionRate)}</td>
                  <td className="text-zayro-gray" title="Ad cost integration not configured">
                    not configured
                  </td>
                  <td className="text-zayro-gray">—</td>
                  <td className="text-zayro-gray">—</td>
                  <td>{formatCents(r.revenue)}</td>
                  <td className="text-zayro-gray">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <h2 className="text-base font-semibold mt-6 mb-2">Overview (all traffic, unfiltered)</h2>
      <section aria-label="Overview" className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
        <StatCard label="Unique visitors" value={num(o.visitors)} hint="Distinct consented anonymous visitors" />
        <StatCard label="Sessions" value={num(o.sessions)} hint="30 min inactivity ends a session" />
        <StatCard label="Page views" value={num(o.pageViews)} hint={`incl. ${num(o.cookielessPageViews)} without analytics consent`} />
        <StatCard label="Engaged sessions" value={num(o.engagedSessions)} hint="2+ pages or 10+ s active" />
        <StatCard label="Booking starts" value={num(o.bookingStartSessions)} hint={`sessions; +${num(o.cookielessBookingStarts)} without consent`} />
        <StatCard label="Checkout starts" value={num(o.checkouts)} hint="Stripe Checkout created by the server" />
        <StatCard label="Paid bookings" value={num(o.paidBookings)} hint="Confirmed by successful Stripe payment" tone="good" />
        <StatCard label="Studio tours" value={num(o.tours)} hint="Free tours confirmed (by booking date)" />
        <StatCard label="Contact leads" value={num(o.leads)} hint="Accepted contact form messages" />
        <StatCard label="Visitor → paid booking" value={pct(o.rates.visitorToPaid)} hint="Paid bookings with a consented visit ÷ unique visitors" />
        <StatCard label="Booking start → checkout" value={pct(o.rates.startToCheckout)} hint="Sessions with checkout ÷ sessions with booking start" />
        <StatCard label="Checkout → purchase" value={pct(o.rates.checkoutToPurchase)} hint="Checkouts in range that were paid ÷ checkouts" />
        <StatCard label="Gross revenue" value={formatCents(o.gross)} hint="Collected purchase totals (incl. tax), by purchase date" />
        <StatCard label="Refunds" value={formatCents(o.refunds)} hint="Succeeded refunds, by refund date" tone={o.refunds ? 'warn' : 'default'} />
        <StatCard label="Net revenue" value={formatCents(o.net)} hint="Gross − refunds (same as Dashboard)" />
        <StatCard label="Average order value" value={o.averageOrderValue === null ? '—' : formatCents(o.averageOrderValue)} hint="Booking revenue ÷ paid bookings (extensions excluded)" />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card title={<>Visitors over time<Info text="Distinct consented visitors per day (ET)." /></>}>
          <Bars data={seriesLabels} value={(i) => series[i].visitors} label="Visitors per day" />
        </Card>
        <Card title={<>Paid conversions over time<Info text="Paid bookings per purchase day (ET)." /></>}>
          <Bars data={seriesLabels} value={(i) => series[i].paid} label="Paid bookings per day" />
        </Card>
        <Card title={<>Revenue over time<Info text="Gross collected revenue per purchase day (ET)." /></>}>
          <Bars data={seriesLabels} value={(i) => series[i].gross} label="Gross revenue per day" format={(v) => formatCents(v)} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {[
          { title: 'Booking funnel', steps: bookingFunnel },
          { title: 'Studio tour funnel', steps: tourFunnel },
          { title: 'Contact funnel', steps: contactFunnel },
        ].map((f) => {
          const max = Math.max(1, ...f.steps.map((s) => s.value));
          return (
            <Card key={f.title} title={f.title}>
              <ol className="space-y-2">
                {f.steps.map((s) => (
                  <li key={s.key}>
                    <div className="flex justify-between text-sm gap-2">
                      <span>
                        {s.label}
                        <Info text={s.definition} />
                      </span>
                      <span className="tabular-nums font-semibold">
                        {num(s.value)} <span className="text-xs text-zayro-gray font-normal">{s.population}</span>
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded" aria-hidden="true">
                      <div className="h-2 bg-zayro-primary rounded" style={{ width: `${(s.value / max) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-zayro-gray mt-3">Steps count different populations (sessions, bookings, purchases); compare neighbours of the same kind only.</p>
            </Card>
          );
        })}
      </div>

      <Card title={<>Revenue by source · {ATTRIBUTION_MODELS[model].label}<Info text="Visits by session source; bookings and money by the chosen attribution model of the booking snapshot. Cost data unavailable — no ROAS." /></>} className="mb-4">
        <div className="overflow-x-auto">
          <table className="crm-table text-sm min-w-[900px]">
            <thead>
              <tr>
                {['Source', 'Visitors', 'Sessions', 'Booking starts', 'Checkouts', 'Paid bookings', 'Tours', 'Leads', 'Conv. rate', 'Gross', 'Refunds', 'Net', 'AOV'].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {platforms.length === 0 && (
                <tr>
                  <td colSpan={13} className="text-zayro-gray">
                    No data in this range yet.
                  </td>
                </tr>
              )}
              {platforms.map((p) => (
                <tr key={p.platform}>
                  <th scope="row" className="font-medium text-left">
                    {p.label}
                  </th>
                  <td>{num(p.visitors)}</td>
                  <td>{num(p.sessions)}</td>
                  <td>{num(p.bookingStarts)}</td>
                  <td>{num(p.checkouts)}</td>
                  <td>{num(p.paidBookings)}</td>
                  <td>{num(p.tours)}</td>
                  <td>{num(p.leads)}</td>
                  <td title="Paid bookings ÷ sessions">{pct(p.conversionRate)}</td>
                  <td>{formatCents(p.gross)}</td>
                  <td>{formatCents(p.refunds)}</td>
                  <td>{formatCents(p.net)}</td>
                  <td>{p.averageOrderValue === null ? '—' : formatCents(p.averageOrderValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={<>Revenue by campaign<Info text={`Rows with fewer than 3 sessions and no conversions are grouped into “Other (small)”.`} /></>} className="mb-4">
        <div className="overflow-x-auto">
          <table className="crm-table text-sm min-w-[1000px]">
            <thead>
              <tr>
                {['Source', 'Medium', 'Campaign', 'Content / creative', 'Landing page', 'Sessions', 'Booking starts', 'Checkouts', 'Conversions', 'Gross', 'Refunds', 'Net'].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-zayro-gray">
                    No campaign data in this range yet.
                  </td>
                </tr>
              )}
              {campaigns.slice(0, 50).map((c, i) => (
                <tr key={`${c.source}-${c.medium}-${c.campaign}-${c.content}-${c.landingPath}-${i}`}>
                  <td>{c.source}</td>
                  <td>{c.medium}</td>
                  <td className="break-all">{c.campaign}</td>
                  <td className="break-all">{c.content}</td>
                  <td className="break-all">{c.landingPath}</td>
                  <td>{num(c.sessions)}</td>
                  <td>{num(c.bookingStarts)}</td>
                  <td>{num(c.checkouts)}</td>
                  <td title="Paid bookings + confirmed tours">{num(c.conversions)}</td>
                  <td>{formatCents(c.gross)}</td>
                  <td>{formatCents(c.refunds)}</td>
                  <td>{formatCents(c.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card title="Landing pages">
          <SimpleTable rows={segments.landing} cols={['Landing page', 'Sessions', 'Converted sessions']} />
        </Card>
        <Card title="Service / package performance">
          <table className="crm-table text-sm">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Category</th>
                <th scope="col">Items sold</th>
                <th scope="col">Revenue (pre-tax)</th>
              </tr>
            </thead>
            <tbody>
              {o.byService.map((s) => (
                <tr key={`${s.category}-${s.name}`}>
                  <td>{s.name}</td>
                  <td>{s.category}</td>
                  <td>{num(s.items)}</td>
                  <td>{formatCents(s.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Device category">
          <SimpleTable rows={segments.device} cols={['Device', 'Sessions', 'Converted sessions']} />
        </Card>
        <Card title={<>New vs returning<Info text="Returning = this browser had an earlier consented session (first-party cookie only; no fingerprinting)." /></>}>
          <SimpleTable rows={segments.returning} cols={['Visitor type', 'Sessions', 'Converted sessions']} />
        </Card>
        <Card title={<>Conversion by weekday<Info text="Paid bookings by purchase weekday (ET) and sessions by visit weekday." /></>}>
          <table className="crm-table text-sm">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Sessions</th>
                <th scope="col">Paid bookings</th>
              </tr>
            </thead>
            <tbody>
              {segments.weekday.map((d) => (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <td>{num(d.sessions)}</td>
                  <td>{num(d.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title={<>Conversion by hour<Info text="Paid bookings by purchase hour (ET)." /></>}>
          <Bars data={segments.hour} value={(i) => segments.hour[i].paid} label="Paid bookings by hour of day" />
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
        <Card title={<>Consent choices in this period<Info text="Banner decisions recorded server-side (counts only). The visitor's current state lives in their own cookie." /></>}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {[
              ['Choices recorded', diag.choices],
              ['Accept all', diag.acceptAll],
              ['Reject non-essential', diag.rejectAll],
              ['Customized', diag.custom],
              ['Withdrawn', diag.withdraw],
              ['Analytics allowed', diag.analyticsOn],
              ['Advertising allowed', diag.advertisingOn],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between gap-2 border-b border-zayro-border py-1">
                <dt className="text-zayro-gray">{label}</dt>
                <dd className="font-semibold tabular-nums">{num(Number(value))}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title={<>Test events sent<Info text="Deliveries made while a platform's test mode was on (Meta / TikTok test event codes, Reddit / Pinterest test mode, GA4 debug)." /></>}>
          {diag.testDeliveries.length === 0 ? (
            <p className="text-sm text-zayro-gray">No test-mode deliveries in this period. Turn on a platform&apos;s test mode (see ANALYTICS_SETUP.md) and make a test booking to see them here.</p>
          ) : (
            <table className="crm-table text-sm">
              <thead>
                <tr>
                  <th scope="col">Destination</th>
                  <th scope="col">Status</th>
                  <th scope="col">Count</th>
                </tr>
              </thead>
              <tbody>
                {diag.testDeliveries.map((t) => (
                  <tr key={`${t.destination}-${t.status}`}>
                    <td>{t.destination}</td>
                    <td>{t.status}</td>
                    <td>{num(t.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Destinations and delivery health" actions={admin.can('integrations.retry') ? <AnalyticsRetryButton /> : null} className="mb-4">
        {ownerView && !analyticsOperationalStatus().activeInThisEnvironment && (
          <p className="text-sm font-medium text-amber-800 mb-2">External delivery is off (ANALYTICS_VENDORS_ENABLED or environment) — configured destinations receive nothing.</p>
        )}
        <p className="text-sm text-zayro-gray mb-3">
          Configured / not configured only — secret values are never shown. Advanced matching (hashed email/phone) is disabled for every platform.
          {!ownerView && ' Error details are visible to owners.'}
        </p>
        <div className="overflow-x-auto">
          <table className="crm-table text-sm min-w-[760px]">
            <thead>
              <tr>
                <th scope="col">Destination</th>
                <th scope="col">Channel</th>
                <th scope="col">Status</th>
                <th scope="col">Delivered</th>
                <th scope="col">Pending</th>
                <th scope="col">Failed</th>
                <th scope="col">Skipped</th>
                <th scope="col">Last delivery</th>
                {ownerView && <th scope="col">Last error / missing</th>}
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
                      {s.label}
                    </th>
                    <td>{s.channel}</td>
                    <td>{s.configured ? (s.testMode ? 'Configured · test mode' : 'Configured') : 'Not configured'}</td>
                    <td>{num(count(['delivered']))}</td>
                    <td>{num(count(['pending']))}</td>
                    <td>{num(count(['failed', 'dead']))}</td>
                    <td>{num(count(['skipped']))}</td>
                    <td>{last ? last.slice(0, 16) : '—'}</td>
                    {ownerView && <td className="text-xs break-all">{err ?? (s.missing.length ? `Missing: ${s.missing.join(', ')}` : '—')}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-sm mt-3">
          Browser/server deduplication coverage (server conversions also seen by the pixel with the same event ID):{' '}
          {health.dedup.map((d) => `${d.platform} ${pct(d.coverage)}`).join(' · ')}. Paid bookings without a Pinterest click ID: {pct(health.missingEpikShare)}.
        </p>
      </Card>

      <details className="card !p-4 text-sm">
        <summary className="font-semibold cursor-pointer">Metric definitions</summary>
        <dl className="mt-3 space-y-2">
          <dt className="font-medium">Unique visitor</dt>
          <dd>A distinct first-party anonymous visitor (random cookie, set only after analytics consent) with a session in the range.</dd>
          <dt className="font-medium">Session</dt>
          <dd>One visit; 30 minutes without activity, or arriving from a new campaign or ad click, starts a new session.</dd>
          <dt className="font-medium">Booking start</dt>
          <dd>The first booking interaction per session (booking_started).</dd>
          <dt className="font-medium">Checkout</dt>
          <dd>A Stripe Checkout session the server successfully created — not a button click.</dd>
          <dt className="font-medium">Paid booking</dt>
          <dd>A booking confirmed by a successful Stripe payment (signature-verified webhook), counted on its purchase date.</dd>
          <dt className="font-medium">Gross / refunds / net</dt>
          <dd>Collected purchase totals incl. tax by purchase date; succeeded refunds by refund date; net = gross − refunds. Identical to the main Dashboard. Extensions count as revenue of the original booking’s source.</dd>
          <dt className="font-medium">Attribution</dt>
          <dd>
            First touch = the visitor’s first session; last non-direct = latest non-direct session within the attribution window (default 90 days), never replaced by a
            later direct visit; conversion touch = the session in which the booking was created. Snapshots are never rewritten (reschedules don’t create new acquisitions).
          </dd>
          <dt className="font-medium">Dates</dt>
          <dd>Visits use the visit date; money uses the purchase or refund date; all in America/New_York.</dd>
        </dl>
      </details>
    </>
  );
}

function SimpleTable({ rows, cols }: { rows: { label: string; sessions: number; converted: number }[]; cols: [string, string, string] }) {
  return (
    <table className="crm-table text-sm">
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
              No data in this range yet.
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
  );
}

function KpiGrid({ k, p }: { k: KpiSet; p: KpiSet }) {
  return (
    <section aria-label="KPIs" className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <Kpi label="Unique visitors" value={num(k.visitors)} now={k.visitors} before={p.visitors} info="Distinct consented visitors" />
      <Kpi label="Sessions" value={num(k.sessions)} now={k.sessions} before={p.sessions} info="30 min inactivity ends a session" />
      <Kpi label="New / returning visitors" value={`${num(k.newVisitors)} / ${num(k.returningVisitors)}`} now={k.newVisitors} before={p.newVisitors} info="Change shown for new visitors" />
      <Kpi label="Page views" value={num(k.pageViews)} now={k.pageViews} before={p.pageViews} info="Consented sessions" />
      <Kpi label="Leads" value={num(k.leads)} now={k.leads} before={p.leads} info="Contact forms accepted by the server" />
      <Kpi label="Booking starts" value={num(k.bookingStarts)} now={k.bookingStarts} before={p.bookingStarts} info="Sessions that started booking" />
      <Kpi label="Confirmed bookings" value={num(k.confirmedBookings)} now={k.confirmedBookings} before={p.confirmedBookings} info={`${num(k.paidBookings)} paid + ${num(k.tours)} free tours`} tone="good" />
      <Kpi label="Cancelled bookings" value={num(k.cancelledBookings)} now={k.cancelledBookings} before={p.cancelledBookings} info="Cancelled after being confirmed" invert />
      <Kpi label="Abandoned checkouts" value={num(k.abandonedBookings)} now={k.abandonedBookings} before={p.abandonedBookings} info="Stripe Checkout started, never paid" invert />
      <Kpi label="Revenue (gross)" value={formatCents(k.gross)} now={k.gross} before={p.gross} info={`Net ${formatCents(k.net)} after ${formatCents(k.refunds)} refunds`} money />
      <Kpi label="Average booking value" value={k.averageOrderValue === null ? '—' : formatCents(k.averageOrderValue)} now={k.averageOrderValue} before={p.averageOrderValue} info="Booking revenue ÷ paid bookings" money />
      <Kpi label="Conversion rate" value={pct(k.conversionRate)} now={k.conversionRate} before={p.conversionRate} info="Paid bookings ÷ sessions" />
      <Kpi label="Lead → booking" value={pct(k.leadToBooking)} now={k.leadToBooking} before={p.leadToBooking} info="Paid bookings ÷ (Checkout starts + contact leads)" />
      <Kpi label="Avg time to purchase" value={hrs(k.avgHoursToPurchase)} now={k.avgHoursToPurchase} before={p.avgHoursToPurchase} info="First recorded visit → payment (attributed bookings)" invert />
      <StatCard label="Cost per lead / per booking / ROAS" value="—" hint="Ad cost integration not configured" />
    </section>
  );
}
