import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookings, customerPackages, customers, emailLogs, integrationLogs, purchaseItems, purchases, refunds, services } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { auditFor } from '@/lib/crm/queries';
import { refundableCents } from '@/lib/crm/refunds';
import { bookableServiceOptions } from '@/lib/crm/serviceOptions';
import { decimalToCents } from '@/lib/crm/money';
import { formatDateLabel, formatInstantEt, formatTimeLabel } from '@/lib/crm/time';
import { getSheetTarget } from '@/lib/googleSheets';
import { CATEGORY_LABELS } from '@/lib/catalog';
import { toDateOnly } from '@/lib/utils';
import { Badge, Card, DefinitionList, Forbidden, Money, Notice, PageHeader, StatusBadge, humanize } from '@/components/crm/ui';
import { ActionButton } from '@/components/crm/client';
import { CancelBookingDialog, NotesEditor, RefundDialog } from '@/components/crm/actions';
import { RescheduleButton } from '@/components/crm/booking';
import { AuditTrail } from '@/components/crm/AuditTrail';

export const dynamic = 'force-dynamic';

export default async function SessionDetailPage({ params }: { params: { id: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('bookings.read')) return <Forbidden what="sessions" />;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();

  const booking = await db.query.bookings.findFirst({ where: eq(bookings.id, params.id) });
  if (!booking) notFound();

  const showMoney = admin.can('purchases.read');
  const [service, customer, purchase, pkg, logs, emails, audit, serviceOptions] = await Promise.all([
    db.query.services.findFirst({ where: eq(services.id, booking.service_id) }),
    db.query.customers.findFirst({ where: eq(customers.id, booking.customer_id) }),
    booking.purchase_id ? db.query.purchases.findFirst({ where: eq(purchases.id, booking.purchase_id) }) : null,
    booking.customer_package_id ? db.query.customerPackages.findFirst({ where: eq(customerPackages.id, booking.customer_package_id) }) : null,
    db.query.integrationLogs.findMany({ where: eq(integrationLogs.booking_id, booking.id), orderBy: [desc(integrationLogs.created_at)], limit: 30 }),
    db.query.emailLogs.findMany({ where: eq(emailLogs.booking_id, booking.id), orderBy: [desc(emailLogs.created_at)] }),
    auditFor('booking', [booking.id]),
    bookableServiceOptions(),
  ]);
  const [items, refundRows, refundable] = purchase && showMoney
    ? await Promise.all([
        db.query.purchaseItems.findMany({ where: eq(purchaseItems.purchase_id, purchase.id) }),
        db.query.refunds.findMany({ where: eq(refunds.purchase_id, purchase.id), orderBy: [desc(refunds.created_at)] }),
        refundableCents(db, purchase.id),
      ])
    : [[], [], null];

  const date = toDateOnly(booking.booking_date);
  const started = booking.starts_at ? booking.starts_at <= new Date() : false;
  const sheetExpected = service ? getSheetTarget(booking, service).target !== null : false;
  const customerName = `${booking.customer_first_name} ${booking.customer_last_name}`.trim();
  const canCancel = admin.can('bookings.cancel') && ['pending', 'payment_pending', 'confirmed'].includes(booking.status);

  return (
    <>
      <PageHeader
        title={`${service?.name ?? 'Session'} · ${customerName}`}
        back={{ href: '/admin/sessions', label: 'Sessions' }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono">{booking.booking_id}</span>
            <StatusBadge status={booking.status} />
            {booking.payment_status !== 'succeeded' && <StatusBadge status={booking.payment_status} label={`Payment ${humanize(booking.payment_status).toLowerCase()}`} />}
            <Badge tone="gray">{humanize(booking.source)}</Badge>
          </span>
        }
        actions={
          <>
            {admin.can('bookings.update') && booking.status === 'confirmed' && (
              <RescheduleButton bookingId={booking.id} services={serviceOptions} current={{ date, start: booking.start_time, serviceId: booking.service_id }} />
            )}
            {admin.can('bookings.update') && booking.status === 'confirmed' && started && (
              <>
                <ActionButton url={`/api/admin/bookings/${booking.id}/outcome`} body={{ outcome: 'completed' }} label="Mark completed" successMessage="Marked completed" />
                <ActionButton
                  url={`/api/admin/bookings/${booking.id}/outcome`}
                  body={{ outcome: 'no_show' }}
                  label="Mark no-show"
                  successMessage="Marked no-show"
                  confirm={{ title: 'Mark as no-show?', body: 'The customer did not come. No refund is issued; you can undo this.', confirmLabel: 'Mark no-show' }}
                />
              </>
            )}
            {admin.can('bookings.update') && (booking.status === 'completed' || booking.status === 'no_show') && (
              <ActionButton url={`/api/admin/bookings/${booking.id}/outcome`} body={{ outcome: 'confirmed' }} label="Reopen" successMessage="Session reopened" />
            )}
            {canCancel && <CancelBookingDialog bookingUuid={booking.id} bookingCode={booking.booking_id} paid={decimalToCents(booking.total_amount) > 0 && booking.payment_status === 'succeeded'} usesCredit={!!booking.customer_package_id} />}
          </>
        }
      />

      {booking.needs_refund_review && (
        <div className="mb-4">
          <Notice tone="red" title="Refund decision needed">
            {booking.review_reason || 'This booking was paid but cannot go ahead.'} {purchase && <Link href={`/admin/purchases/${purchase.id}`}>Open the purchase</Link>}
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 grid gap-4 min-w-0">
          <Card title="Session">
            <DefinitionList
              items={[
                ['Date', formatDateLabel(date)],
                ['Time (ET)', `${formatTimeLabel(booking.start_time)} – ${formatTimeLabel(booking.end_time)} (${booking.duration_minutes} min)`],
                ['Service', service ? `${service.name} · ${CATEGORY_LABELS[service.category] ?? service.category}` : '—'],
                ['Room', 'Main Studio'],
                ['Customer notes', booking.notes || '—'],
                ['Created', formatInstantEt(booking.created_at)],
                ['Updated', formatInstantEt(booking.updated_at)],
                ...(booking.cancelled_at ? ([['Cancelled', `${formatInstantEt(booking.cancelled_at)}${booking.cancellation_reason ? ` — ${booking.cancellation_reason}` : ''}`]] as [string, string][]) : []),
                ...(booking.completed_at ? ([['Completed', formatInstantEt(booking.completed_at)]] as [string, string][]) : []),
                ...(booking.no_show_at ? ([['No-show recorded', formatInstantEt(booking.no_show_at)]] as [string, string][]) : []),
              ]}
            />
          </Card>

          {showMoney && (
            <Card
              title="Payment"
              actions={
                purchase && (
                  <>
                    <Link href={`/admin/purchases/${purchase.id}`} className="crm-btn crm-btn-sm">
                      Purchase {purchase.order_number}
                    </Link>
                    {admin.can('bookings.refund') && refundable && refundable.available > 0 && ['paid', 'partially_refunded'].includes(purchase.status) && (
                      <RefundDialog
                        purchaseId={purchase.id}
                        orderNumber={purchase.order_number}
                        bookingCode={booking.booking_id}
                        bookingUuid={booking.id}
                        customerName={customerName}
                        totalCents={purchase.total_cents}
                        refundedCents={purchase.refunded_cents}
                        availableCents={refundable.available}
                        isStripe={purchase.payment_method === 'stripe'}
                        canCancelBooking={canCancel}
                      />
                    )}
                  </>
                )
              }
            >
              <DefinitionList
                items={[
                  ['Subtotal', <Money key="s" cents={decimalToCents(booking.subtotal)} />],
                  ['Tax', <Money key="t" cents={decimalToCents(booking.tax_amount)} />],
                  ['Total', <Money key="tt" cents={decimalToCents(booking.total_amount)} className="font-semibold" />],
                  ['Payment status', <StatusBadge key="ps" status={booking.payment_status} />],
                  ['Purchase status', purchase ? <StatusBadge status={purchase.status} /> : '—'],
                  ['Method', purchase ? humanize(purchase.payment_method) : '—'],
                  ['Refunded', purchase ? <Money cents={purchase.refunded_cents} /> : '—'],
                  ['Stripe Checkout', booking.stripe_session_id ? <code className="text-xs break-all">{booking.stripe_session_id}</code> : '—'],
                  ['Stripe payment', booking.stripe_payment_id ? <code className="text-xs break-all">{booking.stripe_payment_id}</code> : '—'],
                  ...(pkg ? ([['Package credit', <Link key="pk" href={`/admin/packages/${pkg.id}`}>{(pkg.plan_snapshot as { name?: string }).name ?? 'Package'} ({pkg.remaining_credits} left)</Link>]] as [string, React.ReactNode][]) : []),
                ]}
              />
              {items.length > 0 && (
                <p className="text-xs text-zayro-gray mt-3">
                  Line item (snapshot at purchase): {items.map((i) => `${i.description_snapshot} — ${(i.total_cents / 100).toFixed(2)}`).join('; ')}
                </p>
              )}
              {refundRows.length > 0 && (
                <ul className="mt-3 text-sm divide-y divide-zayro-border border-t border-zayro-border">
                  {refundRows.map((r) => (
                    <li key={r.id} className="py-2 flex flex-wrap justify-between gap-2">
                      <span>
                        Refund <Money cents={r.amount_cents} /> · {r.reason}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-zayro-gray">
                        <StatusBadge status={r.status} /> {formatInstantEt(r.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card
            title="Google Calendar, Sheets and email"
            actions={
              admin.can('integrations.retry') &&
              booking.status === 'confirmed' && (
                <ActionButton url={`/api/admin/bookings/${booking.id}/sync`} label="Retry Calendar + Sheets" successMessage="Sync finished — see the log below" className="crm-btn crm-btn-sm" />
              )
            }
          >
            <DefinitionList
              items={[
                ['Calendar event', booking.google_calendar_event_id ? <code className="text-xs break-all">{booking.google_calendar_event_id}</code> : <span className="text-red-700">not created</span>],
                ['Sheets row', booking.google_sheets_row_id || (sheetExpected ? <span className="text-red-700">missing</span> : 'not needed for this booking')],
              ]}
            />
            {emails.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-2">Emails</h3>
                <ul className="text-sm divide-y divide-zayro-border">
                  {emails.map((e) => (
                    <li key={e.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {humanize(e.template)} → {e.recipient_type}
                        {e.error && <span className="block text-xs text-red-700">{e.error}</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={e.status} />
                        {admin.can('integrations.retry') && e.status !== 'sent' && (
                          <ActionButton url={`/api/admin/emails/${e.id}/retry`} label="Retry email" className="crm-btn crm-btn-sm" successMessage="Email retried" />
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <h3 className="text-sm font-semibold mt-4 mb-2">Integration log</h3>
            {logs.length === 0 ? (
              <p className="text-sm text-zayro-gray">No integration activity.</p>
            ) : (
              <ul className="text-xs divide-y divide-zayro-border">
                {logs.map((l) => (
                  <li key={l.id} className="py-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
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

        <div className="grid gap-4 content-start min-w-0">
          <Card title="Customer" actions={customer && admin.can('customers.read') && <Link href={`/admin/customers/${customer.id}`} className="crm-btn crm-btn-sm">Profile</Link>}>
            <DefinitionList
              items={[
                ['Name', customerName],
                ['Email', <a key="e" href={`mailto:${booking.customer_email}`} className="break-all">{booking.customer_email}</a>],
                ['Phone', booking.customer_phone ? <a key="p" href={`tel:${booking.customer_phone}`}>{booking.customer_phone}</a> : '—'],
                ['Company', booking.company_name || '—'],
                ...(customer && showMoney ? ([['Lifetime spend', <Money key="ls" cents={customer.total_spent_cents} />], ['Bookings', String(customer.booking_count)]] as [string, React.ReactNode][]) : []),
              ]}
            />
          </Card>

          <Card title="Internal notes">
            {admin.can('notes.write') ? (
              <NotesEditor url={`/api/admin/bookings/${booking.id}/notes`} initial={booking.internal_notes ?? ''} label="Visible to staff only" />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{booking.internal_notes || '—'}</p>
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
