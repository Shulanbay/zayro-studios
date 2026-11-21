import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { BOOKING_SOURCES, BOOKING_STATUSES, listSessions, PAGE_SIZE, type SessionFilters } from '@/lib/crm/queries';
import { parsePage } from '@/lib/crm/range';
import { decimalToCents } from '@/lib/crm/money';
import { SERVICE_CATEGORIES } from '@/lib/catalog';
import { getAdminI18n } from '@/lib/i18n/server';
import { db } from '@/lib/db';
import { toDateOnly } from '@/lib/utils';
import { Badge, Card, EmptyState, Forbidden, Money, PageHeader, Pagination, StatusBadge } from '@/components/crm/ui';
import { withParams } from '@/components/crm/ui-utils';

export const dynamic = 'force-dynamic';

export default async function SessionsPage({ searchParams }: { searchParams: SessionFilters }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('bookings.read')) return <Forbidden what="sessions" />;
  const { t, f, label } = getAdminI18n(admin);

  const when = searchParams.when === 'past' || searchParams.when === 'all' ? searchParams.when : 'upcoming';
  const filters: SessionFilters = { ...searchParams, when };
  const page = parsePage(searchParams.page);
  const [{ rows, total }, services] = await Promise.all([
    listSessions(filters, { page }),
    db.query.services.findMany({ orderBy: (s, { asc }) => [asc(s.category), asc(s.display_order)] }),
  ]);
  const showMoney = admin.can('purchases.read');
  const params = Object.fromEntries(Object.entries(filters).filter(([k, v]) => k !== 'page' && typeof v === 'string')) as Record<string, string>;
  const exportHref = withParams('/api/admin/export/sessions', params, {});

  return (
    <>
      <PageHeader
        title={t('common.nav.sessions')}
        description={t(when === 'past' ? 'sessions.list.countPast' : when === 'all' ? 'sessions.list.countAll' : 'sessions.list.countUpcoming', { count: total })}
        actions={
          <>
            {admin.can('reports.export') && (
              <a href={exportHref} className="crm-btn">
                {t('common.actions.exportCsv')}
              </a>
            )}
            {admin.can('bookings.create') && (
              <Link href="/admin/sessions/new" className="crm-btn crm-btn-primary">
                {t('sessions.newBooking.title')}
              </Link>
            )}
          </>
        }
      />

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label={t('sessions.list.tabsLabel')}>
        {(['upcoming', 'past', 'all'] as const).map((w) => (
          <Link key={w} role="tab" aria-selected={when === w} href={withParams('/admin/sessions', params, { when: w, page: undefined })} className={`crm-btn crm-btn-sm ${when === w ? '!border-zayro-primary !text-zayro-primary' : ''}`}>
            {t(`sessions.list.tabs.${w}`)}
          </Link>
        ))}
      </div>

      <form method="get" className="card !p-4 mb-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 items-end" aria-label={t('sessions.list.filterLabel')}>
        <input type="hidden" name="when" value={when} />
        <div className="col-span-2">
          <label className="field-label" htmlFor="q">
            {t('sessions.list.search')}
          </label>
          <input id="q" name="q" defaultValue={searchParams.q} placeholder={t('sessions.list.searchPlaceholder')} />
        </div>
        <div>
          <label className="field-label" htmlFor="status">
            {t('sessions.list.status')}
          </label>
          <select id="status" name="status" defaultValue={searchParams.status ?? ''}>
            <option value="">{t('sessions.list.any')}</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="category">
            {t('sessions.list.category')}
          </label>
          <select id="category" name="category" defaultValue={searchParams.category ?? ''}>
            <option value="">{t('sessions.list.any')}</option>
            {SERVICE_CATEGORIES.filter((c) => c !== 'package').map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="service">
            {t('sessions.list.service')}
          </label>
          <select id="service" name="service" defaultValue={searchParams.service ?? ''}>
            <option value="">{t('sessions.list.any')}</option>
            {services
              .filter((s) => s.category !== 'package')
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="source">
            {t('sessions.list.source')}
          </label>
          <select id="source" name="source" defaultValue={searchParams.source ?? ''}>
            <option value="">{t('sessions.list.any')}</option>
            {BOOKING_SOURCES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="from">
            {t('sessions.list.from')}
          </label>
          <input id="from" type="date" name="from" defaultValue={searchParams.from} />
        </div>
        <div>
          <label className="field-label" htmlFor="to">
            {t('sessions.list.to')}
          </label>
          <input id="to" type="date" name="to" defaultValue={searchParams.to} />
        </div>
        <div>
          <label className="field-label" htmlFor="sort">
            {t('sessions.list.sort')}
          </label>
          <select id="sort" name="sort" defaultValue={searchParams.sort ?? ''}>
            <option value="">{when === 'past' ? t('sessions.list.newestFirst') : t('sessions.list.soonestFirst')}</option>
            <option value="start_asc">{t('sessions.list.startAsc')}</option>
            <option value="start_desc">{t('sessions.list.startDesc')}</option>
            <option value="created_desc">{t('sessions.list.recentlyCreated')}</option>
          </select>
        </div>
        <div className="col-span-2 md:col-span-4 xl:col-span-8 flex gap-2">
          <button type="submit" className="crm-btn crm-btn-primary">
            {t('sessions.list.applyFilters')}
          </button>
          <Link href={`/admin/sessions?when=${when}`} className="crm-btn">
            {t('sessions.list.reset')}
          </Link>
        </div>
      </form>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t('sessions.list.emptyTitle')} body={t('sessions.list.emptyBody')} />
        ) : (
          <div className="crm-table-wrap -mx-5 md:-mx-6 -my-5 md:-my-6">
            <table className="crm-table min-w-[860px]">
              <caption className="sr-only">{t('sessions.list.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('sessions.list.cols.when')}</th>
                  <th scope="col">{t('sessions.list.cols.customer')}</th>
                  <th scope="col">{t('sessions.list.cols.service')}</th>
                  <th scope="col">{t('sessions.list.cols.status')}</th>
                  {showMoney && (
                    <th scope="col" className="text-right">
                      {t('sessions.list.cols.total')}
                    </th>
                  )}
                  <th scope="col">{t('sessions.list.cols.source')}</th>
                  <th scope="col">{t('sessions.list.cols.sync')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/admin/sessions/${b.id}`} className="font-medium">
                        {f.date(toDateOnly(b.booking_date))}
                      </Link>
                      <div className="text-xs text-zayro-gray">
                        {f.time(b.start_time)} – {f.time(b.end_time)} · <span className="font-mono">{b.booking_id}</span>
                      </div>
                    </td>
                    <td className="min-w-[180px]">
                      <span className="text-zayro-dark">
                        {b.first} {b.last}
                      </span>
                      <div className="text-xs text-zayro-gray break-all">{b.email}</div>
                    </td>
                    <td>
                      {b.service}
                      <div className="text-xs text-zayro-gray">{label(b.category)}</div>
                    </td>
                    <td>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={b.status} />
                        {b.payment_status !== 'succeeded' && decimalToCents(b.total_amount) > 0 && <StatusBadge status={b.payment_status} prefix="payment" />}
                        {b.needs_refund_review && <Badge tone="red">{t('sessions.list.refundDecision')}</Badge>}
                      </div>
                    </td>
                    {showMoney && (
                      <td className="text-right">
                        <Money cents={decimalToCents(b.total_amount)} />
                      </td>
                    )}
                    <td className="text-xs">{label(b.source)}</td>
                    <td className="text-xs whitespace-nowrap">
                      {b.status === 'confirmed' || b.status === 'completed' ? (
                        <>
                          <span className={b.calendar ? 'text-emerald-700' : 'text-red-700'}>{b.calendar ? '✓' : '✗'} {t('sessions.list.cal')}</span>{' '}
                          <span className={b.sheet ? 'text-emerald-700' : 'text-zayro-gray'}>
                            {b.sheet ? '✓' : '–'} {t('sessions.list.sheet')}
                          </span>
                        </>
                      ) : (
                        <span className="text-zayro-gray">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pagination base="/admin/sessions" params={params} page={page} pageSize={PAGE_SIZE} total={total} />
    </>
  );
}
