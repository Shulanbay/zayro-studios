/**
 * Ad spend entered by the team (per day × platform × campaign). Until an ad
 * platform reporting API is connected this is the only cost source, and it
 * is labelled "entered manually" wherever it is used. Nothing is estimated.
 */
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rowsOf } from '@/lib/db/types';
import { adSpend } from '@/lib/db/schema';

export { SPEND_PLATFORMS, type SpendPlatform } from './spendCsv';

/** Campaign names are matched to utm_campaign, which is stored lowercase. */
export function normalizeCampaign(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().slice(0, 150);
}

export interface SpendTotals {
  spendCents: number;
  clicks: number;
  impressions: number;
  rows: number;
}

export async function spendTotals(range: { from: string; to: string }, f: { platform?: string; campaign?: string } = {}): Promise<SpendTotals> {
  const conds = [gte(adSpend.spend_date, range.from), lte(adSpend.spend_date, range.to)];
  if (f.platform) conds.push(eq(adSpend.platform, f.platform));
  if (f.campaign) conds.push(eq(adSpend.campaign, normalizeCampaign(f.campaign)));
  try {
    const [r] = await db
      .select({
        spend: sql<number>`coalesce(sum(${adSpend.amount_cents}), 0)::bigint`,
        clicks: sql<number>`coalesce(sum(${adSpend.clicks}), 0)::bigint`,
        impressions: sql<number>`coalesce(sum(${adSpend.impressions}), 0)::bigint`,
        rows: sql<number>`count(*)::int`,
      })
      .from(adSpend)
      .where(and(...conds));
    return { spendCents: Number(r.spend), clicks: Number(r.clicks), impressions: Number(r.impressions), rows: Number(r.rows) };
  } catch {
    return { spendCents: 0, clicks: 0, impressions: 0, rows: 0 };
  }
}

export interface SpendByCampaign {
  platform: string;
  campaign: string;
  spendCents: number;
  clicks: number;
  impressions: number;
}

export async function spendByCampaign(range: { from: string; to: string }, f: { platform?: string; campaign?: string } = {}): Promise<SpendByCampaign[]> {
  try {
    return rowsOf<{ platform: string; campaign: string; spend: number; clicks: number; impressions: number }>(
      await db.execute(sql`
        SELECT platform, campaign, sum(amount_cents)::bigint AS spend, coalesce(sum(clicks), 0)::bigint AS clicks, coalesce(sum(impressions), 0)::bigint AS impressions
          FROM ad_spend
         WHERE spend_date >= ${range.from} AND spend_date <= ${range.to}
           ${f.platform ? sql`AND platform = ${f.platform}` : sql``}
           ${f.campaign ? sql`AND campaign = ${normalizeCampaign(f.campaign)}` : sql``}
         GROUP BY 1, 2`)
    ).map((r) => ({ platform: r.platform, campaign: r.campaign, spendCents: Number(r.spend), clicks: Number(r.clicks), impressions: Number(r.impressions) }));
  } catch {
    return [];
  }
}

export async function listSpend(range: { from: string; to: string }, limit = 500) {
  return db
    .select()
    .from(adSpend)
    .where(and(gte(adSpend.spend_date, range.from), lte(adSpend.spend_date, range.to)))
    .orderBy(desc(adSpend.spend_date), adSpend.platform, adSpend.campaign)
    .limit(limit);
}

/** Daily spend series for charts. */
export async function spendSeries(range: { from: string; to: string }, platform?: string): Promise<Map<string, number>> {
  const rows = rowsOf<{ d: string; spend: number }>(
    await db.execute(sql`SELECT spend_date::text AS d, sum(amount_cents)::bigint AS spend FROM ad_spend
                          WHERE spend_date >= ${range.from} AND spend_date <= ${range.to} ${platform ? sql`AND platform = ${platform}` : sql``} GROUP BY 1`)
  ).map((r) => [r.d.slice(0, 10), Number(r.spend)] as const);
  return new Map(rows);
}
