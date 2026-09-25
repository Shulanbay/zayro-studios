import { NextRequest, NextResponse } from 'next/server';
import { actorOf, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { csvFilename, toCsv, type CsvColumn } from '@/lib/crm/csv';
import { EXPORT_LIMIT, listCreditTransactions, listCustomers, listPurchases, listRefunds, listSessions } from '@/lib/crm/queries';
import { decimalToCents } from '@/lib/crm/money';
import { utcToWall } from '@/lib/crm/time';
import { toDateOnly } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const money = (cents: number | null | undefined) => ((cents ?? 0) / 100).toFixed(2);
const et = (d: Date | string | null | undefined) => {
  if (!d) return '';
  const w = utcToWall(d instanceof Date ? d : new Date(d));
  return `${w.date} ${w.time}`;
};

/**
 * CSV exports with the same filters as the list pages. No secrets or raw
 * payment data are ever included (Stripe ids are references, not
 * credentials). Every export is audited.
 */
export async function GET(request: NextRequest, { params }: { params: { kind: string } }) {
  const guard = await requirePermission(request, 'reports.export');
  if (!guard.ok) return guard.response;
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  if (['purchases', 'refunds'].includes(params.kind) && !guard.admin.can('purchases.read')) {
    return NextResponse.json({ error: 'Your role cannot export financial data' }, { status: 403 });
  }
  const withMoney = guard.admin.can('purchases.read');

  let csv: string;
  let count: number;
  switch (params.kind) {
    case 'sessions': {
      const { rows } = await listSessions({ ...sp, when: sp.when === 'upcoming' || sp.when === 'past' ? sp.when : undefined }, { pageSize: EXPORT_LIMIT });
      type R = (typeof rows)[number];
      const cols: CsvColumn<R>[] = [
        { header: 'Booking ID', value: (r) => r.booking_id },
        { header: 'Date', value: (r) => toDateOnly(r.booking_date) },
        { header: 'Start (ET)', value: (r) => r.start_time },
        { header: 'End (ET)', value: (r) => r.end_time },
        { header: 'Minutes', value: (r) => r.duration_minutes },
        { header: 'Service', value: (r) => r.service },
        { header: 'Category', value: (r) => r.category },
        { header: 'Status', value: (r) => r.status },
        { header: 'Payment status', value: (r) => r.payment_status },
        { header: 'Source', value: (r) => r.source },
        { header: 'First name', value: (r) => r.first },
        { header: 'Last name', value: (r) => r.last },
        { header: 'Email', value: (r) => r.email },
        { header: 'Phone', value: (r) => r.phone },
        { header: 'Company', value: (r) => r.company },
        ...(withMoney ? [{ header: 'Total (USD)', value: (r: R) => money(decimalToCents(r.total_amount)) }] : []),
        { header: 'Created (ET)', value: (r) => et(r.created_at) },
      ];
      csv = toCsv(cols, rows);
      count = rows.length;
      break;
    }
    case 'customers': {
      const { rows } = await listCustomers(sp, { pageSize: EXPORT_LIMIT });
      type R = (typeof rows)[number];
      const cols: CsvColumn<R>[] = [
        { header: 'Email', value: (r) => r.email },
        { header: 'First name', value: (r) => r.first_name },
        { header: 'Last name', value: (r) => r.last_name },
        { header: 'Phone', value: (r) => r.phone },
        { header: 'Company', value: (r) => r.company },
        { header: 'Status', value: (r) => r.status },
        { header: 'Bookings', value: (r) => r.booking_count },
        ...(withMoney ? [{ header: 'Total spent (USD)', value: (r: R) => money(r.total_spent_cents) }] : []),
        { header: 'Last booking (ET)', value: (r) => et(r.last_booking_at) },
        { header: 'Marketing consent', value: (r) => r.marketing_consent },
        { header: 'Customer since (ET)', value: (r) => et(r.created_at) },
      ];
      csv = toCsv(cols, rows);
      count = rows.length;
      break;
    }
    case 'purchases': {
      const { rows } = await listPurchases(sp, { pageSize: EXPORT_LIMIT });
      type R = (typeof rows)[number];
      csv = toCsv<R>(
        [
          { header: 'Order', value: (r) => r.order_number },
          { header: 'Type', value: (r) => r.type },
          { header: 'Status', value: (r) => r.status },
          { header: 'Method', value: (r) => r.payment_method },
          { header: 'Customer email', value: (r) => r.email },
          { header: 'Customer name', value: (r) => [r.first, r.last].filter(Boolean).join(' ') },
          { header: 'Subtotal (USD)', value: (r) => money(r.subtotal_cents) },
          { header: 'Tax (USD)', value: (r) => money(r.tax_cents) },
          { header: 'Total (USD)', value: (r) => money(r.total_cents) },
          { header: 'Refunded (USD)', value: (r) => money(r.refunded_cents) },
          { header: 'Net (USD)', value: (r) => money(r.total_cents - r.refunded_cents) },
          { header: 'Promotion code', value: (r) => r.promotion_code },
          { header: 'Stripe payment', value: (r) => r.stripe_payment_intent_id },
          { header: 'Needs refund decision', value: (r) => r.needs_refund_review },
          { header: 'Paid (ET)', value: (r) => et(r.purchased_at) },
          { header: 'Created (ET)', value: (r) => et(r.created_at) },
        ],
        rows
      );
      count = rows.length;
      break;
    }
    case 'refunds': {
      const rows = await listRefunds(sp);
      csv = toCsv<(typeof rows)[number]>(
        [
          { header: 'Refunded (ET)', value: (r) => et(r.created_at) },
          { header: 'Order', value: (r) => r.order_number },
          { header: 'Booking ID', value: (r) => r.booking_code },
          { header: 'Customer email', value: (r) => r.email },
          { header: 'Amount (USD)', value: (r) => money(r.amount_cents) },
          { header: 'Status', value: (r) => r.status },
          { header: 'Reason', value: (r) => r.reason },
          { header: 'Source', value: (r) => r.source },
          { header: 'Requested by', value: (r) => r.requested_by },
          { header: 'Stripe refund', value: (r) => r.stripe_refund_id },
        ],
        rows
      );
      count = rows.length;
      break;
    }
    case 'package-credits': {
      if (!guard.admin.can('packages.read')) return NextResponse.json({ error: 'Your role cannot export packages' }, { status: 403 });
      const rows = await listCreditTransactions(sp);
      csv = toCsv<(typeof rows)[number]>(
        [
          { header: 'When (ET)', value: (r) => et(r.created_at) },
          { header: 'Customer email', value: (r) => r.email },
          { header: 'Package', value: (r) => r.plan },
          { header: 'Type', value: (r) => r.type },
          { header: 'Credits', value: (r) => r.credits },
          { header: 'Balance after', value: (r) => r.balance_after },
          { header: 'Booking ID', value: (r) => r.booking_code },
          { header: 'Reason', value: (r) => r.reason },
          { header: 'By', value: (r) => r.actor_email },
          { header: 'Package id', value: (r) => r.package_id },
        ],
        rows
      );
      count = rows.length;
      break;
    }
    default:
      return NextResponse.json({ error: 'Unknown export' }, { status: 404 });
  }

  await writeAudit({
    actor: actorOf(guard.admin),
    operation: 'report.export',
    entityType: 'export',
    entityId: params.kind,
    metadata: { rows: count, filters: sp },
  });

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename(params.kind)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
