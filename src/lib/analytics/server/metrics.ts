import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rowsOf } from '@/lib/db/types';
import { moneyMetrics, type DateRange } from '@/lib/crm/metrics';
import { addDays, daysBetween, wallTimeToUtc } from '@/lib/crm/time';
import { BOOKING_FUNNEL, CONTACT_FUNNEL, TOUR_FUNNEL, type FunnelStep } from '../catalog';
import { PLATFORM_LABELS, type Platform } from '../attribution';

/**
 * Aggregate marketing analytics for /admin/analytics. Every query returns
 * aggregates only — no customer, booking, purchase, Stripe, Calendar or
 * click-ID value ever leaves this module.
 *
 * Money is read from purchases / refunds exactly like the CRM dashboard
 * (moneyMetrics): gross = collected purchase totals by purchase date,
 * refunds = succeeded refunds by refund date, net = gross − refunds, so the
 * two dashboards never disagree. Acquisition columns use the attribution
 * snapshot taken when each booking was created; visits use the visit date.
 * Business dates are America/New_York.
 */

export const ATTRIBUTION_MODELS = {
  last_non_direct: { column: 'last_non_direct_touch', label: 'Last non-direct touch' },
  first: { column: 'first_touch', label: 'First touch' },
  conversion: { column: 'conversion_touch', label: 'Conversion touch' },
} as const;
export type AttributionModel = keyof typeof ATTRIBUTION_MODELS;

export function parseModel(value: string | undefined): AttributionModel {
  return value && value in ATTRIBUTION_MODELS ? (value as AttributionModel) : 'last_non_direct';
}

/** Rows with fewer sessions than this and no conversion are grouped into "Other (small)". */
export const SMALL_COHORT = 3;

const COLLECTED = sql`('paid', 'partially_refunded', 'refunded')`;
const ET = sql.raw(`'America/New_York'`);

