import { NextRequest, NextResponse } from 'next/server';
import { actorOf, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { csvFilename, toCsv, type CsvColumn } from '@/lib/crm/csv';
import { errorResponse } from '@/lib/crm/errors';
import { parseRange } from '@/lib/crm/range';
import { addDays } from '@/lib/crm/time';
import { exportRows, parseModel, type ExportRow } from '@/lib/analytics/server/metrics';

export const dynamic = 'force-dynamic';

const money = (cents: number) => (cents / 100).toFixed(2);
const rate = (a: number, b: number) => (b > 0 ? (a / b).toFixed(4) : '');

/**
 * Aggregate marketing CSV: one row per day × source × medium × campaign.
 * Only these columns exist — no names, emails, phones, companies, notes,
 * booking references, Stripe / Calendar IDs, tokens, click IDs, IPs or
 * User-Agents. Formula-injection safe (shared CSV writer). Audited.
 */
const COLUMNS: CsvColumn<ExportRow>[] = [
  { header: 'Date (ET)', value: (r) => r.date },
  { header: 'Source', value: (r) => r.source },
  { header: 'Medium', value: (r) => r.medium },
  { header: 'Campaign', value: (r) => r.campaign },
  { header: 'Sessions', value: (r) => r.sessions },
  { header: 'Visitors', value: (r) => r.visitors },
  { header: 'Page views', value: (r) => r.pageViews },
  { header: 'Booking starts', value: (r) => r.bookingStarts },
  { header: 'Checkouts', value: (r) => r.checkouts },
  { header: 'Purchases', value: (r) => r.purchases },
  { header: 'Gross revenue (USD)', value: (r) => money(r.gross) },
  { header: 'Refunds (USD)', value: (r) => money(r.refunds) },
  { header: 'Net revenue (USD)', value: (r) => money(r.net) },
  { header: 'Booking start rate (starts / sessions)', value: (r) => rate(r.bookingStarts, r.sessions) },
  { header: 'Purchase rate (purchases / sessions)', value: (r) => rate(r.purchases, r.sessions) },
];


export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, 'analytics.export');
  if (!guard.ok) return guard.response;
  try {
    const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
    let range = parseRange(sp, 30);
    if (range.from < addDays(range.to, -400)) range = { from: addDays(range.to, -400), to: range.to };
    const model = parseModel(sp.model);
    const rows = await exportRows(range, model);
    const csv = toCsv(COLUMNS, rows);
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
