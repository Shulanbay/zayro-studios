import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { listCustomers, PAGE_SIZE, type CustomerFilters } from '@/lib/crm/queries';
import { parsePage } from '@/lib/crm/range';
import { getAdminI18n } from '@/lib/i18n/server';
import { Card, EmptyState, Forbidden, Money, PageHeader, Pagination, StatusBadge } from '@/components/crm/ui';
import { withParams } from '@/components/crm/ui-utils';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({ searchParams }: { searchParams: CustomerFilters }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('customers.read')) return <Forbidden what="customers" />;
  const { t, f } = getAdminI18n(admin);

  const page = parsePage(searchParams.page);
  const { rows, total } = await listCustomers(searchParams, { page });
  const showMoney = admin.can('purchases.read');
  const params = Object.fromEntries(Object.entries(searchParams).filter(([k, v]) => k !== 'page' && typeof v === 'string')) as Record<string, string>;

  return (
    <>
      <PageHeader
        title={t('common.nav.customers')}
        description={t('customers.count', { count: total })}
        actions={
          admin.can('reports.export') && (
            <a href={withParams('/api/admin/export/customers', params, {})} className="crm-btn">
              {t('common.actions.exportCsv')}
            </a>
          )
        }
      />
      <form method="get" className="card !p-4 mb-4 grid grid-cols-1 sm:grid-cols-[1fr_160px_180px_auto] gap-2 items-end" aria-label={t('customers.filterLabel')}>
        <div>
          <label className="field-label" htmlFor="q">
            {t('customers.search')}
          </label>
          <input id="q" name="q" defaultValue={searchParams.q} placeholder={t('customers.searchPlaceholder')} />
        </div>
        <div>
          <label className="field-label" htmlFor="status">
            {t('customers.status')}
          </label>
          <select id="status" name="status" defaultValue={searchParams.status ?? ''}>
            <option value="">{t('customers.activeArchived')}</option>
            <option value="active">{t('common.status.active')}</option>
            <option value="archived">{t('common.status.archived')}</option>
            <option value="merged">{t('common.status.merged')}</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="sort">
            {t('customers.sort')}
          </label>
          <select id="sort" name="sort" defaultValue={searchParams.sort ?? ''}>
            <option value="">{t('customers.lastBooking')}</option>
            {showMoney && <option value="spent">{t('customers.totalSpent')}</option>}
            <option value="bookings">{t('customers.bookings')}</option>
            <option value="name">{t('customers.name')}</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="crm-btn crm-btn-primary">
            {t('common.actions.apply')}
          </button>
          <Link href="/admin/customers" className="crm-btn">
            {t('customers.reset')}
          </Link>
        </div>
      </form>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t('customers.emptyTitle')} body={t('customers.emptyBody')} />
        ) : (
          <div className="crm-table-wrap -mx-5 md:-mx-6 -my-5 md:-my-6">
            <table className="crm-table min-w-[720px]">
              <caption className="sr-only">{t('customers.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('customers.cols.customer')}</th>
                  <th scope="col">{t('customers.cols.phone')}</th>
                  <th scope="col">{t('customers.cols.status')}</th>
                  {showMoney && (
                    <th scope="col" className="text-right">
                      {t('customers.cols.totalSpent')}
                    </th>
                  )}
                  <th scope="col" className="text-right">
                    {t('customers.cols.bookings')}
                  </th>
                  <th scope="col">{t('customers.cols.lastBooking')}</th>
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
                    <td className="text-right tabular-nums">{f.number(c.booking_count)}</td>
                    <td className="text-xs text-zayro-gray whitespace-nowrap">{c.last_booking_at ? f.instant(c.last_booking_at) : '—'}</td>
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