function bounds(range: DateRange) {
  return { start: wallTimeToUtc(range.from, '00:00'), end: wallTimeToUtc(addDays(range.to, 1), '00:00') };
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const touch = (model: AttributionModel) => sql.raw(`a.${ATTRIBUTION_MODELS[model].column}`);

/** Collected purchases in range with the booking they belong to (bookings, extensions; packages have none). */
function paidPurchases(start: Date, end: Date): SQL {
  return sql`
    SELECT p.id, p.type, p.total_cents, p.purchased_at,
           coalesce((SELECT b.id FROM bookings b WHERE b.purchase_id = p.id LIMIT 1),
                    (SELECT e.booking_id FROM booking_extensions e WHERE e.purchase_id = p.id LIMIT 1)) AS booking_id
      FROM purchases p
     WHERE p.status IN ${COLLECTED} AND p.purchased_at >= ${start} AND p.purchased_at < ${end}`;
}

function succeededRefunds(start: Date, end: Date): SQL {
  return sql`
    SELECT r.id, r.amount_cents,
           coalesce(r.booking_id, (SELECT b.id FROM bookings b WHERE b.purchase_id = r.purchase_id LIMIT 1),
                    (SELECT e.booking_id FROM booking_extensions e WHERE e.purchase_id = r.purchase_id LIMIT 1)) AS booking_id
      FROM refunds r
     WHERE r.status = 'succeeded' AND r.created_at >= ${start} AND r.created_at < ${end}`;
}

export async function overview(range: DateRange) {
  const { start, end } = bounds(range);
  const [traffic] = rowsOf<Record<string, number>>(
    await db.execute(sql`
      SELECT count(*)::int AS sessions, count(DISTINCT visitor_id)::int AS visitors, count(*) FILTER (WHERE engaged)::int AS engaged,
             count(*) FILTER (WHERE is_returning)::int AS returning_sessions
        FROM analytics_sessions WHERE started_at >= ${start} AND started_at < ${end}`)
  );
  const [events] = rowsOf<Record<string, number>>(
    await db.execute(sql`
      SELECT count(*) FILTER (WHERE event_name = 'page_view')::int AS page_views,
             count(*) FILTER (WHERE event_name = 'page_view' AND session_id IS NULL)::int AS cookieless_page_views,
             count(DISTINCT session_id) FILTER (WHERE event_name = 'booking_started')::int AS booking_start_sessions,
             count(*) FILTER (WHERE event_name = 'booking_started' AND session_id IS NULL)::int AS cookieless_booking_starts,
             count(*) FILTER (WHERE event_name = 'checkout_created')::int AS checkouts,
             count(*) FILTER (WHERE event_name = 'contact_submitted')::int AS leads
        FROM analytics_events WHERE occurred_at >= ${start} AND occurred_at < ${end}`)
  );
  const [paid] = rowsOf<Record<string, number>>(
    await db.execute(sql`
      WITH paid AS (${paidPurchases(start, end)})
      SELECT count(*) FILTER (WHERE p.type = 'individual' AND p.total_cents > 0)::int AS paid_bookings,
             coalesce(sum(p.total_cents) FILTER (WHERE p.type = 'individual' AND p.total_cents > 0), 0)::int AS booking_revenue,
             coalesce(sum(p.total_cents) FILTER (WHERE p.type = 'extension'), 0)::int AS extension_revenue,
             count(*) FILTER (WHERE p.type = 'individual' AND p.total_cents > 0 AND a.visitor_id IS NOT NULL)::int AS attributed_paid_bookings
        FROM paid p LEFT JOIN analytics_attributions a ON a.booking_id = p.booking_id`)
  );
  const [tours] = rowsOf<{ tours: number }>(
    await db.execute(sql`
      SELECT count(*)::int AS tours FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE s.category = 'tour' AND b.status IN ('confirmed', 'completed', 'no_show') AND b.created_at >= ${start} AND b.created_at < ${end}`)
  );
  const [flow] = rowsOf<Record<string, number>>(
    await db.execute(sql`
      WITH starts AS (SELECT DISTINCT session_id FROM analytics_events WHERE event_name = 'booking_started' AND session_id IS NOT NULL AND occurred_at >= ${start} AND occurred_at < ${end}),
           checkouts AS (SELECT DISTINCT session_id FROM analytics_events WHERE event_name = 'checkout_created' AND session_id IS NOT NULL AND occurred_at >= ${start} AND occurred_at < ${end}),
           co AS (SELECT booking_id FROM analytics_events WHERE event_name = 'checkout_created' AND occurred_at >= ${start} AND occurred_at < ${end})
      SELECT (SELECT count(*) FROM starts)::int AS start_sessions,
             (SELECT count(*) FROM starts s WHERE s.session_id IN (SELECT session_id FROM checkouts))::int AS start_to_checkout_sessions,
             (SELECT count(*) FROM co)::int AS checkouts,
             (SELECT count(*) FROM co WHERE EXISTS (SELECT 1 FROM analytics_events e WHERE e.event_name = 'purchase_confirmed' AND e.booking_id = co.booking_id))::int AS checkouts_paid`)
  );
  const money = await moneyMetrics(range);
  const paidBookings = n(paid?.paid_bookings);
  const visitors = n(traffic?.visitors);
  return {
    visitors,
    sessions: n(traffic?.sessions),
    engagedSessions: n(traffic?.engaged),
    returningSessions: n(traffic?.returning_sessions),
    pageViews: n(events?.page_views),
    cookielessPageViews: n(events?.cookieless_page_views),
    bookingStartSessions: n(events?.booking_start_sessions),
    cookielessBookingStarts: n(events?.cookieless_booking_starts),
    checkouts: n(events?.checkouts),
    paidBookings,
    attributedPaidBookings: n(paid?.attributed_paid_bookings),
    tours: n(tours?.tours),
    leads: n(events?.leads),
    rates: {
      visitorToPaid: visitors > 0 ? n(paid?.attributed_paid_bookings) / visitors : null,
      startToCheckout: n(flow?.start_sessions) > 0 ? n(flow?.start_to_checkout_sessions) / n(flow?.start_sessions) : null,
      checkoutToPurchase: n(flow?.checkouts) > 0 ? n(flow?.checkouts_paid) / n(flow?.checkouts) : null,
    },
    gross: money.gross,
    refunds: money.refunds,
    net: money.net,
    bookingRevenue: n(paid?.booking_revenue),
    extensionRevenue: n(paid?.extension_revenue),
    averageOrderValue: paidBookings > 0 ? Math.round(n(paid?.booking_revenue) / paidBookings) : null,
    byService: money.byService.slice(0, 12),
  };
}

export async function timeSeries(range: DateRange) {
  const { start, end } = bounds(range);
  const days = Math.min(daysBetween(range.from, range.to) + 1, 400);
  const visits = rowsOf<{ d: string; visitors: number; sessions: number }>(
    await db.execute(sql`
      SELECT to_char(started_at AT TIME ZONE ${ET}, 'YYYY-MM-DD') AS d, count(DISTINCT visitor_id)::int AS visitors, count(*)::int AS sessions
        FROM analytics_sessions WHERE started_at >= ${start} AND started_at < ${end} GROUP BY 1`)
  );
  const money = rowsOf<{ d: string; paid: number; gross: number }>(
    await db.execute(sql`
      SELECT to_char(purchased_at AT TIME ZONE ${ET}, 'YYYY-MM-DD') AS d,
             count(*) FILTER (WHERE type = 'individual' AND total_cents > 0)::int AS paid, coalesce(sum(total_cents), 0)::int AS gross
        FROM purchases WHERE status IN ${COLLECTED} AND purchased_at >= ${start} AND purchased_at < ${end} GROUP BY 1`)
  );
  const v = new Map(visits.map((r) => [r.d, r]));
  const m = new Map(money.map((r) => [r.d, r]));
  const out: { date: string; visitors: number; sessions: number; paid: number; gross: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(range.from, i);
    out.push({ date: d, visitors: n(v.get(d)?.visitors), sessions: n(v.get(d)?.sessions), paid: n(m.get(d)?.paid), gross: n(m.get(d)?.gross) });
  }
  return out;
}

export async function funnel(range: DateRange, steps: FunnelStep[]) {
  const { start, end } = bounds(range);
  const counts = rowsOf<{ event_name: string; sessions: number; events: number; bookings: number }>(
    await db.execute(sql`
      SELECT event_name, count(DISTINCT session_id)::int AS sessions, count(*)::int AS events, count(DISTINCT booking_id)::int AS bookings
        FROM analytics_events WHERE occurred_at >= ${start} AND occurred_at < ${end} GROUP BY event_name`)
  );
  const byName = new Map(counts.map((c) => [c.event_name, c]));
  const [sessions] = rowsOf<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM analytics_sessions WHERE started_at >= ${start} AND started_at < ${end}`));
  return steps.map((s) => {
    const c = byName.get(s.event);
    const value =
      s.event === 'session' ? n(sessions?.n) : s.population === 'sessions' ? n(c?.sessions) : s.population === 'bookings' ? n(c?.bookings) || n(c?.events) : s.population === 'purchases' ? n(c?.bookings) : n(c?.events);
    return { ...s, value };
  });
}

export const funnels = (range: DateRange) => Promise.all([funnel(range, BOOKING_FUNNEL), funnel(range, TOUR_FUNNEL), funnel(range, CONTACT_FUNNEL)]);

export interface PlatformRow {
  platform: Platform | 'unattributed';
  label: string;
  visitors: number;
  sessions: number;
  bookingStarts: number;
  checkouts: number;
  paidBookings: number;
  tours: number;
  leads: number;
  gross: number;
  refunds: number;
  net: number;
  conversionRate: number | null;
  averageOrderValue: number | null;
}

export async function platformBreakdown(range: DateRange, model: AttributionModel): Promise<PlatformRow[]> {
  const { start, end } = bounds(range);
  const t = touch(model);
  const sessions = rowsOf<{ k: string; visitors: number; sessions: number; starts: number; leads: number }>(
    await db.execute(sql`
      SELECT s.platform AS k, count(DISTINCT s.visitor_id)::int AS visitors, count(*)::int AS sessions,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'booking_started'))::int AS starts,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'contact_submitted'))::int AS leads
        FROM analytics_sessions s WHERE s.started_at >= ${start} AND s.started_at < ${end} GROUP BY 1`)
  );
  const conv = rowsOf<{ k: string | null; checkouts: number }>(
    await db.execute(sql`
      SELECT ${t}->>'platform' AS k, count(*)::int AS checkouts
        FROM analytics_events e LEFT JOIN analytics_attributions a ON a.booking_id = e.booking_id
       WHERE e.event_name = 'checkout_created' AND e.occurred_at >= ${start} AND e.occurred_at < ${end} GROUP BY 1`)
  );
  const money = rowsOf<{ k: string | null; paid: number; booking_rev: number; gross: number }>(
    await db.execute(sql`
      WITH paid AS (${paidPurchases(start, end)})
      SELECT ${t}->>'platform' AS k, count(*) FILTER (WHERE p.type = 'individual' AND p.total_cents > 0)::int AS paid,
             coalesce(sum(p.total_cents) FILTER (WHERE p.type = 'individual' AND p.total_cents > 0), 0)::int AS booking_rev,
             coalesce(sum(p.total_cents), 0)::int AS gross
        FROM paid p LEFT JOIN analytics_attributions a ON a.booking_id = p.booking_id GROUP BY 1`)
  );
  const refunds = rowsOf<{ k: string | null; refunds: number }>(
    await db.execute(sql`
      WITH r AS (${succeededRefunds(start, end)})
      SELECT ${t}->>'platform' AS k, coalesce(sum(r.amount_cents), 0)::int AS refunds
        FROM r LEFT JOIN analytics_attributions a ON a.booking_id = r.booking_id GROUP BY 1`)
  );
  const tours = rowsOf<{ k: string | null; tours: number }>(
    await db.execute(sql`
      SELECT ${t}->>'platform' AS k, count(*)::int AS tours
        FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN analytics_attributions a ON a.booking_id = b.id
       WHERE s.category = 'tour' AND b.status IN ('confirmed', 'completed', 'no_show') AND b.created_at >= ${start} AND b.created_at < ${end} GROUP BY 1`)
  );

  const rows = new Map<string, PlatformRow>();
  const row = (k: string | null) => {
    const key = (k && k in PLATFORM_LABELS ? k : k ? 'other' : 'unattributed') as PlatformRow['platform'];
    let r = rows.get(key);
    if (!r) {
      r = { platform: key, label: key === 'unattributed' ? 'Unattributed (no consented visit, packages, pre-analytics)' : PLATFORM_LABELS[key as Platform], visitors: 0, sessions: 0, bookingStarts: 0, checkouts: 0, paidBookings: 0, tours: 0, leads: 0, gross: 0, refunds: 0, net: 0, conversionRate: null, averageOrderValue: null };
      rows.set(key, r);
    }
    return r;
  };
  const bookingRev = new Map<string, number>();
  for (const s of sessions) Object.assign(row(s.k), { visitors: row(s.k).visitors + n(s.visitors), sessions: row(s.k).sessions + n(s.sessions), bookingStarts: row(s.k).bookingStarts + n(s.starts), leads: row(s.k).leads + n(s.leads) });
  for (const c of conv) row(c.k).checkouts += n(c.checkouts);
  for (const m of money) {
    const r = row(m.k);
    r.paidBookings += n(m.paid);
    r.gross += n(m.gross);
    bookingRev.set(r.platform, (bookingRev.get(r.platform) ?? 0) + n(m.booking_rev));
  }
  for (const f of refunds) row(f.k).refunds += n(f.refunds);
  for (const x of tours) row(x.k).tours += n(x.tours);
  const order: string[] = ['google', 'meta', 'instagram', 'reddit', 'pinterest', 'tiktok', 'organic', 'direct', 'referral', 'other', 'unattributed'];
  return Array.from(rows.values())
    .map((r) => ({ ...r, net: r.gross - r.refunds, conversionRate: r.sessions > 0 ? r.paidBookings / r.sessions : null, averageOrderValue: r.paidBookings > 0 ? Math.round((bookingRev.get(r.platform) ?? 0) / r.paidBookings) : null }))
    .sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));
}

export interface CampaignRow {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  landingPath: string;
  sessions: number;
  bookingStarts: number;
  checkouts: number;
  paidBookings: number;
  conversions: number;
  gross: number;
  refunds: number;
  net: number;
}

export async function campaignBreakdown(range: DateRange, model: AttributionModel): Promise<CampaignRow[]> {
  const { start, end } = bounds(range);
  const t = touch(model);
  const key = (s: unknown, m: unknown, c: unknown, ct: unknown, l: unknown) => [s, m, c, ct, l].map((x) => String(x ?? '')).join('\u0001');
  const sessions = rowsOf<Record<string, any>>(
    await db.execute(sql`
      SELECT s.session_source AS source, s.session_medium AS medium, coalesce(s.session_campaign, '') AS campaign, coalesce(s.session_content, '') AS content,
             coalesce(s.landing_path, '') AS landing, count(*)::int AS sessions,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'booking_started'))::int AS starts
        FROM analytics_sessions s WHERE s.started_at >= ${start} AND s.started_at < ${end} GROUP BY 1, 2, 3, 4, 5`)
  );
  const conv = rowsOf<Record<string, any>>(
    await db.execute(sql`
      WITH paid AS (${paidPurchases(start, end)}),
           co AS (SELECT booking_id FROM analytics_events WHERE event_name = 'checkout_created' AND occurred_at >= ${start} AND occurred_at < ${end}),
           rf AS (${succeededRefunds(start, end)}),
           keyed AS (
             SELECT 'paid' AS kind, p.type, p.total_cents AS cents, a.* FROM paid p JOIN analytics_attributions a ON a.booking_id = p.booking_id
             UNION ALL SELECT 'checkout', NULL, 0, a.* FROM co JOIN analytics_attributions a ON a.booking_id = co.booking_id
             UNION ALL SELECT 'refund', NULL, rf.amount_cents, a.* FROM rf JOIN analytics_attributions a ON a.booking_id = rf.booking_id
             UNION ALL SELECT 'tour', NULL, 0, a.* FROM bookings b JOIN services s ON s.id = b.service_id JOIN analytics_attributions a ON a.booking_id = b.id
                        WHERE s.category = 'tour' AND b.status IN ('confirmed', 'completed', 'no_show') AND b.created_at >= ${start} AND b.created_at < ${end}
           )
      SELECT ${t}->>'source' AS source, ${t}->>'medium' AS medium, coalesce(${t}->>'campaign', '') AS campaign, coalesce(${t}->>'content', '') AS content,
             coalesce(${t}->>'landingPath', '') AS landing,
             count(*) FILTER (WHERE kind = 'checkout')::int AS checkouts,
             count(*) FILTER (WHERE kind = 'paid' AND type = 'individual' AND cents > 0)::int AS paid,
             count(*) FILTER (WHERE kind = 'tour')::int AS tours,
             coalesce(sum(cents) FILTER (WHERE kind = 'paid'), 0)::int AS gross,
             coalesce(sum(cents) FILTER (WHERE kind = 'refund'), 0)::int AS refunds
        FROM keyed a WHERE ${t} IS NOT NULL GROUP BY 1, 2, 3, 4, 5`)
  );
  const rows = new Map<string, CampaignRow>();
  const get = (r: Record<string, any>) => {
    const k = key(r.source, r.medium, r.campaign, r.content, r.landing);
    let row = rows.get(k);
    if (!row) {
      row = { source: r.source ?? '(direct)', medium: r.medium ?? '(none)', campaign: r.campaign || '(not set)', content: r.content || '(not set)', landingPath: r.landing || '(not set)', sessions: 0, bookingStarts: 0, checkouts: 0, paidBookings: 0, conversions: 0, gross: 0, refunds: 0, net: 0 };
      rows.set(k, row);
    }
    return row;
  };
  for (const s of sessions) {
    const r = get(s);
    r.sessions += n(s.sessions);
    r.bookingStarts += n(s.starts);
  }
  for (const c of conv) {
    const r = get(c);
    r.checkouts += n(c.checkouts);
    r.paidBookings += n(c.paid);
    r.conversions += n(c.paid) + n(c.tours);
    r.gross += n(c.gross);
    r.refunds += n(c.refunds);
  }
  return suppressSmall(Array.from(rows.values()).map((r) => ({ ...r, net: r.gross - r.refunds }))).sort((a, b) => b.gross - a.gross || b.sessions - a.sessions);
}

/** Groups tiny rows with no conversions so a breakdown can't single out a handful of visits. */
export function suppressSmall<T extends CampaignRow>(rows: T[]): T[] {
  const keep: T[] = [];
  let other: T | null = null;
  for (const r of rows) {
    if (r.sessions < SMALL_COHORT && r.conversions === 0 && r.checkouts === 0) {
      if (!other) other = { ...r, source: 'Other (small)', medium: '—', campaign: '—', content: '—', landingPath: '—', sessions: 0, bookingStarts: 0, checkouts: 0, paidBookings: 0, conversions: 0, gross: 0, refunds: 0, net: 0 };
      other.sessions += r.sessions;
      other.bookingStarts += r.bookingStarts;
      other.gross += r.gross;
      other.refunds += r.refunds;
      other.net += r.net;
    } else keep.push(r);
  }
  if (other) keep.push(other);
  return keep;
}

export async function segmentBreakdowns(range: DateRange) {
  const { start, end } = bounds(range);
  const device = rowsOf<{ k: string; sessions: number; converted: number }>(
    await db.execute(sql`SELECT coalesce(device_category, 'other') AS k, count(*)::int AS sessions, count(*) FILTER (WHERE converted)::int AS converted
                           FROM analytics_sessions WHERE started_at >= ${start} AND started_at < ${end} GROUP BY 1 ORDER BY 2 DESC`)
  );
  const landing = rowsOf<{ k: string; sessions: number; converted: number }>(
    await db.execute(sql`SELECT coalesce(landing_path, '(not set)') AS k, count(*)::int AS sessions, count(*) FILTER (WHERE converted)::int AS converted
                           FROM analytics_sessions WHERE started_at >= ${start} AND started_at < ${end} GROUP BY 1 ORDER BY 2 DESC LIMIT 25`)
  );
  const returning = rowsOf<{ k: string; sessions: number; converted: number }>(
    await db.execute(sql`SELECT CASE WHEN is_returning THEN 'Returning' ELSE 'New' END AS k, count(*)::int AS sessions, count(*) FILTER (WHERE converted)::int AS converted
                           FROM analytics_sessions WHERE started_at >= ${start} AND started_at < ${end} GROUP BY 1`)
  );
  const weekday = rowsOf<{ k: number; paid: number }>(
    await db.execute(sql`SELECT extract(dow FROM purchased_at AT TIME ZONE ${ET})::int AS k, count(*)::int AS paid
                           FROM purchases WHERE status IN ${COLLECTED} AND type = 'individual' AND total_cents > 0 AND purchased_at >= ${start} AND purchased_at < ${end} GROUP BY 1`)
  );
  const hour = rowsOf<{ k: number; paid: number }>(
    await db.execute(sql`SELECT extract(hour FROM purchased_at AT TIME ZONE ${ET})::int AS k, count(*)::int AS paid
                           FROM purchases WHERE status IN ${COLLECTED} AND type = 'individual' AND total_cents > 0 AND purchased_at >= ${start} AND purchased_at < ${end} GROUP BY 1`)
  );
  const sessWeekday = rowsOf<{ k: number; sessions: number }>(
    await db.execute(sql`SELECT extract(dow FROM started_at AT TIME ZONE ${ET})::int AS k, count(*)::int AS sessions FROM analytics_sessions WHERE started_at >= ${start} AND started_at < ${end} GROUP BY 1`)
  );
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    device: device.map((r) => ({ label: r.k, sessions: n(r.sessions), converted: n(r.converted) })),
    landing: landing.filter((r) => n(r.sessions) >= SMALL_COHORT || n(r.converted) > 0).map((r) => ({ label: r.k, sessions: n(r.sessions), converted: n(r.converted) })),
    returning: returning.map((r) => ({ label: r.k, sessions: n(r.sessions), converted: n(r.converted) })),
    weekday: days.map((label, i) => ({ label, paid: n(weekday.find((w) => n(w.k) === i)?.paid), sessions: n(sessWeekday.find((w) => n(w.k) === i)?.sessions) })),
    hour: Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0'), paid: n(hour.find((w) => n(w.k) === h)?.paid) })),
  };
}

export async function deliveryHealth(range: DateRange) {
  const { start, end } = bounds(range);
  const rows = rowsOf<{ destination: string; channel: string; status: string; n: number; last_ok: string | null; last_error: string | null }>(
    await db.execute(sql`
      SELECT d.destination, d.channel, d.status, count(*)::int AS n, max(d.delivered_at)::text AS last_ok,
             (array_agg(d.last_error_sanitized ORDER BY d.updated_at DESC) FILTER (WHERE d.status IN ('failed', 'dead')))[1] AS last_error
        FROM analytics_deliveries d WHERE d.created_at >= ${start} AND d.created_at < ${end} GROUP BY 1, 2, 3`)
  );
  const pairs = rowsOf<{ platform: string; both: number; server: number }>(
    await db.execute(sql`
      WITH ev AS (
        SELECT d.analytics_event_id,
               bool_or(d.destination = 'meta_capi' AND d.status = 'delivered') AS meta_s, bool_or(d.destination = 'meta_pixel' AND d.status = 'delivered') AS meta_b,
               bool_or(d.destination = 'reddit_capi' AND d.status = 'delivered') AS reddit_s, bool_or(d.destination = 'reddit_pixel' AND d.status = 'delivered') AS reddit_b,
               bool_or(d.destination = 'pinterest_capi' AND d.status = 'delivered') AS pin_s, bool_or(d.destination = 'pinterest_tag' AND d.status = 'delivered') AS pin_b,
               bool_or(d.destination = 'tiktok_events_api' AND d.status = 'delivered') AS tt_s, bool_or(d.destination = 'tiktok_pixel' AND d.status = 'delivered') AS tt_b,
               bool_or(d.destination = 'x_capi' AND d.status = 'delivered') AS x_s, bool_or(d.destination = 'x_pixel' AND d.status = 'delivered') AS x_b
          FROM analytics_deliveries d WHERE d.created_at >= ${start} AND d.created_at < ${end} GROUP BY 1)
      SELECT 'meta' AS platform, count(*) FILTER (WHERE meta_s AND meta_b)::int AS both, count(*) FILTER (WHERE meta_s)::int AS server FROM ev
      UNION ALL SELECT 'reddit', count(*) FILTER (WHERE reddit_s AND reddit_b)::int, count(*) FILTER (WHERE reddit_s)::int FROM ev
      UNION ALL SELECT 'pinterest', count(*) FILTER (WHERE pin_s AND pin_b)::int, count(*) FILTER (WHERE pin_s)::int FROM ev
      UNION ALL SELECT 'tiktok', count(*) FILTER (WHERE tt_s AND tt_b)::int, count(*) FILTER (WHERE tt_s)::int FROM ev
      UNION ALL SELECT 'x', count(*) FILTER (WHERE x_s AND x_b)::int, count(*) FILTER (WHERE x_s)::int FROM ev`)
  );
  const [epik] = rowsOf<{ conv: number; with_epik: number }>(
    await db.execute(sql`
      SELECT count(*)::int AS conv, count(*) FILTER (WHERE a.consent_advertising AND (a.conversion_touch->'clickIdTypes') ? 'epik')::int AS with_epik
        FROM analytics_events e JOIN analytics_attributions a ON a.booking_id = e.booking_id
       WHERE e.event_name = 'purchase_confirmed' AND e.occurred_at >= ${start} AND e.occurred_at < ${end}`)
  );
  return {
    rows: rows.map((r) => ({ ...r, n: n(r.n) })),
    dedup: pairs.map((p) => ({ platform: p.platform, both: n(p.both), server: n(p.server), coverage: n(p.server) > 0 ? n(p.both) / n(p.server) : null })),
    missingEpikShare: n(epik?.conv) > 0 ? 1 - n(epik?.with_epik) / n(epik?.conv) : null,
  };
}

export interface ExportRow {
  date: string;
  source: string;
  medium: string;
  campaign: string;
  sessions: number;
  visitors: number;
  pageViews: number;
  bookingStarts: number;
  checkouts: number;
  purchases: number;
  gross: number;
  refunds: number;
  net: number;
}

/**
 * Daily aggregate rows for the CSV export (Last Non-Direct model for
 * conversions). Only the allowed aggregate fields exist in this shape —
 * there is nothing personal to leak.
 */
export async function exportRows(range: DateRange, model: AttributionModel = 'last_non_direct'): Promise<ExportRow[]> {
  const { start, end } = bounds(range);
  const t = touch(model);
  const visits = rowsOf<Record<string, any>>(
    await db.execute(sql`
      SELECT to_char(s.started_at AT TIME ZONE ${ET}, 'YYYY-MM-DD') AS d, s.session_source AS source, s.session_medium AS medium, coalesce(s.session_campaign, '') AS campaign,
             count(*)::int AS sessions, count(DISTINCT s.visitor_id)::int AS visitors, coalesce(sum(s.page_view_count), 0)::int AS page_views,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events e WHERE e.session_id = s.id AND e.event_name = 'booking_started'))::int AS starts
        FROM analytics_sessions s WHERE s.started_at >= ${start} AND s.started_at < ${end} GROUP BY 1, 2, 3, 4`)
  );
  const conv = rowsOf<Record<string, any>>(
    await db.execute(sql`
      WITH paid AS (${paidPurchases(start, end)}),
           rf AS (SELECT x.*, r.created_at FROM (${succeededRefunds(start, end)}) x JOIN refunds r ON r.id = x.id),
           keyed AS (
             SELECT to_char(p.purchased_at AT TIME ZONE ${ET}, 'YYYY-MM-DD') AS d, 'paid' AS kind, p.type, p.total_cents AS cents, ${t} AS tp
               FROM paid p LEFT JOIN analytics_attributions a ON a.booking_id = p.booking_id
             UNION ALL
             SELECT to_char(e.occurred_at AT TIME ZONE ${ET}, 'YYYY-MM-DD'), 'checkout', NULL, 0, ${t}
               FROM analytics_events e LEFT JOIN analytics_attributions a ON a.booking_id = e.booking_id
              WHERE e.event_name = 'checkout_created' AND e.occurred_at >= ${start} AND e.occurred_at < ${end}
             UNION ALL
             SELECT to_char(rf.created_at AT TIME ZONE ${ET}, 'YYYY-MM-DD'), 'refund', NULL, rf.amount_cents, ${t}
               FROM rf LEFT JOIN analytics_attributions a ON a.booking_id = rf.booking_id)
      SELECT d, coalesce(tp->>'source', '(unattributed)') AS source, coalesce(tp->>'medium', '(unattributed)') AS medium, coalesce(tp->>'campaign', '') AS campaign,
             count(*) FILTER (WHERE kind = 'checkout')::int AS checkouts,
             count(*) FILTER (WHERE kind = 'paid' AND type = 'individual' AND cents > 0)::int AS purchases,
             coalesce(sum(cents) FILTER (WHERE kind = 'paid'), 0)::int AS gross,
             coalesce(sum(cents) FILTER (WHERE kind = 'refund'), 0)::int AS refunds
        FROM keyed GROUP BY 1, 2, 3, 4`)
  );
  const rows = new Map<string, ExportRow>();
  const get = (r: Record<string, any>) => {
    const k = [r.d, r.source, r.medium, r.campaign].join('\u0001');
    let row = rows.get(k);
    if (!row) {
      row = { date: r.d, source: r.source ?? '(direct)', medium: r.medium ?? '(none)', campaign: r.campaign || '(not set)', sessions: 0, visitors: 0, pageViews: 0, bookingStarts: 0, checkouts: 0, purchases: 0, gross: 0, refunds: 0, net: 0 };
      rows.set(k, row);
    }
    return row;
  };
  for (const v of visits) Object.assign(get(v), { sessions: n(v.sessions), visitors: n(v.visitors), pageViews: n(v.page_views), bookingStarts: n(v.starts) });
  for (const c of conv) {
    const r = get(c);
    r.checkouts += n(c.checkouts);
    r.purchases += n(c.purchases);
    r.gross += n(c.gross);
    r.refunds += n(c.refunds);
  }
  return Array.from(rows.values())
    .map((r) => ({ ...r, net: r.gross - r.refunds }))
    .sort((a, b) => a.date.localeCompare(b.date) || b.sessions - a.sessions);
}
