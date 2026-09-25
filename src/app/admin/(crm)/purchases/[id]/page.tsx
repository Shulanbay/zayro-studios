import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookings, customerPackages, customers, integrationLogs, purchaseItems, purchases, refunds, services, webhookEvents } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { auditFor } from '@/lib/crm/queries';
import { refundableCents } from '@/lib/crm/refunds';
import { formatDateLabel, formatInstantEt, formatTimeLabel } from '@/lib/crm/time';
import { toDateOnly } from '@/lib/utils';
import { Card, DefinitionList, Forbidden, Money, Notice, PageHeader, StatusBadge, humanize } from '@/components/crm/ui';
import { RefundDialog } from '@/components/crm/actions';
import { MarkPaidButton, ResolveReviewButton } from '@/components/crm/purchase';
import { AuditTrail } from '@/components/crm/AuditTrail';

export const dynamic = 'force-dynamic';

export default async function PurchasePage({ params }: { params: { id: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('purchases.read')) return <Forbidden what="purchases" />;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();

  const purchase = await db.query.purchases.findFirst({ where: eq(purchases.id, params.id) });
  if (!purchase) notFound();

  const [items, linked, refundRows, customer, pkg, refundable] = await Promise.all([
    db.query.purchaseItems.findMany({ where: eq(purchaseItems.purchase_id, purchase.id) }),
    db
      .select({ id: bookings.id, code: bookings.booking_id, date: bookings.booking_date, start: bookings.start_time, status: bookings.status, service: services.name })
      .from(bookings)
      .innerJoin(services, eq(services.id, bookings.service_id))
      .where(eq(bookings.purchase_id, purchase.id)),
    db.query.refunds.findMany({ where: eq(refunds.purchase_id, purchase.id), orderBy: [desc(refunds.created_at)] }),
    purchase.customer_id ? db.query.customers.findFirst({ where: eq(customers.id, purchase.customer_id) }) : null,
    db.query.customerPackages.findFirst({ where: eq(customerPackages.purchase_id, purchase.id) }),
    refundableCents(db, purchase.id),
  ]);
  const bookingIds = linked.map((b) => b.id);
  const [logs, events, audit] = await Promise.all([
    bookingIds.length
      ? db.query.integrationLogs.findMany({ where: inArray(integrationLogs.booking_id, bookingIds), orderBy: [desc(integrationLogs.created_at)], limit: 20 })
      : [],
    bookingIds.length
      ? db.query.webhookEvents.findMany({ where: sql`${webhookEvents.safe_payload}->>'bookingId' IN (${sql.join(bookingIds.map((id) => sql`${id}`), sql`, `)})`, orderBy: [desc(webhookEvents.received_at)], limit: 20 })
      : [],
    Promise.all([auditFor('purchase', [purchase.id]), auditFor('refund', refundRows.map((r) => r.id))]).then(([a, b]) => [...a, ...b].sort((x, y) => +y.created_at - +x.created_at)),
  ]);
  const customerName = customer ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.email : '—';
  const firstBooking = linked[0];

  return (
    <>
      <PageHeader
        title={`Order ${purchase.order_number}`}
        back={{ href: '/admin/purchases', label: 'Purchases' }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={purchase.status} /> {humanize(purchase.type)} · {humanize(purchase.payment_method)}
          </span>
        }
        actions={
          <>
            {admin.can('bookings.refund') && refundable.available > 0 && ['paid', 'partially_refunded'].includes(purchase.status) && (
              <RefundDialog
                purchaseId={purchase.id}
                orderNumber={purchase.order_number}
                bookingCode={firstBooking?.code}
                bookingUuid={firstBooking?.id}
                customerName={customerName}
                totalCents={purchase.total_cents}
                refundedCents={purchase.refunded_cents}
                availableCents={refundable.available}
                isStripe={purchase.payment_method === 'stripe'}
                canCancelBooking={admin.can('bookings.cancel') && !!firstBooking && ['confirmed', 'pending', 'payment_pending'].includes(firstBooking.status)}
              />
            )}
            {admin.can('purchases.create') && purchase.status === 'pending' && purchase.payment_method !== 'stripe' && <MarkPaidButton purchaseId={purchase.id} />}
            {admin.can('bookings.refund') && purchase.needs_refund_review && <ResolveReviewButton purchaseId={purchase.id} />}
          </>
        }
      />

      {purchase.needs_refund_review && (
        <div className="mb-4">
          <Notice tone="red" title="Refund decision needed">
            {purchase.review_reason || 'The customer paid but the booking cannot go ahead.'} Refund it, or close the review with a reason.
          </Notice>
        </div>
      )}
      {refundable.inFlight > 0 && (
        <div className="mb-4">
          <Notice tone="amber" title="Refund in progress">
            <Money cents={refundable.inFlight} /> is still being processed by Stripe; the status updates when Stripe confirms it.
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 grid gap-4 min-w-0 content-start">
          <Card title="Line items (snapshot at purchase)">
            <div className="crm-table-wrap -mx-5 md:-mx-6">
              <table className="crm-table min-w-[480px]">
                <caption className="sr-only">Line items</caption>
                <thead>
                  <tr>
                    <th scope="col">Description</th>
                    <th scope="col" className="text-right">
                      Qty
                    </th>
                    <th scope="col" className="text-right">
                      Unit
                    </th>
                    <th scope="col" className="text-right">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.description_snapshot}
                        {typeof (i.metadata as { listPriceCents?: number }).listPriceCents === 'number' && (i.metadata as { listPriceCents: number }).listPriceCents !== i.unit_price_cents && (
                          <div className="text-xs text-zayro-gray">
                            List price <Money cents={(i.metadata as { listPriceCents: number }).listPriceCents} />
                          </div>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{i.quantity}</td>
                      <td className="text-right">
                        <Money cents={i.unit_price_cents} />
                      </td>
                      <td className="text-right">
                        <Money cents={i.total_cents} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="grid grid-cols-2 gap-y-1 text-sm max-w-xs ml-auto mt-3">
              <dt className="text-zayro-gray">Subtotal</dt>
              <dd className="text-right">
                <Money cents={purchase.subtotal_cents} />
              </dd>
              <dt className="text-zayro-gray">Tax</dt>
              <dd className="text-right">
                <Money cents={purchase.tax_cents} />
              </dd>
              <dt className="font-semibold">Total</dt>
              <dd className="text-right font-semibold">
                <Money cents={purchase.total_cents} />
              </dd>
              <dt className="text-zayro-gray">Refunded</dt>
              <dd className="text-right">
                <Money cents={purchase.refunded_cents} />
              </dd>
              <dt className="text-zayro-gray">Net</dt>
              <dd className="text-right">
                <Money cents={purchase.total_cents - purchase.refunded_cents} />
              </dd>
            </dl>
          </Card>

          <Card title="Refunds">
            {refundRows.length === 0 ? (
              <p className="text-sm text-zayro-gray">No refunds.</p>
            ) : (
              <ul className="divide-y divide-zayro-border -my-2 text-sm">
                {refundRows.map((r) => (
                  <li key={r.id} className="py-2 grid gap-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <Money cents={r.amount_cents} className="font-medium" /> — {r.reason}
                      </span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="text-xs text-zayro-gray">
                      {formatInstantEt(r.created_at)} · {r.requested_by ?? r.source}
                      {r.stripe_refund_id && (
                        <>
                          {' '}
                          · <code>{r.stripe_refund_id}</code>
                        </>
                      )}
                      {r.failure_reason && <span className="text-red-700"> · {r.failure_reason}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Payment activity">
            {events.length === 0 && logs.length === 0 ? (
              <p className="text-sm text-zayro-gray">No recorded activity.</p>
            ) : (
              <ul className="text-xs divide-y divide-zayro-border">
                {events.map((e) => (
                  <li key={e.id} className="py-1.5 flex flex-wrap gap-x-3">
                    <span className="text-zayro-gray whitespace-nowrap">{formatInstantEt(e.received_at)}</span>
                    <span className="font-medium">Stripe {e.event_type}</span>
                    <StatusBadge status={e.status} />
                    <span className="text-zayro-gray">{String((e.safe_payload as { result?: string } | null)?.result ?? '')}</span>
                  </li>
                ))}
                {logs.map((l) => (
                  <li key={l.id} className="py-1.5 flex flex-wrap gap-x-3">
                    <span className="text-zayro-gray whitespace-nowrap">{formatInstantEt(l.created_at)}</span>
                    <span className="font-medium">{humanize(l.integration_type)}</span>
                    <span className={l.status === 'success' ? 'text-emerald-700' : 'text-red-700'}>{l.status}</span>
                    <span className="text-zayro-gray break-words min-w-0">{l.error_message || (l.response_data as { message?: string } | null)?.message || ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid gap-4 min-w-0 content-start">
          <Card title="Details">
            <DefinitionList
              items={[
                ['Customer', customer ? <Link key="c" href={`/admin/customers/${customer.id}`}>{customerName}</Link> : '—'],
                ['Email', customer?.email ?? '—'],
                ['Created', formatInstantEt(purchase.created_at)],
                ['Paid at', purchase.purchased_at ? formatInstantEt(purchase.purchased_at) : '—'],
                ['Promotion code', purchase.promotion_code || '—'],
                ['Checkout session', purchase.stripe_checkout_session_id ? <code key="cs" className="text-xs break-all">{purchase.stripe_checkout_session_id}</code> : '—'],
                ['Payment intent', purchase.stripe_payment_intent_id ? <code key="pi" className="text-xs break-all">{purchase.stripe_payment_intent_id}</code> : '—'],
                ['Notes', purchase.notes || '—'],
              ]}
            />
          </Card>
          <Card title="Bookings">
            {linked.length === 0 && !pkg ? (
              <p className="text-sm text-zayro-gray">No linked booking.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {linked.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/admin/sessions/${b.id}`}>
                      {b.service} · {formatDateLabel(toDateOnly(b.date))} {formatTimeLabel(b.start)}
                    </Link>
                    <StatusBadge status={b.status} />
                  </li>
                ))}
                {pkg && (
                  <li>
                    <Link href={`/admin/packages/${pkg.id}`}>Package: {(pkg.plan_snapshot as { name?: string }).name ?? 'Package'}</Link> ({pkg.remaining_credits}/{pkg.total_credits} credits left)
                  </li>
                )}
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
