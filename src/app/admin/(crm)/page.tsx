import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { attentionItems, moneyMetrics, recentPurchases, sessionMetrics, upcomingSessions } from '@/lib/crm/metrics';
import { parseRange } from '@/lib/crm/range';
import { addDays, formatDateLabel, formatInstantEt, formatTimeLabel, todayInTz } from '@/lib/crm/time';
import { toDateOnly } from '@/lib/utils';
import { Card, EmptyState, Forbidden, Money, Notice, PageHeader, StatCard, StatusBadge, humanize } from '@/components/crm/ui';
import { formatCents } from '@/lib/crm/money';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('bookings.read')) return <Forbidden what="the dashboard" />;

  const range = parseRange(searchParams, 30);
  const showMoney = admin.can('reports.read');
  const [sessions, money, attention, upcoming, recent] = await Promise.all([
    sessionMetrics(range),
    showMoney ? moneyMetrics(range) : null,
    attentionItems(),
    upcomingSessions(8),
    showMoney ? recentPurchases(8) : [],
  ]);

  const today = todayInTz();
  const presets = [
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
    { label: 'Month to date', from: `${today.slice(0, 8)}01`, to: today },
    { label: 'Next 30 days', from: today, to: addDays(today, 29) },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${formatDateLabel(range.from)} – ${formatDateLabel(range.to)} · studio time (ET)`}
        actions={
          admin.can('bookings.create') ? (
            <Link href="/admin/sessions/new" className="crm-btn crm-btn-primary">
              New booking
            </Link>
          ) : null
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-2 mb-6" aria-label="Date range">
        {presets.map((p) => (
          <Link key={p.label} href={`/admin?from=${p.from}&to=${p.to}`} className="crm-btn crm-btn-sm" aria-current={p.from === range.from && p.to === range.to ? 'true' : undefined}>
            {p.label}
          </Link>
        ))}
        <label className="sr-only" htmlFor="from">
          From
        </label>
        <input id="from" type="date" name="from" defaultValue={range.from} className="!w-auto" />
        <label className="sr-only" htmlFor="to">
          To
        </label>
        <input id="to" type="date" name="to" defaultValue={range.to} className="!w-auto" />
        <button type="submit" className="crm-btn crm-btn-sm">
          Apply
        </button>
      </form>

      {(attention.needsReview > 0 || attention.failedWebhooks > 0 || attention.failedIntegrations > 0 || attention.failedEmails > 0) && (
        <div className="grid gap-2 mb-6">
          {attention.needsReview > 0 && (
            <Notice tone="red" title={`${attention.needsReview} payment${attention.needsReview === 1 ? ' needs' : 's need'} a refund decision`}>
              A customer paid for a booking that was cancelled or whose slot was taken. <Link href="/admin/purchases?review=1">Review them</Link>.
            </Notice>
          )}
          {(attention.failedWebhooks > 0 || attention.failedIntegrations > 0 || attention.failedEmails > 0) && (
            <Notice tone="amber" title="Integration problems">
              {[
                attention.failedWebhooks && `${attention.failedWebhooks} Stripe event(s) failed`,
                attention.failedIntegrations && `${attention.failedIntegrations} Calendar/Sheets failure(s) in the last 7 days`,
                attention.failedEmails && `${attention.failedEmails} email(s) not sent`,
              ]
                .filter(Boolean)
                .join(' · ')}
              . <Link href="/admin/integrations">Open Integrations</Link>.
            </Notice>
          )}
        </div>
      )}

      {money && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <StatCard label="Gross revenue" value={formatCents(money.gross)} hint={`${money.purchases} paid purchase${money.purchases === 1 ? '' : 's'} · incl. tax`} />
          <StatCard label="Net revenue" value={formatCents(money.net)} hint="Gross minus refunds" tone="good" />
          <StatCard label="Sales tax" value={formatCents(money.tax)} />
          <StatCard label="Refunds" value={formatCents(money.refunds)} tone={money.refunds > 0 ? 'warn' : 'default'} />
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-6">
        <StatCard label="Bookings" value={sessions.total} />
        <StatCard label="Paid" value={sessions.paid} />
        <StatCard label="Free tours" value={sessions.tours} />
        <StatCard label="Upcoming" value={sessions.upcoming} />
        <StatCard label="Completed" value={sessions.completed} />
        <StatCard label="Cancelled" value={sessions.cancelled} />
        <StatCard label="No-shows" value={sessions.noShows} tone={sessions.noShows > 0 ? 'warn' : 'default'} />
        <StatCard
          label="Utilisation"
          value={`${Math.round(sessions.utilisation * 100)}%`}
          hint={`${Math.round(sessions.bookedMinutes / 60)}h of ${Math.round(sessions.openMinutes / 60)}h open`}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Upcoming sessions" actions={<Link href="/admin/calendar" className="crm-btn crm-btn-sm">Calendar</Link>}>
          {upcoming.length === 0 ? (
            <EmptyState title="Nothing booked yet" body="Confirmed sessions from today onwards appear here." />
          ) : (
            <ul className="divide-y divide-zayro-border -my-2">
              {upcoming.map((b) => (
                <li key={b.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/admin/sessions/${b.id}`} className="font-medium text-zayro-dark hover:text-zayro-primary">
                      {b.first} {b.last}
                    </Link>
                    <p className="text-xs text-zayro-gray truncate">
                      {b.service} · {humanize(b.category)}
                    </p>
                  </div>
                  <div className="text-right text-xs shrink-0">
                    <p className="text-zayro-dark font-medium">{formatDateLabel(toDateOnly(b.booking_date))}</p>
                    <p className="text-zayro-gray">
                      {formatTimeLabel(b.start_time)} – {formatTimeLabel(b.end_time)}
                    </p>
                    {b.payment_status !== 'succeeded' && <StatusBadge status={b.payment_status} label={`Payment ${b.payment_status}`} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {money && (
          <Card title="Revenue by service" actions={<span className="text-xs text-zayro-gray">Line items, before tax & refunds</span>}>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <StatCard label="Podcast" value={formatCents(money.byCategory.podcast ?? 0)} />
              <StatCard label="Photography" value={formatCents(money.byCategory.photography ?? 0)} />
              <StatCard label="Packages" value={formatCents(money.byCategory.package ?? 0)} />
            </div>
            {money.byService.length === 0 ? (
              <EmptyState title="No paid purchases in this range" />
            ) : (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <caption className="sr-only">Revenue by service</caption>
                  <thead>
                    <tr>
                      <th scope="col">Service</th>
                      <th scope="col">Category</th>
                      <th scope="col" className="text-right">
                        Items
                      </th>
                      <th scope="col" className="text-right">
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {money.byService.map((r) => (
                      <tr key={`${r.category}-${r.name}`}>
                        <td>{r.name}</td>
                        <td>{humanize(r.category)}</td>
                        <td className="text-right tabular-nums">{r.items}</td>
                        <td className="text-right">
                          <Money cents={r.cents} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {money && (
          <Card title="Recent purchases" actions={<Link href="/admin/purchases" className="crm-btn crm-btn-sm">All purchases</Link>}>
            {recent.length === 0 ? (
              <EmptyState title="No purchases yet" />
            ) : (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <caption className="sr-only">Recent purchases</caption>
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Type</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="text-right">
                        Total
                      </th>
                      <th scope="col">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/admin/purchases/${p.id}`} className="font-mono text-xs">
                            {p.order_number}
                          </Link>
                          {p.needs_refund_review && <span className="ml-1 text-red-700" title="Needs refund decision">●</span>}
                        </td>
                        <td>{humanize(p.type)}</td>
                        <td>
                          <StatusBadge status={p.status} />
                        </td>
                        <td className="text-right">
                          <Money cents={p.total_cents} />
                        </td>
                        <td className="text-xs text-zayro-gray whitespace-nowrap">{formatInstantEt(p.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
