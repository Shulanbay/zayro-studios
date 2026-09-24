import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { availability, availabilityOverrides, blockedTimes, bookings, emailLogs, integrationLogs, purchases, services, webhookEvents } from '@/lib/db/schema';
import { rowsOf } from '@/lib/db/types';
import { addDays, daysBetween, dayOfWeek, minutesIntoDay, timeToMinutes, wallTimeToUtc } from './time';

/**
 * Dashboard metrics — every number is a SQL aggregate over real rows.
 * The date range is inclusive, in studio time (America/New_York).
 *
 * Money (purchases with money collected: paid / partially_refunded /
 * refunded, by purchased_at in range):
 *   gross   = Σ total_cents              (what customers paid, incl. tax)
 *   tax     = Σ tax_cents
 *   refunds = Σ succeeded refunds.amount_cents, by refund date in range
 *   net     = gross − refunds
 *   revenue by service/category = Σ line-item total_cents (pre-tax, before refunds)
 *
 * Sessions (bookings by start time in range):
 *   total      = confirmed + completed + no-show + cancelled (abandoned checkouts excluded)
 *   paid       = room-holding bookings with a collected, non-zero payment
 *   free tours = room-holding bookings of a 'tour' service
 *   utilisation = booked minutes of room-holding bookings ÷ open minutes
 *                 (weekly hours, date overrides, minus blocked time)
 */

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD inclusive
}

const COLLECTED = ['paid', 'partially_refunded', 'refunded'] as const;

function bounds(range: DateRange) {
  return { start: wallTimeToUtc(range.from, '00:00'), end: wallTimeToUtc(addDays(range.to, 1), '00:00') };
}

export async function moneyMetrics(range: DateRange) {
  const { start, end } = bounds(range);
  const [totals] = await db
    .select({
      gross: sql<number>`coalesce(sum(${purchases.total_cents}), 0)::int`,
      tax: sql<number>`coalesce(sum(${purchases.tax_cents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(purchases)
    .where(and(inArray(purchases.status, [...COLLECTED]), gte(purchases.purchased_at, start), lt(purchases.purchased_at, end)));

  const refundRows = rowsOf<{ total: number }>(
    await db.execute(sql`
      SELECT coalesce(sum(amount_cents), 0)::int AS total FROM refunds
       WHERE status = 'succeeded' AND created_at >= ${start} AND created_at < ${end}`)
  );
  const refunds = Number(refundRows[0]?.total ?? 0);

  const byService = rowsOf<{ category: string; name: string; cents: number; items: number }>(
    await db.execute(sql`
      SELECT coalesce(s.category::text, CASE WHEN i.item_type = 'package' THEN 'package' ELSE 'other' END) AS category,
             coalesce(s.name, pp.name, i.description_snapshot) AS name,
             sum(i.total_cents)::int AS cents,
             count(*)::int AS items
        FROM purchase_items i
        JOIN purchases p ON p.id = i.purchase_id
        LEFT JOIN services s ON i.item_type = 'service' AND s.id::text = i.reference_id
        LEFT JOIN package_plans pp ON i.item_type = 'package' AND pp.id::text = i.reference_id
       WHERE p.status IN ('paid', 'partially_refunded', 'refunded')
         AND p.purchased_at >= ${start} AND p.purchased_at < ${end}
       GROUP BY 1, 2
       ORDER BY 3 DESC`)
  ).map((r) => ({ ...r, cents: Number(r.cents), items: Number(r.items) }));

  const byCategory: Record<string, number> = {};
  for (const r of byService) byCategory[r.category] = (byCategory[r.category] ?? 0) + r.cents;

  const gross = Number(totals?.gross ?? 0);
  return {
    gross,
    tax: Number(totals?.tax ?? 0),
    refunds,
    net: gross - refunds,
    purchases: Number(totals?.count ?? 0),
    byService,
    byCategory,
  };
}

export async function sessionMetrics(range: DateRange) {
  const { start, end } = bounds(range);
  const rows = rowsOf<Record<string, number>>(
    await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE b.status IN ('confirmed', 'completed', 'no_show', 'cancelled'))::int AS total,
        count(*) FILTER (WHERE b.status IN ('confirmed', 'completed', 'no_show')
                          AND b.payment_status IN ('succeeded', 'partially_refunded', 'refunded')
                          AND b.total_amount > 0)::int AS paid,
        count(*) FILTER (WHERE b.status IN ('confirmed', 'completed', 'no_show') AND s.category = 'tour')::int AS tours,
        count(*) FILTER (WHERE b.status = 'confirmed' AND b.starts_at >= now())::int AS upcoming,
        count(*) FILTER (WHERE b.status = 'completed')::int AS completed,
        count(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
        count(*) FILTER (WHERE b.status = 'no_show')::int AS no_shows,
        coalesce(sum(extract(epoch FROM (b.ends_at - b.starts_at)) / 60)
                 FILTER (WHERE b.status IN ('confirmed', 'completed', 'no_show')), 0)::int AS booked_minutes
      FROM bookings b JOIN services s ON s.id = b.service_id
      WHERE b.starts_at >= ${start} AND b.starts_at < ${end}`)
  );
  const r = rows[0] ?? {};
  const openMinutes = await openMinutesInRange(range);
  const booked = Number(r.booked_minutes ?? 0);
  return {
    total: Number(r.total ?? 0),
    paid: Number(r.paid ?? 0),
    tours: Number(r.tours ?? 0),
    upcoming: Number(r.upcoming ?? 0),
    completed: Number(r.completed ?? 0),
    cancelled: Number(r.cancelled ?? 0),
    noShows: Number(r.no_shows ?? 0),
    bookedMinutes: booked,
    openMinutes,
    utilisation: openMinutes > 0 ? booked / openMinutes : 0,
  };
}

