import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { BOOKING_SOURCES, BOOKING_STATUSES, listSessions, PAGE_SIZE, type SessionFilters } from '@/lib/crm/queries';
import { parsePage } from '@/lib/crm/range';
import { formatDateLabel, formatTimeLabel } from '@/lib/crm/time';
import { decimalToCents } from '@/lib/crm/money';
import { CATEGORY_LABELS, SERVICE_CATEGORIES } from '@/lib/catalog';
import { db } from '@/lib/db';
import { toDateOnly } from '@/lib/utils';
import { Badge, Card, EmptyState, Forbidden, Money, PageHeader, Pagination, StatusBadge, humanize, withParams } from '@/components/crm/ui';

export const dynamic = 'force-dynamic';

export default async function SessionsPage({ searchParams }: { searchParams: SessionFilters }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('bookings.read')) return <Forbidden what="sessions" />;

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
        title="Sessions"
        description={`${total} ${when === 'all' ? '' : when} session${total === 1 ? '' : 's'}`}
        actions={
          <>
            {admin.can('reports.export') && (
              <a href={exportHref} className="crm-btn">
                Export CSV
              </a>
            )}
            {admin.can('bookings.create') && (
              <Link href="/admin/sessions/new" className="crm-btn crm-btn-primary">
                New booking
              </Link>
            )}
          </>
        }
      />

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Upcoming or past">
        {(['upcoming', 'past', 'all'] as const).map((w) => (
          <Link key={w} role="tab" aria-selected={when === w} href={withParams('/admin/sessions', params, { when: w, page: undefined })} className={`crm-btn crm-btn-sm ${when === w ? '!border-zayro-primary !text-zayro-primary' : ''}`}>
            {humanize(w)}
          </Link>
        ))}
      </div>

      <form method="get" className="card !p-4 mb-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 items-end" aria-label="Filter sessions">
        <input type="hidden" name="when" value={when} />
        <div className="col-span-2">
          <label className="field-label" htmlFor="q">
            Search
          </label>
          <input id="q" name="q" defaultValue={searchParams.q} placeholder="Name, email, phone, booking ID" />
        </div>
        <div>
          <label className="field-label" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue={searchParams.status ?? ''}>
            <option value="">Any</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="category">
            Category
          </label>
          <select id="category" name="category" defaultValue={searchParams.category ?? ''}>
            <option value="">Any</option>
            {SERVICE_CATEGORIES.filter((c) => c !== 'package').map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="service">
            Service
          </label>
          <select id="service" name="service" defaultValue={searchParams.service ?? ''}>
            <option value="">Any</option>
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
            Source
          </label>
          <select id="source" name="source" defaultValue={searchParams.source ?? ''}>
            <option value="">Any</option>
            {BOOKING_SOURCES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="from">
            From
          </label>
          <input id="from" type="date" name="from" defaultValue={searchParams.from} />
        </div>
        <div>
          <label className="field-label" htmlFor="to">
            To
          </label>
          <input id="to" type="date" name="to" defaultValue={searchParams.to} />
        </div>
        <div>
          <label className="field-label" htmlFor="sort">
            Sort
          </label>
          <select id="sort" name="sort" defaultValue={searchParams.sort ?? ''}>
            <option value="">{when === 'past' ? 'Newest first' : 'Soonest first'}</option>
            <option value="start_asc">Start ↑</option>
            <option value="start_desc">Start ↓</option>
            <option value="created_desc">Recently created</option>
          </select>
        </div>
        <div className="col-span-2 md:col-span-4 xl:col-span-8 flex gap-2">
          <button type="submit" className="crm-btn crm-btn-primary">
            Apply filters
          </button>
          <Link href={`/admin/sessions?when=${when}`} className="crm-btn">
            Reset
          </Link>
        </div>
      </form>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No sessions match" body="Change the filters or switch between upcoming and past." />
        ) : (
          <div className="crm-table-wrap -mx-5 md:-mx-6 -my-5 md:-my-6">
            <table className="crm-table min-w-[860px]">
              <caption className="sr-only">Sessions</caption>
              <thead>
                <tr>
                  <th scope="col">When (ET)</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Service</th>
                  <th scope="col">Status</th>
                  {showMoney && (
                    <th scope="col" className="text-right">
                      Total
                    </th>
                  )}
                  <th scope="col">Source</th>
                  <th scope="col">Sync</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/admin/sessions/${b.id}`} className="font-medium">
                        {formatDateLabel(toDateOnly(b.booking_date))}
                      </Link>
                      <div className="text-xs text-zayro-gray">
                        {formatTimeLabel(b.start_time)} – {formatTimeLabel(b.end_time)} · <span className="font-mono">{b.booking_id}</span>
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
                      <div className="text-xs text-zayro-gray">{CATEGORY_LABELS[b.category] ?? b.category}</div>
                    </td>
                    <td>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={b.status} />
                        {b.payment_status !== 'succeeded' && decimalToCents(b.total_amount) > 0 && <StatusBadge status={b.payment_status} label={`Payment ${humanize(b.payment_status).toLowerCase()}`} />}
                        {b.needs_refund_review && <Badge tone="red">Refund decision</Badge>}
                      </div>
                    </td>
                    {showMoney && (
                      <td className="text-right">
                        <Money cents={decimalToCents(b.total_amount)} />
                      </td>
                    )}
                    <td className="text-xs">{humanize(b.source)}</td>
                    <td className="text-xs whitespace-nowrap">
                      {b.status === 'confirmed' || b.status === 'completed' ? (
                        <>
                          <span className={b.calendar ? 'text-emerald-700' : 'text-red-700'}>{b.calendar ? '✓' : '✗'} Cal</span>{' '}
                          <span className={b.sheet ? 'text-emerald-700' : 'text-zayro-gray'}>{b.sheet ? '✓' : '–'} Sheet</span>
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
