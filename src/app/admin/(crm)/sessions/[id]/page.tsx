import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookingExtensions, bookings, customerPackages, customers, emailLogs, integrationLogs, purchaseItems, purchases, refunds, services } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { auditFor } from '@/lib/crm/queries';
import { refundableCents } from '@/lib/crm/refunds';
import { bookableServiceOptions } from '@/lib/crm/serviceOptions';
import { decimalToCents } from '@/lib/crm/money';
import { getSheetTarget } from '@/lib/googleSheets';
import { toDateOnly } from '@/lib/utils';
import { guestList, intakeSummary } from '@/lib/bookingOptions';
import { Badge, Card, DefinitionList, Forbidden, Money, Notice, PageHeader, StatusBadge } from '@/components/crm/ui';
import { getAdminI18n } from '@/lib/i18n/server';
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
  const { t, f, label } = getAdminI18n(admin);

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
  // Extra time the customer bought from Manage Booking (each its own purchase).
  const extensions = showMoney
    ? await db
        .select({ id: bookingExtensions.id, status: bookingExtensions.status, prevEnd: bookingExtensions.previous_end_time, newEnd: bookingExtensions.new_end_time, purchaseId: purchases.id, order: purchases.order_number, total: purchases.total_cents })
        .from(bookingExtensions)
        .innerJoin(purchases, eq(purchases.id, bookingExtensions.purchase_id))
        .where(eq(bookingExtensions.booking_id, booking.id))
        .orderBy(desc(bookingExtensions.created_at))
    : [];
  const prepRows = intakeSummary(booking.intake).filter(([label]) => label !== 'Guests invited');
  const guestEmails = guestList(booking.intake).map((g) => (g.name ? `${g.name} <${g.email}>` : g.email));
  const extras = booking.purchase_id
    ? (await db.query.purchaseItems.findMany({ where: eq(purchaseItems.purchase_id, booking.purchase_id) }))
        .filter((i) => i.item_type === 'addon')
        .map((i) => `${i.description_snapshot.replace(/^Add-on: /, '')} × ${i.quantity}`)
    : [];
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
        title={`${service?.name ?? t('sessions.detail.sessionFallback')} · ${customerName}`}
        back={{ href: '/admin/sessions', label: t('common.nav.sessions') }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono">{booking.booking_id}</span>
            <StatusBadge status={booking.status} />
            {booking.payment_status !== 'succeeded' && <StatusBadge status={booking.payment_status} prefix="payment" />}
            <Badge tone="gray">{label(booking.source)}</Badge>
          </span>
        }
        actions={
          <>
            {admin.can('bookings.update') && booking.status === 'confirmed' && (
              <RescheduleButton bookingId={booking.id} services={serviceOptions} current={{ date, start: booking.start_time, serviceId: booking.service_id }} />
            )}
            {admin.can('bookings.update') && booking.status === 'confirmed' && started && (
              <>
                <ActionButton url={`/api/admin/bookings/${booking.id}/outcome`} body={{ outcome: 'completed' }} label={t('sessions.detail.markCompleted')} successMessage={t('sessions.detail.markedCompleted')} />
                <ActionButton
                  url={`/api/admin/bookings/${booking.id}/outcome`}
                  body={{ outcome: 'no_show' }}
                  label={t('sessions.detail.markNoShow')}
                  successMessage={t('sessions.detail.markedNoShow')}
                  confirm={{ title: t('sessions.detail.noShowTitle'), body: t('sessions.detail.noShowBody'), confirmLabel: t('sessions.detail.markNoShow') }}
                />
              </>
            )}
            {admin.can('bookings.update') && (booking.status === 'completed' || booking.status === 'no_show') && (
              <ActionButton url={`/api/admin/bookings/${booking.id}/outcome`} body={{ outcome: 'confirmed' }} label={t('sessions.detail.reopen')} successMessage={t('sessions.detail.reopened')} />
            )}
            {canCancel && <CancelBookingDialog bookingUuid={booking.id} bookingCode={booking.booking_id} paid={decimalToCents(booking.total_amount) > 0 && booking.payment_status === 'succeeded'} usesCredit={!!booking.customer_package_id} />}
          </>
        }
      />

      {booking.needs_refund_review && (
        <div className="mb-4">
          <Notice tone="red" title={t('sessions.detail.refundNeeded')}>
            {booking.review_reason || t('sessions.detail.refundNeededFallback')} {purchase && <Link href={`/admin/purchases/${purchase.id}`}>{t('sessions.detail.openPurchase')}</Link>}
          </Notice>
        </div>
      )}

      {/* What the studio needs to prepare: answers and extras (no prices — visible to every role). */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 grid gap-4 min-w-0">
          <Card title={t('sessions.detail.sessionCard')}>
            <DefinitionList
              items={[
                [t('sessions.detail.date'), f.date(date)],
                [t('sessions.detail.timeEt'), `${f.time(booking.start_time)} – ${f.time(booking.end_time)} (${t('sessions.detail.duration', { minutes: booking.duration_minutes })})`],
                [t('sessions.detail.service'), service ? `${service.name} · ${label(service.category)}` : '—'],
                [t('sessions.detail.room'), t('sessions.detail.mainStudio')],
                [t('sessions.detail.customerNotes'), booking.notes || '—'],
                [t('sessions.detail.created'), f.instant(booking.created_at)],
                [t('sessions.detail.updated'), f.instant(booking.updated_at)],
                ...(booking.cancelled_at
                  ? ([[t('sessions.detail.cancelled'), `${f.instant(booking.cancelled_at)}${booking.cancellation_reason ? ` — ${booking.cancellation_reason}` : ''}`]] as [string, string][])
                  : []),
                ...(booking.completed_at ? ([[t('sessions.detail.completed'), f.instant(booking.completed_at)]] as [string, string][]) : []),
                ...(booking.no_show_at ? ([[t('sessions.detail.noShowRecorded'), f.instant(booking.no_show_at)]] as [string, string][]) : []),
              ]}
            />
          </Card>

          {(prepRows.length > 0 || extras.length > 0 || guestEmails.length > 0) && (
            <Card title={t('sessions.detail.preparation')}>
              <DefinitionList
                items={[
                  ...(extras.length > 0 ? ([[t('sessions.detail.extras'), extras.join(', ')]] as [string, string][]) : []),
                  // Question labels are ours (translated); the answers are the customer's own words.
                  ...prepRows.map(([q, a]) => [t.dynamic(`sessions.detail.intake.${q}`, q), a] as [string, string]),
                  ...(guestEmails.length > 0 ? ([[t('sessions.detail.guests'), guestEmails.join(', ')]] as [string, string][]) : []),
                ]}
              />
            </Card>
          )}

          {showMoney && (
            <Card
              title={t('sessions.detail.payment')}
              actions={
                purchase && (
                  <>
                    <Link href={`/admin/purchases/${purchase.id}`} className="crm-btn crm-btn-sm">
                      {t('sessions.detail.purchaseLink', { order: purchase.order_number })}
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
                  [t('sessions.detail.subtotal'), <Money key="s" cents={decimalToCents(booking.subtotal)} />],
                  [t('sessions.detail.tax'), <Money key="t" cents={decimalToCents(booking.tax_amount)} />],
                  [t('sessions.detail.total'), <Money key="tt" cents={decimalToCents(booking.total_amount)} className="font-semibold" />],
                  [t('sessions.detail.paymentStatus'), <StatusBadge key="ps" status={booking.payment_status} />],
                  [t('sessions.detail.purchaseStatus'), purchase ? <StatusBadge status={purchase.status} /> : '—'],
                  [t('sessions.detail.method'), purchase ? label(purchase.payment_method) : '—'],
                  [t('sessions.detail.refunded'), purchase ? <Money cents={purchase.refunded_cents} /> : '—'],
                  [t('sessions.detail.stripeCheckout'), booking.stripe_session_id ? <code className="text-xs break-all">{booking.stripe_session_id}</code> : '—'],
                  [t('sessions.detail.stripePayment'), booking.stripe_payment_id ? <code className="text-xs break-all">{booking.stripe_payment_id}</code> : '—'],
                  ...(pkg
                    ? ([
                        [
                          t('sessions.detail.packageCredit'),
                          <Link key="pk" href={`/admin/packages/${pkg.id}`}>
                            {t('sessions.detail.packageLeft', { name: (pkg.plan_snapshot as { name?: string }).name ?? t('sessions.detail.packageFallback'), count: pkg.remaining_credits })}
                          </Link>,
                        ],
                      ] as [string, React.ReactNode][])
                    : []),
                ]}
              />
              {items.length > 0 && (
                <p className="text-xs text-zayro-gray mt-3">
                  {t('sessions.detail.lineItems', { items: items.map((i) => `${i.description_snapshot} — ${f.money(i.total_cents)}`).join('; ') })}
                </p>
              )}
              {extensions.length > 0 && (
                <div className="mt-3 text-sm">
                  <p className="font-semibold">{t('sessions.detail.extraTime')}</p>
                  <ul className="divide-y divide-zayro-border border-t border-zayro-border">
                    {extensions.map((x) => (
                      <li key={x.id} className="py-2 flex flex-wrap justify-between gap-2">
                        <span>
                          {f.time(x.prevEnd)} → {f.time(x.newEnd)} ET · <StatusBadge status={x.status} />
                        </span>
                        <Link href={`/admin/purchases/${x.purchaseId}`}>
                          {x.order} · <Money cents={x.total} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {refundRows.length > 0 && (
                <ul className="mt-3 text-sm divide-y divide-zayro-border border-t border-zayro-border">
                  {refundRows.map((r) => (
                    <li key={r.id} className="py-2 flex flex-wrap justify-between gap-2">
                      <span>
                        {t('sessions.detail.refundRow')} <Money cents={r.amount_cents} /> · {r.reason}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-zayro-gray">
                        <StatusBadge status={r.status} /> {f.instant(r.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card
            title={t('sessions.detail.syncTitle')}
            actions={
              admin.can('integrations.retry') &&
              booking.status === 'confirmed' && (
                <ActionButton url={`/api/admin/bookings/${booking.id}/sync`} label={t('sessions.detail.retrySync')} successMessage={t('sessions.detail.syncDone')} className="crm-btn crm-btn-sm" />
              )
            }
          >
            <DefinitionList
              items={[
                [
                  t('sessions.detail.calendarEvent'),
                  booking.google_calendar_event_id ? <code className="text-xs break-all">{booking.google_calendar_event_id}</code> : <span className="text-red-700">{t('sessions.detail.notCreated')}</span>,
                ],
                [t('sessions.detail.sheetsRow'), booking.google_sheets_row_id || (sheetExpected ? <span className="text-red-700">{t('sessions.detail.missing')}</span> : t('sessions.detail.notNeeded'))],
              ]}
            />
            {emails.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-2">{t('sessions.detail.emails')}</h3>
                <ul className="text-sm divide-y divide-zayro-border">
                  {emails.map((e) => (
                    <li key={e.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {label(e.template)} → {label(e.recipient_type)}
                        {e.error && <span className="block text-xs text-red-700">{e.error}</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={e.status} />
                        {admin.can('integrations.retry') && e.status !== 'sent' && (
                          <ActionButton url={`/api/admin/emails/${e.id}/retry`} label={t('sessions.detail.retryEmail')} className="crm-btn crm-btn-sm" successMessage={t('sessions.detail.emailRetried')} />
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <h3 className="text-sm font-semibold mt-4 mb-2">{t('sessions.detail.integrationLog')}</h3>
            {logs.length === 0 ? (
              <p className="text-sm text-zayro-gray">{t('sessions.detail.noActivity')}</p>
            ) : (
              <ul className="text-xs divide-y divide-zayro-border">
                {logs.map((l) => (
                  <li key={l.id} className="py-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-zayro-gray whitespace-nowrap">{f.instant(l.created_at)}</span>
                    <span className="font-medium">{label(l.integration_type)}</span>
                    <span className={l.status === 'success' ? 'text-emerald-700' : 'text-red-700'}>{label(l.status)}</span>
                    <span className="text-zayro-gray break-words min-w-0">{l.error_message || (l.response_data as { message?: string } | null)?.message || ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid gap-4 content-start min-w-0">
          <Card
            title={t('sessions.detail.customer')}
            actions={
              customer &&
              admin.can('customers.read') && (
                <Link href={`/admin/customers/${customer.id}`} className="crm-btn crm-btn-sm">
                  {t('sessions.detail.profile')}
                </Link>
              )
            }
          >
            <DefinitionList
              items={[
                [t('sessions.detail.name'), customerName],
                [t('sessions.detail.email'), <a key="e" href={`mailto:${booking.customer_email}`} className="break-all">{booking.customer_email}</a>],
                [t('sessions.detail.phone'), booking.customer_phone ? <a key="p" href={`tel:${booking.customer_phone}`}>{booking.customer_phone}</a> : '—'],
                [t('sessions.detail.company'), booking.company_name || '—'],
                ...(customer && showMoney
                  ? ([
                      [t('sessions.detail.lifetimeSpend'), <Money key="ls" cents={customer.total_spent_cents} />],
                      [t('sessions.detail.bookings'), f.number(customer.booking_count)],
                    ] as [string, React.ReactNode][])
                  : []),
              ]}
            />
          </Card>

          <Card title={t('sessions.detail.internalNotes')}>
            {admin.can('notes.write') ? (
              <NotesEditor url={`/api/admin/bookings/${booking.id}/notes`} initial={booking.internal_notes ?? ''} label={t('sessions.detail.staffOnly')} />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{booking.internal_notes || '—'}</p>
            )}
          </Card>

          <Card title={t('sessions.detail.history')}>
            <AuditTrail rows={audit} />
          </Card>
        </div>
      </div>
    </>
  );
}
