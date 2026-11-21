import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { attentionItems, moneyMetrics, recentPurchases, sessionMetrics, upcomingSessions } from '@/lib/crm/metrics';
import { parseRange } from '@/lib/crm/range';
import { addDays, todayInTz } from '@/lib/crm/time';
import { toDateOnly } from '@/lib/utils';
import { Card, EmptyState, Forbidden, Money, Notice, PageHeader, StatCard, StatusBadge } from '@/components/crm/ui';
import { getAdminI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  // Marketing Analysts have no operational access: their home is the analytics dashboard.
  if (!admin.can('bookings.read') && admin.can('analytics.read')) redirect('/admin/analytics');
  if (!admin.can('bookings.read')) return <Forbidden what="the dashboard" />;
  const { t, f, label } = getAdminI18n(admin);

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
    { key: '7d', label: t('dashboard.presets.7d'), from: addDays(today, -6), to: today },
    { key: '30d', label: t('dashboard.presets.30d'), from: addDays(today, -29), to: today },
    { key: 'mtd', label: t('dashboard.presets.mtd'), from: `${today.slice(0, 8)}01`, to: today },
    { key: 'next30', label: t('dashboard.presets.next30'), from: today, to: addDays(today, 29) },
  ];

  return (
    <>
      <PageHeader
        title={t('common.nav.dashboard')}
        description={t('dashboard.description', { range: f.dateRange(range.from, range.to) })}
        actions={
          admin.can('bookings.create') ? (
            <Link href="/admin/sessions/new" className="crm-btn crm-btn-primary">
              {t('dashboard.newBooking')}
            </Link>
          ) : null
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-2 mb-6" aria-label={t('dashboard.rangeLabel')}>
        {presets.map((p) => (
          <Link key={p.key} href={`/admin?from=${p.from}&to=${p.to}`} className="crm-btn crm-btn-sm" aria-current={p.from === range.from && p.to === range.to ? 'true' : undefined}>
            {p.label}
          </Link>
        ))}
        <label className="sr-only" htmlFor="from">
          {t('dashboard.from')}
        </label>
        <input id="from" type="date" name="from" defaultValue={range.from} className="!w-auto" />
        <label className="sr-only" htmlFor="to">
          {t('dashboard.to')}
        </label>
        <input id="to" type="date" name="to" defaultValue={range.to} className="!w-auto" />
        <button type="submit" className="crm-btn crm-btn-sm">
          {t('common.actions.apply')}
        </button>
      </form>

      {(attention.needsReview > 0 || attention.failedWebhooks > 0 || attention.failedIntegrations > 0 || attention.failedEmails > 0) && (
        <div className="grid gap-2 mb-6">
          {attention.needsReview > 0 && (
            <Notice tone="red" title={t('dashboard.needsReview', { count: attention.needsReview })}>
              {t('dashboard.needsReviewBody')} <Link href="/admin/purchases?review=1">{t('dashboard.reviewThem')}</Link>.
            </Notice>
          )}
          {(attention.failedWebhooks > 0 || attention.failedIntegrations > 0 || attention.failedEmails > 0) && (
            <Notice tone="amber" title={t('dashboard.integrationProblems')}>
              {[
                attention.failedWebhooks && t('dashboard.failedWebhooks', { count: attention.failedWebhooks }),
                attention.failedIntegrations && t('dashboard.failedIntegrations', { count: attention.failedIntegrations }),
                attention.failedEmails && t('dashboard.failedEmails', { count: attention.failedEmails }),
              ]
                .filter(Boolean)
                .join(' · ')}
              . <Link href="/admin/integrations">{t('dashboard.openIntegrations')}</Link>.
            </Notice>
          )}
        </div>
      )}

      {money && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <StatCard label={t('dashboard.gross')} value={f.money(money.gross)} hint={t('dashboard.grossHint', { count: money.purchases })} />
          <StatCard label={t('dashboard.net')} value={f.money(money.net)} hint={t('dashboard.netHint')} tone="good" />
          <StatCard label={t('dashboard.tax')} value={f.money(money.tax)} />
          <StatCard label={t('dashboard.refunds')} value={f.money(money.refunds)} tone={money.refunds > 0 ? 'warn' : 'default'} />
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-6">
        <StatCard label={t('dashboard.bookings')} value={f.number(sessions.total)} />
        <StatCard label={t('dashboard.paid')} value={f.number(sessions.paid)} />
        <StatCard label={t('dashboard.freeTours')} value={f.number(sessions.tours)} />
        <StatCard label={t('dashboard.upcoming')} value={f.number(sessions.upcoming)} />
        <StatCard label={t('dashboard.completed')} value={f.number(sessions.completed)} />
        <StatCard label={t('dashboard.cancelled')} value={f.number(sessions.cancelled)} />
        <StatCard label={t('dashboard.noShows')} value={f.number(sessions.noShows)} tone={sessions.noShows > 0 ? 'warn' : 'default'} />
        <StatCard
          label={t('dashboard.utilisation')}
          value={f.percent(sessions.utilisation, 0)}
          hint={t('dashboard.utilisationHint', { booked: Math.round(sessions.bookedMinutes / 60), open: Math.round(sessions.openMinutes / 60) })}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card
          title={t('dashboard.upcomingSessions')}
          actions={
            <Link href="/admin/calendar" className="crm-btn crm-btn-sm">
              {t('dashboard.calendar')}
            </Link>
          }
        >
          {upcoming.length === 0 ? (
            <EmptyState title={t('dashboard.nothingBooked')} body={t('dashboard.nothingBookedBody')} />
          ) : (
            <ul className="divide-y divide-zayro-border -my-2">
              {upcoming.map((b) => (
                <li key={b.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/admin/sessions/${b.id}`} className="font-medium text-zayro-dark hover:text-zayro-primary">
                      {b.first} {b.last}
                    </Link>
                    <p className="text-xs text-zayro-gray truncate">
                      {b.service} · {label(b.category)}
                    </p>
                  </div>
                  <div className="text-right text-xs shrink-0">
                    <p className="text-zayro-dark font-medium">{f.date(toDateOnly(b.booking_date))}</p>
                    <p className="text-zayro-gray">
                      {f.time(b.start_time)} – {f.time(b.end_time)}
                    </p>
                    {b.payment_status !== 'succeeded' && <StatusBadge status={b.payment_status} prefix="payment" />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {money && (
          <Card title={t('dashboard.revenueByService')} actions={<span className="text-xs text-zayro-gray">{t('dashboard.revenueNote')}</span>}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
              <StatCard label={label('podcast')} value={f.money(money.byCategory.podcast ?? 0)} />
              <StatCard label={label('photography')} value={f.money(money.byCategory.photography ?? 0)} />
              <StatCard label={label('package')} value={f.money(money.byCategory.package ?? 0)} />
            </div>
            {money.byService.length === 0 ? (
              <EmptyState title={t('dashboard.noPaidPurchases')} />
            ) : (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <caption className="sr-only">{t('dashboard.revenueByService')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('dashboard.service')}</th>
                      <th scope="col">{t('dashboard.category')}</th>
                      <th scope="col" className="text-right">
                        {t('dashboard.items')}
                      </th>
                      <th scope="col" className="text-right">
                        {t('dashboard.revenue')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {money.byService.map((r) => (
                      <tr key={`${r.category}-${r.name}`}>
                        <td>{r.name}</td>
                        <td>{label(r.category)}</td>
                        <td className="text-right tabular-nums">{f.number(r.items)}</td>
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
          <Card
            title={t('dashboard.recentPurchases')}
            actions={
              <Link href="/admin/purchases" className="crm-btn crm-btn-sm">
                {t('dashboard.allPurchases')}
              </Link>
            }
          >
            {recent.length === 0 ? (
              <EmptyState title={t('dashboard.noPurchases')} />
            ) : (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <caption className="sr-only">{t('dashboard.recentPurchases')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('dashboard.order')}</th>
                      <th scope="col">{t('dashboard.type')}</th>
                      <th scope="col">{t('dashboard.status')}</th>
                      <th scope="col" className="text-right">
                        {t('dashboard.total')}
                      </th>
                      <th scope="col">{t('dashboard.created')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/admin/purchases/${p.id}`} className="font-mono text-xs">
                            {p.order_number}
                          </Link>
                          {p.needs_refund_review && (
                            <span className="ml-1 text-red-700" title={t('dashboard.needsRefundDecision')}>
                              ●
                            </span>
                          )}
                        </td>
                        <td>{label(p.type)}</td>
                        <td>
                          <StatusBadge status={p.status} />
                        </td>
                        <td className="text-right">
                          <Money cents={p.total_cents} />
                        </td>
                        <td className="text-xs text-zayro-gray whitespace-nowrap">{f.instant(p.created_at)}</td>
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