/** Bookable minutes in the range: weekly hours, date overrides, minus blocked time. */
export async function openMinutesInRange(range: DateRange): Promise<number> {
  const days = daysBetween(range.from, range.to) + 1;
  if (days <= 0 || days > 400) return 0;
  const { start, end } = bounds(range);
  const [weekly, overrides, blocks] = await Promise.all([
    db.query.availability.findMany({ where: eq(availability.is_available, true) }),
    db.query.availabilityOverrides.findMany({
      where: and(gte(availabilityOverrides.date, range.from), lt(availabilityOverrides.date, addDays(range.to, 1))),
    }),
    db.query.blockedTimes.findMany({
      where: and(isNull(blockedTimes.deleted_at), lt(blockedTimes.start_datetime, end), sql`${blockedTimes.end_datetime} > ${start}`),
    }),
  ]);
  const byDay = new Map(weekly.map((w) => [w.day_of_week, w]));
  const byDate = new Map(overrides.map((o) => [o.date, o]));
  let total = 0;
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const o = byDate.get(d);
    let open: [number, number] | null = null;
    if (o) open = o.is_closed || !o.start_time || !o.end_time ? null : [timeToMinutes(o.start_time), timeToMinutes(o.end_time)];
    else {
      const w = byDay.get(dayOfWeek(d));
      open = w ? [timeToMinutes(w.start_time), timeToMinutes(w.end_time)] : null;
    }
    if (!open) continue;
    let minutes = open[1] - open[0];
    for (const b of blocks) {
      const s = Math.max(open[0], minutesIntoDay(b.start_datetime, d));
      const e = Math.min(open[1], minutesIntoDay(b.end_datetime, d));
      if (e > s) minutes -= e - s;
    }
    total += Math.max(0, minutes);
  }
  return total;
}

export async function attentionItems() {
  const since = new Date(Date.now() - 7 * 86400000);
  const [needsReview, failedIntegrations, failedWebhooks, failedEmails] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(purchases).where(eq(purchases.needs_refund_review, true)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(integrationLogs)
      .where(and(eq(integrationLogs.status, 'failed'), gte(integrationLogs.created_at, since), inArray(integrationLogs.integration_type, ['google_calendar', 'google_sheets']))),
    db.select({ n: sql<number>`count(*)::int` }).from(webhookEvents).where(eq(webhookEvents.status, 'failed')),
    db.select({ n: sql<number>`count(*)::int` }).from(emailLogs).where(inArray(emailLogs.status, ['failed'])),
  ]);
  return {
    needsReview: Number(needsReview[0]?.n ?? 0),
    failedIntegrations: Number(failedIntegrations[0]?.n ?? 0),
    failedWebhooks: Number(failedWebhooks[0]?.n ?? 0),
    failedEmails: Number(failedEmails[0]?.n ?? 0),
  };
}

export async function upcomingSessions(limit = 8) {
  return db
    .select({
      id: bookings.id,
      booking_id: bookings.booking_id,
      booking_date: bookings.booking_date,
      start_time: bookings.start_time,
      end_time: bookings.end_time,
      first: bookings.customer_first_name,
      last: bookings.customer_last_name,
      service: services.name,
      category: services.category,
      payment_status: bookings.payment_status,
    })
    .from(bookings)
    .innerJoin(services, eq(services.id, bookings.service_id))
    .where(and(eq(bookings.status, 'confirmed'), gte(bookings.starts_at, new Date())))
    .orderBy(bookings.starts_at)
    .limit(limit);
}

export async function recentPurchases(limit = 8) {
  return db
    .select({
      id: purchases.id,
      order_number: purchases.order_number,
      type: purchases.type,
      status: purchases.status,
      total_cents: purchases.total_cents,
      created_at: purchases.created_at,
      purchased_at: purchases.purchased_at,
      needs_refund_review: purchases.needs_refund_review,
    })
    .from(purchases)
    .orderBy(desc(purchases.created_at))
    .limit(limit);
}
