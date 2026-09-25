import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookings, customerNotes, customerPackages, customers, purchases, refunds, services } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { auditFor } from '@/lib/crm/queries';
import { decimalToCents } from '@/lib/crm/money';
import { formatDateLabel, formatInstantEt, formatTimeLabel } from '@/lib/crm/time';
import { toDateOnly } from '@/lib/utils';
import { Card, DefinitionList, EmptyState, Forbidden, Money, Notice, PageHeader, StatCard, StatusBadge, humanize } from '@/components/crm/ui';
import { AddNoteForm, CustomerEditForm, MergeDialog } from '@/components/crm/customer';
import { NotesEditor } from '@/components/crm/actions';
import { AuditTrail } from '@/components/crm/AuditTrail';
import { formatCents } from '@/lib/crm/money';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: { id: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('customers.read')) return <Forbidden what="customers" />;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();

  const customer = await db.query.customers.findFirst({ where: eq(customers.id, params.id) });
  if (!customer) notFound();

  const showMoney = admin.can('purchases.read');
  const [sessionRows, purchaseRows, packageRows, notes, refundTotal, audit, mergedInto] = await Promise.all([
    db
      .select({
        id: bookings.id,
        code: bookings.booking_id,
        date: bookings.booking_date,
        start: bookings.start_time,
        end: bookings.end_time,
        status: bookings.status,
        starts_at: bookings.starts_at,
        total: bookings.total_amount,
        service: services.name,
      })
      .from(bookings)
      .innerJoin(services, eq(services.id, bookings.service_id))
      .where(eq(bookings.customer_id, customer.id))
      .orderBy(desc(bookings.starts_at))
      .limit(200),
    showMoney ? db.query.purchases.findMany({ where: eq(purchases.customer_id, customer.id), orderBy: [desc(purchases.created_at)], limit: 100 }) : [],
    admin.can('packages.read') ? db.query.customerPackages.findMany({ where: eq(customerPackages.customer_id, customer.id), orderBy: [desc(customerPackages.created_at)] }) : [],
    db.query.customerNotes.findMany({ where: eq(customerNotes.customer_id, customer.id), orderBy: [desc(customerNotes.created_at)] }),
    showMoney
      ? db
          .select({ n: sql<number>`coalesce(sum(${refunds.amount_cents}), 0)::int` })
          .from(refunds)
          .innerJoin(purchases, eq(purchases.id, refunds.purchase_id))
          .where(sql`${purchases.customer_id} = ${customer.id} AND ${refunds.status} = 'succeeded'`)
      : [{ n: 0 }],
    auditFor('customer', [customer.id]),
    customer.merged_into_id ? db.query.customers.findFirst({ where: eq(customers.id, customer.merged_into_id) }) : null,
  ]);

  const now = new Date();
  const upcoming = sessionRows.filter((s) => s.starts_at && s.starts_at >= now && s.status === 'confirmed').reverse();
  const past = sessionRows.filter((s) => !(s.starts_at && s.starts_at >= now && s.status === 'confirmed'));
  const credits = packageRows.filter((p) => p.status === 'active').reduce((n, p) => n + p.remaining_credits, 0);
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.email;

  const sessionTable = (rows: typeof sessionRows, empty: string) =>
    rows.length === 0 ? (
      <p className="text-sm text-zayro-gray">{empty}</p>
    ) : (
      <ul className="divide-y divide-zayro-border -my-2">
        {rows.map((s) => (
          <li key={s.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0">
              <Link href={`/admin/sessions/${s.id}`} className="font-medium">
                {formatDateLabel(toDateOnly(s.date))}, {formatTimeLabel(s.start)}
              </Link>
              <span className="text-zayro-gray"> · {s.service}</span>
            </span>
            <span className="flex items-center gap-2">
              {showMoney && <Money cents={decimalToCents(s.total)} className="text-xs text-zayro-gray" />}
              <StatusBadge status={s.status} />
            </span>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader
        title={name}
        back={{ href: '/admin/customers', label: 'Customers' }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="break-all">{customer.email}</span>
            <StatusBadge status={customer.status} />
          </span>
        }
        actions={
          <>
            {admin.can('bookings.create') && customer.status !== 'merged' && (
              <Link href={`/admin/sessions/new?customerId=${customer.id}`} className="crm-btn crm-btn-primary">
                New booking
              </Link>
            )}
            {admin.can('packages.manage') && customer.status !== 'merged' && (
              <Link href={`/admin/packages/assign?customerId=${customer.id}`} className="crm-btn">
                Assign package
              </Link>
            )}
            {admin.can('customers.merge') && customer.status !== 'merged' && <MergeDialog primaryId={customer.id} primaryEmail={customer.email} />}
          </>
        }
      />

      {customer.status === 'merged' && (
        <div className="mb-4">
          <Notice tone="blue" title="Merged record">
            This customer was merged into {mergedInto ? <Link href={`/admin/customers/${mergedInto.id}`}>{mergedInto.email}</Link> : 'another record'}. It is kept for history only.
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {showMoney && <StatCard label="Lifetime spend" value={formatCents(customer.total_spent_cents)} hint="Paid minus refunds" />}
        {showMoney && <StatCard label="Refunded" value={formatCents(Number(refundTotal[0]?.n ?? 0))} />}
        <StatCard label="Sessions" value={customer.booking_count} hint={customer.last_booking_at ? `Last ${formatInstantEt(customer.last_booking_at)}` : undefined} />
        {admin.can('packages.read') && <StatCard label="Package credits" value={credits} hint={`${packageRows.filter((p) => p.status === 'active').length} active package(s)`} />}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 grid gap-4 min-w-0 content-start">
          <Card title={`Upcoming sessions (${upcoming.length})`}>{sessionTable(upcoming, 'Nothing upcoming.')}</Card>
          <Card title={`Past and cancelled sessions (${past.length})`}>{sessionTable(past, 'No past sessions.')}</Card>

          {showMoney && (
            <Card title="Purchases">
              {purchaseRows.length === 0 ? (
                <EmptyState title="No purchases" />
              ) : (
                <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
                  <table className="crm-table min-w-[560px]">
                    <caption className="sr-only">Purchases</caption>
                    <thead>
                      <tr>
                        <th scope="col">Order</th>
                        <th scope="col">Type</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="text-right">
                          Total
                        </th>
                        <th scope="col" className="text-right">
                          Refunded
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseRows.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <Link href={`/admin/purchases/${p.id}`} className="font-mono text-xs">
                              {p.order_number}
                            </Link>
                          </td>
                          <td>{humanize(p.type)}</td>
                          <td>
                            <StatusBadge status={p.status} />
                          </td>
                          <td className="text-right">
                            <Money cents={p.total_cents} />
                          </td>
                          <td className="text-right">
                            <Money cents={p.refunded_cents} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {admin.can('packages.read') && (
            <Card title="Packages">
              {packageRows.length === 0 ? (
                <p className="text-sm text-zayro-gray">No packages.</p>
              ) : (
                <ul className="divide-y divide-zayro-border -my-2">
                  {packageRows.map((p) => (
                    <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <Link href={`/admin/packages/${p.id}`} className="font-medium">
                        {(p.plan_snapshot as { name?: string }).name ?? 'Package'}
                      </Link>
                      <span className="flex items-center gap-2 text-xs text-zayro-gray">
                        {p.remaining_credits}/{p.total_credits} left · until {formatInstantEt(p.expires_at)}
                        <StatusBadge status={p.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="grid gap-4 min-w-0 content-start">
          <Card title="Details">
            {admin.can('customers.update') && customer.status !== 'merged' ? (
              <CustomerEditForm
                id={customer.id}
                initial={{
                  first_name: customer.first_name ?? '',
                  last_name: customer.last_name ?? '',
                  phone: customer.phone ?? '',
                  company: customer.company ?? '',
                  marketing_consent: customer.marketing_consent,
                  status: customer.status === 'archived' ? 'archived' : 'active',
                }}
              />
            ) : (
              <DefinitionList
                items={[
                  ['Phone', customer.phone],
                  ['Company', customer.company],
                  ['Marketing emails', customer.marketing_consent ? 'Yes' : 'No'],
                ]}
              />
            )}
            <p className="text-xs text-zayro-gray mt-3">Customer since {formatInstantEt(customer.created_at)}</p>
          </Card>

          <Card title="Notes">
            {admin.can('notes.write') && customer.status !== 'merged' && (
              <div className="mb-4 grid gap-4">
                <NotesEditor url={`/api/admin/customers/${customer.id}`} initial={customer.internal_notes ?? ''} field="internal_notes" label="Pinned note" />
                <AddNoteForm customerId={customer.id} />
              </div>
            )}
            {notes.length === 0 ? (
              <p className="text-sm text-zayro-gray">No notes yet.</p>
            ) : (
              <ul className="grid gap-3">
                {notes.map((n) => (
                  <li key={n.id} className="text-sm border-l-2 border-zayro-border pl-3">
                    <p className="whitespace-pre-wrap break-words">{n.body}</p>
                    <p className="text-xs text-zayro-gray mt-0.5">
                      {n.author_email ?? 'staff'} · {formatInstantEt(n.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="History">
            <AuditTrail rows={audit} />
          </Card>
        </div>
      </div>
    </>
  );
}
