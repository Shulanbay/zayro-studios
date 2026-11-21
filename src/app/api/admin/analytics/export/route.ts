import { NextRequest, NextResponse } from 'next/server';
import { actorOf, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { csvFilename, toCsv, type CsvColumn } from '@/lib/crm/csv';
import { errorResponse } from '@/lib/crm/errors';
import { parseRange } from '@/lib/crm/range';
import { addDays } from '@/lib/crm/time';
import { exportRows, parseModel, type ExportRow } from '@/lib/analytics/server/metrics';
import { getAdminI18n } from '@/lib/i18n/server';
import type { AdminI18n } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

const money = (cents: number) => (cents / 100).toFixed(2);
const rate = (a: number, b: number) => (b > 0 ? (a / b).toFixed(4) : '');

/**
 * Aggregate marketing CSV: one row per day × source × medium × campaign.
 * Only these columns exist — no names, emails, phones, companies, notes,
 * booking references, Stripe / Calendar IDs, tokens, click IDs, IPs or
 * User-Agents. Formula-injection safe (shared CSV writer). Audited.
 */
/** Column headers follow the admin's language; values stay machine-readable (ISO dates, dot decimals, USD). */
function columns({ t }: AdminI18n): CsvColumn<ExportRow>[] {
  const h = (key: 'date' | 'source' | 'medium' | 'campaign' | 'sessions' | 'visitors' | 'pageViews' | 'bookingStarts' | 'checkouts' | 'purchases' | 'gross' | 'refunds' | 'net' | 'startRate' | 'purchaseRate') =>
    t(`analytics.export.${key}`);
  return [
    { header: h('date'), value: (r) => r.date },
    { header: h('source'), value: (r) => r.source },
    { header: h('medium'), value: (r) => r.medium },
    { header: h('campaign'), value: (r) => r.campaign },
    { header: h('sessions'), value: (r) => r.sessions },
    { header: h('visitors'), value: (r) => r.visitors },
    { header: h('pageViews'), value: (r) => r.pageViews },
    { header: h('bookingStarts'), value: (r) => r.bookingStarts },
    { header: h('checkouts'), value: (r) => r.checkouts },
    { header: h('purchases'), value: (r) => r.purchases },
    { header: h('gross'), value: (r) => money(r.gross) },
    { header: h('refunds'), value: (r) => money(r.refunds) },
    { header: h('net'), value: (r) => money(r.net) },
    { header: h('startRate'), value: (r) => rate(r.bookingStarts, r.sessions) },
    { header: h('purchaseRate'), value: (r) => rate(r.purchases, r.sessions) },
  ];
}


export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, 'analytics.export');
  if (!guard.ok) return guard.response;
  try {
    const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
    let range = parseRange(sp, 30);
    if (range.from < addDays(range.to, -400)) range = { from: addDays(range.to, -400), to: range.to };
    const model = parseModel(sp.model);
    const rows = await exportRows(range, model);
    const csv = toCsv(columns(getAdminI18n(guard.admin)), rows);
    await writeAudit({ actor: actorOf(guard.admin), operation: 'analytics.export', entityType: 'analytics', metadata: { from: range.from, to: range.to, model, rows: rows.length } });
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFilename(`marketing-${range.from}-to-${range.to}`)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return errorResponse(error, 'analytics export');
  }
}
