import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { listPurchases, PAGE_SIZE, type PurchaseFilters } from '@/lib/crm/queries';
import { parsePage } from '@/lib/crm/range';
import { getAdminI18n } from '@/lib/i18n/server';
import { Badge, Card, EmptyState, Forbidden, Money, PageHeader, Pagination, StatusBadge } from '@/components/crm/ui';
import { withParams } from '@/components/crm/ui-utils';

export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'paid', 'partially_refunded', 'refunded', 'approved', 'cancelled', 'failed'];
const TYPES = ['individual', 'studio_tour', 'package', 'manual', 'extension'];

export default async function PurchasesPage({ searchParams }: { searchParams: PurchaseFilters }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('purchases.read')) return <Forbidden what="purchases" />;
  const { t, f, label } = getAdminI18n(admin);

  const page = parsePage(searchParams.page);
  const { rows, total } = await listPurchases(searchParams, { page });
  const params = Object.fromEntries(Object.entries(searchParams).filter(([k, v]) => k !== 'page' && typeof v === 'string')) as Record<string, string>;

  return (
    <>
      <PageHeader
        title={t('common.nav.purchases')}
        description={t('purchases.count', { count: total })}
        actions={
          admin.can('reports.export') && (
            <a href={withParams('/api/admin/export/purchases', params, {})} className="crm-btn">
              {t('common.actions.exportCsv')}
            </a>
          )
        }
      />
      <form method="get" className="card !p-4 mb-4 grid grid-cols-2 md:grid-cols-6 gap-2 items-end" aria-label={t('purchases.filterLabel')}>
        <div className="col-span-2">
          <label className="field-label" htmlFor="q">
            {t('purchases.search')}
          </label>
          <input id="q" name="q" defaultValue={searchParams.q} placeholder={t('purchases.searchPlaceholder')} />
        </div>
        <div>
          <label className="field-label" htmlFor="status">
            {t('purchases.status')}
          </label>
          <select id="status" name="status" defaultValue={searchParams.status ?? ''}>
            <option value="">{t('purchases.any')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="type">
            {t('purchases.type')}
          </label>
          <select id="type" name="type" defaultValue={searchParams.type ?? ''}>
            <option value="">{t('purchases.any')}</option>
            {TYPES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="from">
            {t('purchases.createdFrom')}
          </label>
          <input id="from" type="date" name="from" defaultValue={searchParams.from} />
        </div>
        <div>
          <label className="field-label" htmlFor="to">
            {t('purchases.to')}
          </label>
          <input id="to" type="date" name="to" defaultValue={searchParams.to} />
        </div>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="review" value="1" defaultChecked={searchParams.review === '1'} /> {t('purchases.reviewOnly')}
        </label>
        <div className="col-span-2 md:col-span-4 flex gap-2 md:justify-end">
          <button type="submit" className="crm-btn crm-btn-primary">
            {t('common.actions.apply')}
          </button>
          <Link href="/admin/purchases" className="crm-btn">
            {t('purchases.reset')}
          </Link>
        </div>
      </form>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t('purchases.empty')} />
        ) : (
          <div className="crm-table-wrap -mx-5 md:-mx-6 -my-5 md:-my-6">
            <table className="crm-table min-w-[900px]">
              <caption className="sr-only">{t('purchases.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('purchases.cols.order')}</th>
                  <th scope="col">{t('purchases.cols.customer')}</th>
                  <th scope="col">{t('purchases.cols.type')}</th>
                  <th scope="col">{t('purchases.cols.status')}</th>
                  {(['subtotal', 'tax', 'total', 'refunded'] as const).map((c) => (
                    <th key={c} scope="col" className="text-right">
                      {t(`purchases.cols.${c}`)}
                    </th>
                  ))}
                  <th scope="col">{t('purchases.cols.paid')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/admin/purchases/${p.id}`} className="font-mono text-xs">
                        {p.order_number}
                      </Link>
                      {p.needs_refund_review && (
                        <div className="mt-1">
                          <Badge tone="red">{t('purchases.refundDecision')}</Badge>
                        </div>
                      )}
                    </td>
                    <td className="min-w-[160px]">
                      {[p.first, p.last].filter(Boolean).join(' ') || '—'}
                      <div className="text-xs text-zayro-gray break-all">{p.email}</div>
                    </td>
                    <td>
                      {label(p.type)}
                      <div className="text-xs text-zayro-gray">{label(p.payment_method)}</div>
                    </td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="text-right">
                      <Money cents={p.subtotal_cents} />
                    </td>
                    <td className="text-right">
                      <Money cents={p.tax_cents} />
                    </td>
                    <td className="text-right font-medium">
                      <Money cents={p.total_cents} />
                    </td>
                    <td className="text-right">{p.refunded_cents ? <Money cents={p.refunded_cents} /> : <span className="text-zayro-gray">—</span>}</td>
                    <td className="text-xs text-zayro-gray whitespace-nowrap">{p.purchased_at ? f.instant(p.purchased_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pagination base="/admin/purchases" params={params} page={page} pageSize={PAGE_SIZE} total={total} />
    </>
  );
}
