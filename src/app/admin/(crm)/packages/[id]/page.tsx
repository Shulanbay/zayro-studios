import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookings, customerPackages, customers, packageCreditTransactions, purchases } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { expireDuePackages } from '@/lib/crm/packages';
import { auditFor } from '@/lib/crm/queries';
import { formatInstantEt } from '@/lib/crm/time';
import { Card, DefinitionList, Forbidden, PageHeader, StatCard, StatusBadge, humanize } from '@/components/crm/ui';
import { AdjustCreditsForm, CancelPackageButton } from '@/components/crm/packages';
import { AuditTrail } from '@/components/crm/AuditTrail';

export const dynamic = 'force-dynamic';

export default async function PackageDetailPage({ params }: { params: { id: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('packages.read')) return <Forbidden what="packages" />;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();

  await expireDuePackages();
  const pkg = await db.query.customerPackages.findFirst({ where: eq(customerPackages.id, params.id) });
  if (!pkg) notFound();

  const [customer, purchase, ledger, audit] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, pkg.customer_id) }),
    pkg.purchase_id ? db.query.purchases.findFirst({ where: eq(purchases.id, pkg.purchase_id) }) : null,
    db
      .select({ t: packageCreditTransactions, code: bookings.booking_id })
      .from(packageCreditTransactions)
      .leftJoin(bookings, eq(bookings.id, packageCreditTransactions.booking_id))
      .where(eq(packageCreditTransactions.customer_package_id, pkg.id))
      .orderBy(asc(packageCreditTransactions.created_at)),
    auditFor('customer_package', [pkg.id]),
  ]);
  const snap = pkg.plan_snapshot as { name?: string; eligible?: string; priceCents?: number };
  const manage = admin.can('packages.manage');
  const canBook = admin.can('bookings.create') && pkg.status === 'active' && pkg.remaining_credits > 0;

  return (
    <>
      <PageHeader
        title={snap.name ?? 'Package'}
        back={{ href: '/admin/packages', label: 'Packages' }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {customer && <Link href={`/admin/customers/${customer.id}`}>{[customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.email}</Link>}
            <StatusBadge status={pkg.status} />
          </span>
        }
        actions={
          <>
            {canBook && (
              <Link href={`/admin/sessions/new?customerId=${pkg.customer_id}`} className="crm-btn crm-btn-primary">
                Book with a credit
              </Link>
            )}
            {manage && pkg.status !== 'cancelled' && <CancelPackageButton packageId={pkg.id} />}
          </>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Credits left" value={pkg.remaining_credits} tone={pkg.remaining_credits === 0 ? 'warn' : 'good'} />
        <StatCard label="Granted" value={pkg.total_credits} />
        <StatCard label="Starts" value={<span className="text-base">{formatInstantEt(pkg.starts_at)}</span>} />
        <StatCard label="Expires" value={<span className="text-base">{formatInstantEt(pkg.expires_at)}</span>} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Credit ledger" className="xl:col-span-2">
          <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
            <table className="crm-table min-w-[560px]">
              <caption className="sr-only">Credit transactions</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="text-right">
                    Credits
                  </th>
                  <th scope="col" className="text-right">
                    Balance
                  </th>
                  <th scope="col">Booking / reason</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map(({ t, code }) => (
                  <tr key={t.id}>
                    <td className="text-xs whitespace-nowrap">{formatInstantEt(t.created_at)}</td>
                    <td>{humanize(t.type)}</td>
                    <td className={`text-right tabular-nums ${t.credits < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {t.credits > 0 ? '+' : ''}
                      {t.credits}
                    </td>
                    <td className="text-right tabular-nums">{t.balance_after}</td>
                    <td className="text-sm">
                      {t.booking_id && code && <Link href={`/admin/sessions/${t.booking_id}`} className="font-mono text-xs">{code}</Link>} {t.reason}
                      <div className="text-xs text-zayro-gray">{t.actor_email ?? 'system'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="grid gap-4 content-start">
          <Card title="Details">
            <DefinitionList
              items={[
                ['Valid for', snap.eligible ?? 'Any session'],
                ['Purchase', purchase ? <Link key="p" href={`/admin/purchases/${purchase.id}`}>{purchase.order_number} ({humanize(purchase.status)})</Link> : '—'],
                ['Notes', pkg.notes || '—'],
              ]}
            />
          </Card>
          {manage && pkg.status !== 'cancelled' && (
            <Card title="Adjust credits">
              <AdjustCreditsForm packageId={pkg.id} remaining={pkg.remaining_credits} />
            </Card>
          )}
          <Card title="History">
            <AuditTrail rows={audit} />
          </Card>
        </div>
      </div>
    </>
  );
}
