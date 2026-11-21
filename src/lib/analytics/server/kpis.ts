import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rowsOf } from '@/lib/db/types';
import { addDays, daysBetween, wallTimeToUtc } from '@/lib/crm/time';
import type { DateRange } from '@/lib/crm/metrics';
import { PLATFORM_LABELS, type Platform } from '../attribution';
import { ATTRIBUTION_MODELS, type AttributionModel } from './metrics';

/**
 * KPI cards and the platform / campaign comparison for /admin/analytics,
 * with filters (platform, source, campaign, service) and the previous
 * period for comparison. Aggregates only — no customer data leaves this
 * module.
 *
 * Definitions (the dashboard shows each one as a tooltip):
 *  - Traffic (visitors, sessions, new / returning, page views, booking
 *    starts, leads) counts consented visits, filtered by the session's own
 *    platform / source / campaign. A service filter keeps sessions that
 *    viewed or selected that service.
 *  - Bookings, revenue, cancellations and abandonments come from the
 *    booking database (everyone, consent or not), filtered by the booking's
 *    attribution snapshot (chosen model) and the booked service.
 *  - Ad spend is not imported from any platform yet, so cost per lead,
 *    cost per booking and ROAS are not computed (never invented).
 */

export interface KpiFilters {
  platform?: string;
  source?: string;
  campaign?: string;
  serviceId?: number;
}

