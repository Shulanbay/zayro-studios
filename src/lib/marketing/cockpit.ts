/**
 * The marketing cockpit: spend → leads → bookings → revenue, by platform,
 * campaign and landing page, with the previous period for comparison.
 *
 * Definitions (shown in the UI):
 *   - spend: entered manually in Ad spend (no estimate when missing);
 *   - leads: CRM leads created in the period (forms, contact page, added by hand);
 *   - conversions: online paid bookings (Stripe-verified) + CRM leads marked "paid";
 *   - revenue: online booking revenue + revenue recorded on CRM leads (offline deals);
 *   - CPL = spend ÷ leads; CPA = spend ÷ conversions; ROAS = revenue ÷ spend.
 */
import { count, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rowsOf } from '@/lib/db/types';
import { adSpend, landingPages, leads, utmLinks } from '@/lib/db/schema';
import { kpis, platformComparison, type ComparisonRow } from '@/lib/analytics/server/kpis';
import { allDestinationStatuses } from '@/lib/analytics/server/config';
import { addDays, wallTimeToUtc } from '@/lib/crm/time';
import { leadSummary } from './leads';
import { spendSeries, spendTotals } from './spend';
import { daysOf, previousOf } from './range';
import { getMarketingSettings } from './settings';
import { pageStats } from './pages';

export interface CockpitKpis {
  spendCents: number;
  leads: number;
  wonLeads: number;
  paidLeads: number;
  onlineBookings: number;
  conversions: number;
  revenueCents: number;
  onlineRevenueCents: number;
  leadRevenueCents: number;
  cplCents: number | null;
  cpaCents: number | null;
  roas: number | null;
  leadToWon: number | null;
  hasSpend: boolean;
}

async function kpiSet(range: { from: string; to: string }, platform?: string): Promise<CockpitKpis> {
  const [spend, summary, online, paidLeadRevenue] = await Promise.all([
    spendTotals(range, { platform }),
    leadSummary({ from: range.from, to: range.to, platform }),
    kpis(range, 'last_non_direct', platform ? { platform } : {}),
    db
      .execute(
        sql`SELECT count(*)::int AS n, coalesce(sum(revenue_cents), 0)::int AS cents FROM leads
             WHERE status = 'paid' AND created_at >= ${wallTimeToUtc(range.from, '00:00')} AND created_at < ${wallTimeToUtc(addDays(range.to, 1), '00:00')}
             ${platform ? sql`AND platform = ${platform}` : sql``}`
      )
      .then((r) => rowsOf<{ n: number; cents: number }>(r)[0]),
  ]);
  const paidLeads = Number(paidLeadRevenue?.n ?? 0);
  const leadRevenueCents = Number(paidLeadRevenue?.cents ?? 0);
  const conversions = online.paidBookings + paidLeads;
  const revenueCents = online.gross + leadRevenueCents;
  const hasSpend = spend.spendCents > 0;
  return {
    spendCents: spend.spendCents,
    leads: summary.total,
    wonLeads: summary.won,
    paidLeads,
    onlineBookings: online.paidBookings,
    conversions,
    revenueCents,
    onlineRevenueCents: online.gross,
    leadRevenueCents,
    cplCents: hasSpend && summary.total > 0 ? Math.round(spend.spendCents / summary.total) : null,
    cpaCents: hasSpend && conversions > 0 ? Math.round(spend.spendCents / conversions) : null,
    roas: hasSpend ? revenueCents / spend.spendCents : null,
    leadToWon: summary.total > 0 ? summary.won / summary.total : null,
    hasSpend,
  };
}

export interface PlatformRow {
  platform: string;
  label: string;
  spendCents: number | null;
  adClicks: number | null;
  impressions: number | null;
  visits: number;
  leads: number;
  bookings: number;
  revenueCents: number;
  cplCents: number | null;
  cpaCents: number | null;
  roas: number | null;
  ctr: number | null;
}

function finish(r: Omit<PlatformRow, 'cplCents' | 'cpaCents' | 'roas' | 'ctr'>): PlatformRow {
  const s = r.spendCents;
  return {
    ...r,
    cplCents: s && r.leads ? Math.round(s / r.leads) : null,
    cpaCents: s && r.bookings ? Math.round(s / r.bookings) : null,
    roas: s ? r.revenueCents / s : null,
    ctr: r.impressions && r.adClicks !== null ? r.adClicks / r.impressions : null,
  };
}

