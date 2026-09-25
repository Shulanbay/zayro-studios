import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { parseRange } from '@/lib/crm/range';
import { Card, Forbidden, PageHeader } from '@/components/crm/ui';

export const dynamic = 'force-dynamic';

const EXPORTS = [
  { kind: 'sessions', title: 'Sessions', body: 'Every booking that starts in the range, with customer contact, service and status.', money: false, extra: 'status' },
  { kind: 'customers', title: 'Customers', body: 'All customers with booking count, lifetime spend and marketing consent (date range not applied).', money: false },
  { kind: 'purchases', title: 'Purchases', body: 'Orders created in the range: subtotal, tax, total, refunds and net.', money: true },
  { kind: 'refunds', title: 'Refunds', body: 'Refunds issued in the range with reason and who requested them.', money: true },
  { kind: 'package-credits', title: 'Package credits', body: 'The credit ledger: grants, redemptions, restorations, expiry and adjustments.', money: false },
];

export default async function ReportsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('reports.export')) return <Forbidden what="exports" />;
  const range = parseRange(searchParams, 30);
  const exports = EXPORTS.filter((e) => (!e.money || admin.can('purchases.read')) && (e.kind !== 'package-credits' || admin.can('packages.read')));

  return (
    <>
      <PageHeader title="Reports" description="CSV exports in UTF-8, safe to open in Excel, Numbers or Google Sheets. Every export is recorded in the audit log." />
      <form method="get" className="card !p-4 mb-4 flex flex-wrap items-end gap-2" aria-label="Date range">
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
        <button type="submit" className="crm-btn">
          Set range
        </button>
      </form>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {exports.map((e) => {
          const href = `/api/admin/export/${e.kind}${e.kind === 'customers' ? '' : `?from=${range.from}&to=${range.to}`}`;
          return (
            <Card key={e.kind} title={e.title}>
              <p className="text-sm text-zayro-gray mb-4">{e.body}</p>
              <a href={href} className="crm-btn crm-btn-primary" download>
                Download CSV
              </a>
            </Card>
          );
        })}
      </div>
    </>
  );
}