/** Cleans filter values from the query string (allowlisted characters, bounded length). */
export function parseFilters(sp: { platform?: string; source?: string; campaign?: string; service?: string }): KpiFilters {
  const clean = (v: string | undefined) => {
    const s = (v ?? '').trim();
    return s && s.length <= 150 && /^[A-Za-z0-9 _.:/&+()'-]+$/.test(s) ? s : undefined;
  };
  const service = Number(sp.service);
  return {
    platform: sp.platform && sp.platform in PLATFORM_LABELS ? sp.platform : undefined,
    source: clean(sp.source)?.toLowerCase(),
    campaign: clean(sp.campaign),
    serviceId: Number.isInteger(service) && service > 0 ? service : undefined,
  };
}

export function hasFilters(f: KpiFilters): boolean {
  return !!(f.platform || f.source || f.campaign || f.serviceId);
}

/** The period of the same length immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const days = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

/** Relative change, or null when there is nothing to compare against. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

const n = (v: unknown) => Number(v ?? 0) || 0;

function bounds(range: DateRange) {
  return { start: wallTimeToUtc(range.from, '00:00'), end: wallTimeToUtc(addDays(range.to, 1), '00:00') };
}

/** A jsonb column that may hold a double-encoded JSON string on older rows, as an object. */
const asObject = (expr: string) => sql.raw(`(CASE WHEN jsonb_typeof(${expr}) = 'string' THEN (${expr} #>> '{}')::jsonb ELSE ${expr} END)`);

/** Session-level filter (alias s = analytics_sessions). */
function sessionFilter(f: KpiFilters): SQL {
  const parts: SQL[] = [sql`true`];
  if (f.platform) parts.push(sql`s.platform = ${f.platform}`);
  if (f.source) parts.push(sql`lower(s.session_source) = ${f.source}`);
  if (f.campaign) parts.push(sql`s.session_campaign = ${f.campaign}`);
  if (f.serviceId) {
    parts.push(sql`EXISTS (SELECT 1 FROM analytics_events se WHERE se.session_id = s.id AND se.event_name IN ('view_item', 'service_selected')
                           AND ${asObject('se.properties')}->>'service_id' = ${String(f.serviceId)})`);
  }
  return sql.join(parts, sql` AND `);
}

/** Attribution filter on a booking id expression (uses the chosen model's touch). */
function bookingFilter(f: KpiFilters, model: AttributionModel, bookingIdExpr: SQL): SQL {
  const parts: SQL[] = [sql`true`];
  if (f.platform || f.source || f.campaign) {
    const t = asObject(`fa.${ATTRIBUTION_MODELS[model].column}`);
    const inner: SQL[] = [sql`fa.booking_id = ${bookingIdExpr}`];
    if (f.platform) inner.push(sql`${t}->>'platform' = ${f.platform}`);
    if (f.source) inner.push(sql`lower(${t}->>'source') = ${f.source}`);
    if (f.campaign) inner.push(sql`${t}->>'campaign' = ${f.campaign}`);
    parts.push(sql`EXISTS (SELECT 1 FROM analytics_attributions fa WHERE ${sql.join(inner, sql` AND `)})`);
  }
  if (f.serviceId) parts.push(sql`EXISTS (SELECT 1 FROM bookings fb WHERE fb.id = ${bookingIdExpr} AND fb.service_id = ${f.serviceId})`);
  return sql.join(parts, sql` AND `);
}

export interface KpiSet {
  visitors: number;
  newVisitors: number;
  returningVisitors: number;
  sessions: number;
  pageViews: number;
  leads: number;
  bookingStarts: number;
  checkouts: number;
  paidBookings: number;
  tours: number;
  confirmedBookings: number;
  cancelledBookings: number;
  abandonedBookings: number;
  gross: number;
  refunds: number;
  net: number;
  averageOrderValue: number | null;
  conversionRate: number | null;
  leadToBooking: number | null;
  avgHoursToPurchase: number | null;
}

export async function kpis(range: DateRange, model: AttributionModel, f: KpiFilters = {}): Promise<KpiSet> {
  const { start, end } = bounds(range);
  const sf = sessionFilter(f);
  const [traffic] = rowsOf<Record<string, number>>(
    await db.execute(sql`
      WITH s AS (SELECT s.* FROM analytics_sessions s WHERE s.started_at >= ${start} AND s.started_at < ${end} AND ${sf})
      SELECT count(*)::int AS sessions, count(DISTINCT visitor_id)::int AS visitors,
             count(DISTINCT visitor_id) FILTER (WHERE NOT is_returning)::int AS new_visitors,
             count(DISTINCT visitor_id) FILTER (WHERE is_returning)::int AS returning_visitors,
             (SELECT count(*) FROM analytics_events e WHERE e.event_name = 'page_view' AND e.session_id IN (SELECT id FROM s))::int AS page_views,
             (SELECT count(DISTINCT e.session_id) FROM analytics_events e WHERE e.event_name = 'booking_started' AND e.session_id IN (SELECT id FROM s))::int AS booking_starts
        FROM s`)
  );
  // Leads and checkouts are server events (everyone); with a traffic filter they follow the session / attribution.
  const trafficFiltered = !!(f.platform || f.source || f.campaign);
  const leadScope = trafficFiltered || f.serviceId ? sql`e.session_id IN (SELECT s.id FROM analytics_sessions s WHERE ${sf})` : sql`true`;
  const [server] = rowsOf<Record<string, number>>(
    await db.execute(sql`
      SELECT count(*) FILTER (WHERE e.event_name = 'contact_submitted' AND ${leadScope})::int AS leads,
             count(*) FILTER (WHERE e.event_name = 'checkout_created' AND ${bookingFilter(f, model, sql`e.booking_id`)})::int AS checkouts
        FROM analytics_events e
       WHERE e.event_name IN ('contact_submitted', 'checkout_created') AND e.occurred_at >= ${start} AND e.occurred_at < ${end}`)
  );
  const [money] = rowsOf<Record<string, number>>(
    await db.execute(sql`
      WITH p AS (
        SELECT p.id, p.type, p.total_cents, p.purchased_at,
               coalesce((SELECT b.id FROM bookings b WHERE b.purchase_id = p.id LIMIT 1),
                        (SELECT x.booking_id FROM booking_extensions x WHERE x.purchase_id = p.id LIMIT 1)) AS booking_id
          FROM purchases p
         WHERE p.status IN ('paid', 'partially_refunded', 'refunded') AND p.purchased_at >= ${start} AND p.purchased_at < ${end}
      )
      SELECT count(*) FILTER (WHERE p.type = 'individual' AND p.total_cents > 0)::int AS paid,
             coalesce(sum(p.total_cents), 0)::int AS gross,
             coalesce(sum(p.total_cents) FILTER (WHERE p.type = 'individual' AND p.total_cents > 0), 0)::int AS booking_rev,
             avg(extract(epoch FROM (p.purchased_at - (${asObject('a.first_touch')}->>'at')::timestamptz)) / 3600.0)
               FILTER (WHERE p.type = 'individual' AND a.first_touch IS NOT NULL) AS hours_to_purchase
        FROM p LEFT JOIN analytics_attributions a ON a.booking_id = p.booking_id
       WHERE ${hasFilters(f) ? sql`p.booking_id IS NOT NULL AND ${bookingFilter(f, model, sql`p.booking_id`)}` : sql`true`}`)
  );
  const [refunds] = rowsOf<{ refunds: number }>(
    await db.execute(sql`
      WITH r AS (
        SELECT r.amount_cents, coalesce(r.booking_id, (SELECT b.id FROM bookings b WHERE b.purchase_id = r.purchase_id LIMIT 1)) AS booking_id
          FROM refunds r WHERE r.status = 'succeeded' AND r.created_at >= ${start} AND r.created_at < ${end}
      )
      SELECT coalesce(sum(amount_cents), 0)::int AS refunds FROM r
       WHERE ${hasFilters(f) ? sql`r.booking_id IS NOT NULL AND ${bookingFilter(f, model, sql`r.booking_id`)}` : sql`true`}`)
  );
  const [book] = rowsOf<Record<string, number>>(
    await db.execute(sql`
      SELECT count(*) FILTER (WHERE s.category = 'tour' AND b.status IN ('confirmed', 'completed', 'no_show') AND b.created_at >= ${start} AND b.created_at < ${end})::int AS tours,
             -- Cancelled after being confirmed (paid, free tour or staff booking).
             count(*) FILTER (WHERE b.status = 'cancelled' AND b.payment_status NOT IN ('pending', 'failed') AND b.cancelled_at >= ${start} AND b.cancelled_at < ${end})::int AS cancelled,
             -- Started Checkout that ended unpaid (expired, failed or left).
             count(*) FILTER (WHERE b.status = 'cancelled' AND b.payment_status IN ('pending', 'failed') AND b.stripe_session_id IS NOT NULL AND b.cancelled_at >= ${start} AND b.cancelled_at < ${end})::int AS abandoned
        FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE ${bookingFilter(f, model, sql`b.id`)}`)
  );

  const paid = n(money?.paid);
  const tours = n(book?.tours);
  const sessions = n(traffic?.sessions);
  const leads = n(server?.leads);
  const checkouts = n(server?.checkouts);
  const gross = n(money?.gross);
  const ref = n(refunds?.refunds);
  const hours = money?.hours_to_purchase === null || money?.hours_to_purchase === undefined ? null : Number(money.hours_to_purchase);
  return {
    visitors: n(traffic?.visitors),
    newVisitors: n(traffic?.new_visitors),
    returningVisitors: n(traffic?.returning_visitors),
    sessions,
    pageViews: n(traffic?.page_views),
    leads,
    bookingStarts: n(traffic?.booking_starts),
    checkouts,
    paidBookings: paid,
    tours,
    confirmedBookings: paid + tours,
    cancelledBookings: n(book?.cancelled),
    abandonedBookings: n(book?.abandoned),
    gross,
    refunds: ref,
    net: gross - ref,
    averageOrderValue: paid > 0 ? Math.round(n(money?.booking_rev) / paid) : null,
    conversionRate: sessions > 0 ? Math.min(1, paid / sessions) : null,
    leadToBooking: leads + checkouts > 0 ? Math.min(1, paid / (leads + checkouts)) : null,
    avgHoursToPurchase: hours !== null && Number.isFinite(hours) && hours >= 0 ? hours : null,
  };
}

export interface ComparisonRow {
  platform: string;
  platformLabel: string;
  campaign: string;
  clicks: number;
  visits: number;
  leads: number;
  bookingStarts: number;
  completed: number;
  conversionRate: number | null;
  revenue: number;
  /** Always null until an ad-cost integration exists: spend, CPL, cost per booking and ROAS are never estimated. */
  spend: null;
}

/**
 * One row per (platform, campaign): clicks = sessions that arrived with that
 * platform's ad click ID, visits = sessions, leads / starts from those
 * sessions, completed bookings and revenue from the booking attribution
 * snapshot (chosen model).
 */
export async function platformComparison(range: DateRange, model: AttributionModel, f: KpiFilters = {}): Promise<ComparisonRow[]> {
  const { start, end } = bounds(range);
  const t = asObject(`a.${ATTRIBUTION_MODELS[model].column}`);
  const traffic = rowsOf<Record<string, any>>(
    await db.execute(sql`
      SELECT s.platform AS platform, coalesce(s.session_campaign, '') AS campaign, count(*)::int AS visits,
             count(*) FILTER (WHERE s.click_id_types IS NOT NULL AND s.click_id_types <> '')::int AS clicks,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'booking_started'))::int AS starts,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'contact_submitted'))::int AS leads
        FROM analytics_sessions s WHERE s.started_at >= ${start} AND s.started_at < ${end} AND ${sessionFilter(f)}
       GROUP BY 1, 2`)
  );
  const conv = rowsOf<Record<string, any>>(
    await db.execute(sql`
      WITH done AS (
        SELECT b.id AS booking_id, coalesce(p.total_cents, 0) AS cents
          FROM bookings b JOIN services sv ON sv.id = b.service_id LEFT JOIN purchases p ON p.id = b.purchase_id
         WHERE b.status IN ('confirmed', 'completed', 'no_show') AND b.created_at >= ${start} AND b.created_at < ${end}
           AND (sv.category = 'tour' OR (p.status IN ('paid', 'partially_refunded', 'refunded') AND p.total_cents > 0))
           AND ${bookingFilter(f, model, sql`b.id`)}
      )
      SELECT coalesce(${t}->>'platform', 'unattributed') AS platform, coalesce(${t}->>'campaign', '') AS campaign,
             count(*)::int AS completed, coalesce(sum(done.cents), 0)::int AS revenue
        FROM done LEFT JOIN analytics_attributions a ON a.booking_id = done.booking_id
       GROUP BY 1, 2`)
  );
  const rows = new Map<string, ComparisonRow>();
  const get = (platform: string, campaign: string) => {
    const key = `${platform}\u0001${campaign}`;
    let r = rows.get(key);
    if (!r) {
      r = {
        platform,
        platformLabel: platform === 'unattributed' ? 'Unattributed' : PLATFORM_LABELS[platform as Platform] ?? platform,
        campaign: campaign || '(none)',
        clicks: 0,
        visits: 0,
        leads: 0,
        bookingStarts: 0,
        completed: 0,
        conversionRate: null,
        revenue: 0,
        spend: null,
      };
      rows.set(key, r);
    }
    return r;
  };
  for (const x of traffic) {
    const r = get(String(x.platform), String(x.campaign ?? ''));
    r.visits += n(x.visits);
    r.clicks += n(x.clicks);
    r.bookingStarts += n(x.starts);
    r.leads += n(x.leads);
  }
  for (const x of conv) {
    const r = get(String(x.platform), String(x.campaign ?? ''));
    r.completed += n(x.completed);
    r.revenue += n(x.revenue);
  }
  return Array.from(rows.values())
    .map((r) => ({ ...r, conversionRate: r.visits > 0 ? Math.min(1, r.completed / r.visits) : null }))
    .sort((a, b) => b.revenue - a.revenue || b.completed - a.completed || b.visits - a.visits)
    .slice(0, 60);
}

/** Values for the filter selects (what actually occurred recently). */
export async function filterOptions(range: DateRange) {
  const { start, end } = bounds(range);
  const sources = rowsOf<{ v: string }>(
    await db.execute(sql`SELECT DISTINCT lower(session_source) AS v FROM analytics_sessions WHERE started_at >= ${start} AND started_at < ${end} AND session_source IS NOT NULL ORDER BY 1 LIMIT 50`)
  ).map((r) => r.v);
  const campaigns = rowsOf<{ v: string }>(
    await db.execute(sql`SELECT DISTINCT session_campaign AS v FROM analytics_sessions WHERE started_at >= ${start} AND started_at < ${end} AND session_campaign IS NOT NULL ORDER BY 1 LIMIT 100`)
  ).map((r) => r.v);
  const services = rowsOf<{ id: number; name: string }>(
    await db.execute(sql`SELECT id, name FROM services WHERE is_active AND category <> 'package' ORDER BY display_order, id`)
  );
  return { sources, campaigns, services };
}

/** Consent choices and test-mode deliveries in the range (diagnostics; counts only). */
export async function consentAndTestSummary(range: DateRange) {
  const { start, end } = bounds(range);
  const [c] = rowsOf<Record<string, number>>(
    await db.execute(sql`
      SELECT count(*)::int AS choices,
             count(*) FILTER (WHERE action = 'accept_all')::int AS accept_all,
             count(*) FILTER (WHERE action = 'reject_all')::int AS reject_all,
             count(*) FILTER (WHERE action = 'custom')::int AS custom,
             count(*) FILTER (WHERE action = 'withdraw')::int AS withdraw,
             count(*) FILTER (WHERE analytics)::int AS analytics_on,
             count(*) FILTER (WHERE advertising)::int AS advertising_on
        FROM analytics_consents WHERE created_at >= ${start} AND created_at < ${end}`)
  );
  const tests = rowsOf<{ destination: string; status: string; count: number }>(
    await db.execute(sql`
      SELECT destination, status, count(*)::int AS count FROM analytics_deliveries
       WHERE test_mode AND created_at >= ${start} AND created_at < ${end} GROUP BY 1, 2 ORDER BY 1, 2`)
  );
  return {
    choices: n(c?.choices),
    acceptAll: n(c?.accept_all),
    rejectAll: n(c?.reject_all),
    custom: n(c?.custom),
    withdraw: n(c?.withdraw),
    analyticsOn: n(c?.analytics_on),
    advertisingOn: n(c?.advertising_on),
    testDeliveries: tests.map((t) => ({ destination: t.destination, status: t.status, count: n(t.count) })),
  };
}
