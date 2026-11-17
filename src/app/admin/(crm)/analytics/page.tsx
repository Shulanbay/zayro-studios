import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
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

export default async function AnalyticsPage({ searchParams }: { searchParams: { range?: string; from?: string; to?: string; model?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('analytics.read')) return <Forbidden what="marketing analytics" />;

  const range = rangeFrom(searchParams);
  const model: AttributionModel = parseModel(searchParams.model);
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
            <a key={p.key} href={`?${new URLSearchParams({ range: p.key, model }).toString()}`} className={`crm-btn ${range.key === p.key ? 'crm-btn-primary' : ''}`} aria-current={range.key === p.key ? 'true' : undefined}>
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
        <button type="submit" className="crm-btn">
          Apply custom range
        </button>
      </form>

      <Notice tone="blue" title="How to read these numbers">
        Visits are counted only for visitors who allowed analytics cookies; bookings, revenue and refunds include everyone (they come from the booking database, the same as
        the main Dashboard). Revenue by source uses the attribution snapshot taken when each booking was created. Ad spend is not imported, so there is no ROAS — cost data
        unavailable.
      </Notice>

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
