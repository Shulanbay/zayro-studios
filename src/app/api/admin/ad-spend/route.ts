import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sql, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { adSpend } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { normalizeCampaign, SPEND_PLATFORMS } from '@/lib/marketing/spend';
import { isSpendDate } from '@/lib/marketing/spendCsv';

export const dynamic = 'force-dynamic';

const row = z.object({
  date: z.string().refine(isSpendDate),
  platform: z.enum(SPEND_PLATFORMS),
  campaign: z.string().max(150).optional().default(''),
  amount: z.number().min(0).max(1_000_000),
  clicks: z.number().int().min(0).max(100_000_000).nullable().optional(),
  impressions: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
const schema = z.object({ rows: z.array(row).min(1).max(500) });

/** Add or replace spend rows (same day + platform + campaign = replace). */
export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'marketing.spend');
  if (!guard.ok) return guard.response;
  const parsed = schema.safeParse(await readJsonObject(request));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: `Row ${Number(issue?.path[1] ?? 0) + 1}: invalid ${String(issue?.path[2] ?? 'value')}` }, { status: 400 });
  }
  const mapped = parsed.data.rows.map((r) => ({
    spend_date: r.date,
    platform: r.platform,
    campaign: normalizeCampaign(r.campaign),
    amount_cents: Math.round(r.amount * 100),
    clicks: r.clicks ?? null,
    impressions: r.impressions ?? null,
    notes: r.notes || null,
    created_by: guard.admin.email,
  }));
  // A pasted export can repeat a day + platform + campaign: the last line wins (one upsert can't touch a row twice).
  const values = [...new Map(mapped.map((v) => [`${v.spend_date}|${v.platform}|${v.campaign}`, v])).values()];
  await db
    .insert(adSpend)
    .values(values)
    .onConflictDoUpdate({
      target: [adSpend.spend_date, adSpend.platform, adSpend.campaign],
      set: { amount_cents: sql`excluded.amount_cents`, clicks: sql`excluded.clicks`, impressions: sql`excluded.impressions`, notes: sql`excluded.notes`, created_by: sql`excluded.created_by`, updated_at: new Date() },
    });
  const total = values.reduce((a, v) => a + v.amount_cents, 0);
  await writeAudit({ actor: actorOf(guard.admin), operation: 'ad_spend.save', entityType: 'ad_spend', metadata: { rows: values.length, totalCents: total, platforms: [...new Set(values.map((v) => v.platform))] } });
  return NextResponse.json({ message: `Saved ${values.length} row(s)`, saved: values.length });
}

export async function DELETE(request: NextRequest) {
  const guard = await requirePermission(request, 'marketing.spend');
  if (!guard.ok) return guard.response;
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const [gone] = await db.delete(adSpend).where(eq(adSpend.id, id)).returning();
  if (!gone) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await writeAudit({ actor: actorOf(guard.admin), operation: 'ad_spend.delete', entityType: 'ad_spend', entityId: id, before: { date: gone.spend_date, platform: gone.platform, campaign: gone.campaign, amountCents: gone.amount_cents } });
  return NextResponse.json({ message: 'Deleted' });
}
