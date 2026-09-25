import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { listCustomers, PAGE_SIZE, type CustomerFilters } from '@/lib/crm/queries';
import { parsePage } from '@/lib/crm/range';
import { formatInstantEt } from '@/lib/crm/time';
import { Card, EmptyState, Forbidden, Money, PageHeader, Pagination, StatusBadge, withParams } from '@/components/crm/ui';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({ searchParams }: { searchParams: CustomerFilters }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('customers.read')) return <Forbidden what="customers" />;

  const page = parsePage(searchParams.page);
  const { rows, total } = await listCustomers(searchParams, { page });
  const showMoney = admin.can('purchases.read');
  const params = Object.fromEntries(Object.entries(searchParams).filter(([k, v]) => k !== 'page' && typeof v === 'string')) as Record<string, string>;

  return (
    <>
      <PageHeader
        title="Customers"
        description={`${total} customer${total === 1 ? '' : 's'}`}
        actions={admin.can('reports.export') && <a href={withParams('/api/admin/export/customers', params, {})} className="crm-btn">Export CSV</a>}
      />
      <form method="get" className="card !p-4 mb-4 grid grid-cols-1 sm:grid-cols-[1fr_160px_180px_auto] gap-2 items-end" aria-label="Filter customers">
        <div>
          <label className="field-label" htmlFor="q">
            Search
          </label>
          <input id="q" name="q" defaultValue={searchParams.q} placeholder="Name, email, phone, company" />
        </div>
        <div>
          <label className="field-label" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue={searchParams.status ?? ''}>
            <option value="">Active & archived</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="merged">Merged</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="sort">
            Sort
          </label>
          <select id="sort" name="sort" defaultValue={searchParams.sort ?? ''}>
            <option value="">Last booking</option>
            {showMoney && <option value="spent">Total spent</option>}
            <option value="bookings">Bookings</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="crm-btn crm-btn-primary">
            Apply
          </button>
          <Link href="/admin/customers" className="crm-btn">
            Reset
          </Link>
        </div>
      </form>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No customers match" body="Customers are created automatically from bookings." />
        ) : (
          <div className="crm-table-wrap -mx-5 md:-mx-6 -my-5 md:-my-6">
            <table className="crm-table min-w-[720px]">
              <caption className="sr-only">Customers</caption>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Status</th>
                  {showMoney && (
                    <th scope="col" className="text-right">
                      Total spent
                    </th>
                  )}
                  <th scope="col" className="text-right">
                    Bookings
                  </th>
                  <th scope="col">Last booking</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/admin/customers/${c.id}`} className="font-medium">
                        {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email}
                      </Link>
                      <div className="text-xs text-zayro-gray break-all">
                        {c.email}
                        {c.company ? ` · ${c.company}` : ''}
                      </div>
                    </td>
                    <td className="text-sm whitespace-nowrap">{c.phone || '—'}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    {showMoney && (
                      <td className="text-right">
                        <Money cents={c.total_spent_cents} />
                      </td>
                    )}
                    <td className="text-right tabular-nums">{c.booking_count}</td>
                    <td className="text-xs text-zayro-gray whitespace-nowrap">{c.last_booking_at ? formatInstantEt(c.last_booking_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pagination base="/admin/customers" params={params} page={page} pageSize={PAGE_SIZE} total={total} />
    </>
  );
}