export function byPlatform(rows: ComparisonRow[]): PlatformRow[] {
  const map = new Map<string, Omit<PlatformRow, 'cplCents' | 'cpaCents' | 'roas' | 'ctr'>>();
  for (const r of rows) {
    const m = map.get(r.platform) ?? { platform: r.platform, label: r.platformLabel, spendCents: null, adClicks: null, impressions: null, visits: 0, leads: 0, bookings: 0, revenueCents: 0 };
    if (r.spend !== null) m.spendCents = (m.spendCents ?? 0) + r.spend;
    if (r.adClicks !== null) m.adClicks = (m.adClicks ?? 0) + r.adClicks;
    if (r.impressions !== null) m.impressions = (m.impressions ?? 0) + r.impressions;
    m.visits += r.visits;
    m.leads += r.leads;
    m.bookings += r.completed;
    m.revenueCents += r.revenue + r.leadRevenue;
    map.set(r.platform, m);
  }
  return [...map.values()].map(finish).sort((a, b) => (b.spendCents ?? 0) - (a.spendCents ?? 0) || b.leads - a.leads || b.visits - a.visits);
}

export function byCampaign(rows: ComparisonRow[]) {
  return rows
    .filter((r) => r.platform !== 'direct' && r.platform !== 'unattributed')
    .map((r) => ({
      ...finish({ platform: r.platform, label: r.platformLabel, spendCents: r.spend, adClicks: r.adClicks, impressions: r.impressions, visits: r.visits, leads: r.leads, bookings: r.completed, revenueCents: r.revenue + r.leadRevenue }),
      campaign: r.campaign,
    }))
    .sort((a, b) => (b.spendCents ?? 0) - (a.spendCents ?? 0) || b.leads - a.leads || b.visits - a.visits)
    .slice(0, 25);
}

export interface ChecklistItem {
  key: 'tracking' | 'pixels' | 'page' | 'messengers' | 'spend' | 'utm' | 'leads';
  done: boolean;
  href: string;
}

async function checklist(): Promise<ChecklistItem[]> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const [settings, [published], [spendRows], [links], [leadRows]] = await Promise.all([
    getMarketingSettings(),
    db.select({ n: count() }).from(landingPages).where(eq(landingPages.is_published, true)),
    db.select({ n: count() }).from(adSpend).where(gte(adSpend.spend_date, monthStart.toISOString().slice(0, 10))),
    db.select({ n: count() }).from(utmLinks),
    db.select({ n: count() }).from(leads),
  ]);
  const pixels = allDestinationStatuses().some((d) => d.configured);
  return [
    { key: 'tracking', done: settings.scripts_enabled && !!(settings.global_head_scripts || settings.global_body_scripts), href: '/admin/tracking' },
    { key: 'pixels', done: pixels || !!settings.global_head_scripts, href: '/admin/tracking' },
    { key: 'page', done: Number(published.n) > 0, href: '/admin/pages' },
    { key: 'messengers', done: !!(settings.whatsapp_number || settings.telegram_username), href: '/admin/tracking#messengers' },
    { key: 'utm', done: Number(links.n) > 0, href: '/admin/utm' },
    { key: 'spend', done: Number(spendRows.n) > 0, href: '/admin/ad-spend' },
    { key: 'leads', done: Number(leadRows.n) > 0, href: '/admin/leads' },
  ];
}

export async function cockpit(range: { from: string; to: string }, platform?: string) {
  const prev = previousOf(range);
  const [now, before, comparison, pages, leadDaily, spendDaily, steps] = await Promise.all([
    kpiSet(range, platform),
    kpiSet(prev, platform),
    platformComparison(range, 'last_non_direct', platform ? { platform } : {}),
    pageStats(range),
    db
      .execute(
        sql`SELECT (created_at AT TIME ZONE 'America/New_York')::date::text AS d, count(*)::int AS n FROM leads
             WHERE created_at >= ${wallTimeToUtc(range.from, '00:00')} AND created_at < ${wallTimeToUtc(addDays(range.to, 1), '00:00')}
             ${platform ? sql`AND platform = ${platform}` : sql``} GROUP BY 1`
      )
      .then((r) => new Map(rowsOf<{ d: string; n: number }>(r).map((x) => [x.d.slice(0, 10), Number(x.n)]))),
    spendSeries(range, platform),
    checklist(),
  ]);
  const series = daysOf(range).map((d) => ({ date: d, leads: leadDaily.get(d) ?? 0, spendCents: spendDaily.get(d) ?? 0 }));
  return { now, before, prev, platforms: byPlatform(comparison), campaigns: byCampaign(comparison), pages, series, checklist: steps };
}
