import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookings, emailLogs, integrationLogs, services, webhookEvents } from '@/lib/db/schema';
import { rowsOf } from '@/lib/db/types';
import { getAdminContext } from '@/lib/crm/auth';
import { getGoogleConfigStatus } from '@/lib/googleAuth';
import { getAdminI18n } from '@/lib/i18n/server';
import { toDateOnly } from '@/lib/utils';
import { Card, DefinitionList, Forbidden, PageHeader, StatusBadge } from '@/components/crm/ui';
import { ActionButton } from '@/components/crm/client';
import { GoogleConnectionTest, StripeWebhookStatus } from '@/components/admin/AdminControls';
import { cameraConfig } from '@/lib/bookingOptions';
import { isManageSecretConfigured } from '@/lib/manageToken';
import { PAID_BOOKINGS_EXTENSION_HEADERS } from '@/lib/googleSheets';
import { analyticsOperationalStatus } from '@/lib/analytics/server/config';

export const dynamic = 'force-dynamic';

function YesNo({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span className={ok ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>{ok ? yes : no}</span>;
}

export default async function IntegrationsPage() {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('integrations.read')) return <Forbidden what="integrations" />;
  const { t, f, label } = getAdminI18n(admin);
  const yes = t('integrations.yes');
  const no = t('integrations.no');

  // Booleans only; the switch is changed in Vercel, never from the CRM.
  const analytics = analyticsOperationalStatus();
  const since = new Date(Date.now() - 30 * 86400000);
  const [health, events, emailStats, emailProblems, googleFailures, missingSync, lastCal, lastSheet] = await Promise.all([
    db
      .execute(
        sql`SELECT
          (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS migrations,
          EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap') AS overlap,
          EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'customers_normalized_email_live_unique') AS unique_customers,
          (SELECT count(*)::int FROM (SELECT normalized_email FROM customers WHERE status <> 'merged' GROUP BY 1 HAVING count(*) > 1) d) AS duplicate_groups`
      )
      .then((r) => rowsOf<{ migrations: number; overlap: boolean; unique_customers: boolean; duplicate_groups: number }>(r)[0]),
    db.query.webhookEvents.findMany({ orderBy: [desc(webhookEvents.received_at)], limit: 25 }),
    db
      .select({ status: emailLogs.status, n: sql<number>`count(*)::int` })
      .from(emailLogs)
      .where(gte(emailLogs.created_at, since))
      .groupBy(emailLogs.status),
    db.query.emailLogs.findMany({ where: inArray(emailLogs.status, ['failed', 'skipped', 'pending']), orderBy: [desc(emailLogs.created_at)], limit: 25 }),
    db.query.integrationLogs.findMany({
      where: and(eq(integrationLogs.status, 'failed'), inArray(integrationLogs.integration_type, ['google_calendar', 'google_sheets']), gte(integrationLogs.created_at, since)),
      orderBy: [desc(integrationLogs.created_at)],
      limit: 15,
    }),
    db
      .select({ id: bookings.id, code: bookings.booking_id, date: bookings.booking_date, start: bookings.start_time, service: services.name })
      .from(bookings)
      .innerJoin(services, eq(services.id, bookings.service_id))
      .where(and(eq(bookings.status, 'confirmed'), isNull(bookings.google_calendar_event_id), gte(bookings.starts_at, new Date())))
      .orderBy(bookings.starts_at)
      .limit(20),
    db.query.integrationLogs.findFirst({ where: and(eq(integrationLogs.integration_type, 'google_calendar'), eq(integrationLogs.status, 'success')), orderBy: [desc(integrationLogs.created_at)] }),
    db.query.integrationLogs.findFirst({ where: and(eq(integrationLogs.integration_type, 'google_sheets'), eq(integrationLogs.status, 'success')), orderBy: [desc(integrationLogs.created_at)] }),
  ]);

  const google = getGoogleConfigStatus();
  // Catalog/configuration checks (values never shown).
  const [podcastServices, configWarnings] = await Promise.all([
    db.query.services.findMany({ where: and(eq(services.category, 'podcast'), eq(services.is_active, true)) }),
    db.query.integrationLogs.findMany({
      where: and(eq(integrationLogs.integration_type, 'admin'), isNull(integrationLogs.booking_id), eq(integrationLogs.status, 'failed'), gte(integrationLogs.created_at, since)),
      orderBy: [desc(integrationLogs.created_at)],
      limit: 10,
    }),
  ]);
  const cameraRows = podcastServices.map((svc) => ({ id: svc.id, name: svc.name, config: cameraConfig(svc) }));
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  const stripeMode = stripeKey.startsWith('sk_live_') || stripeKey.startsWith('rk_live_') ? 'Live' : stripeKey ? 'Test' : 'Not configured';
  const emailCount = Object.fromEntries(emailStats.map((r) => [r.status, Number(r.n)]));
  const canRetry = admin.can('integrations.retry');

  return (
    <>
      <PageHeader title={t('common.nav.integrations')} description={t('integrations.description')} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title={t('integrations.health')}>
          <DefinitionList
            items={[
              [t('integrations.migrations'), health?.migrations === undefined ? '—' : f.number(health.migrations)],
              [t('integrations.overlap'), <YesNo key="o" ok={!!health?.overlap} yes={t('integrations.installed')} no={t('integrations.overlapMissing')} />],
              [
                t('integrations.uniqueCustomers'),
                <YesNo key="u" ok={!!health?.unique_customers} yes={t('integrations.enforced')} no={t('integrations.notEnforced', { count: health?.duplicate_groups ?? 0 })} />,
              ],
              [
                t('integrations.stripeMode'),
                <span key="m" className={stripeMode === 'Live' ? 'text-amber-800 font-medium' : ''}>
                  {t(`integrations.modes.${stripeMode}`)}
                </span>,
              ],
              [t('integrations.webhookSecret'), <YesNo key="w" ok={!!process.env.STRIPE_WEBHOOK_SECRET} yes={yes} no={no} />],
              [t('integrations.email'), <YesNo key="e" ok={!!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM} yes={yes} no={no} />],
              [t('integrations.ownerTo'), process.env.OWNER_EMAIL ? t('integrations.configured') : <YesNo key="oe" ok={false} yes={yes} no={no} />],
            ]}
          />
        </Card>

        <StripeWebhookStatus />

        <Card title={t('integrations.events')} className="xl:col-span-2">
          {events.length === 0 ? (
            <p className="text-sm text-zayro-gray">{t('integrations.noEvents')}</p>
          ) : (
            <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
              <table className="crm-table min-w-[760px]">
                <caption className="sr-only">{t('integrations.eventsCaption')}</caption>
                <thead>
                  <tr>
                    {(['received', 'event', 'status', 'result', 'tries'] as const).map((c) => (
                      <th key={c} scope="col">
                        {t(`integrations.cols.${c}`)}
                      </th>
                    ))}
                    <th scope="col">
                      <span className="sr-only">{t('integrations.cols.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const p = (e.safe_payload ?? {}) as { result?: string; bookingId?: string };
                    return (
                      <tr key={e.id}>
                        <td className="text-xs whitespace-nowrap">{f.instant(e.received_at)}</td>
                        <td>
                          <code className="text-xs">{e.event_type}</code>
                          <div className="text-[11px] text-zayro-gray">{e.external_event_id}</div>
                        </td>
                        <td>
                          <StatusBadge status={e.status} />
                        </td>
                        <td className="text-xs">
                          {p.result ? label(p.result) : ''}
                          {p.bookingId && (
                            <>
                              {' '}
                              · <Link href={`/admin/sessions/${p.bookingId}`}>{t('integrations.booking')}</Link>
                            </>
                          )}
                          {e.error && <div className="text-red-700 break-words">{e.error}</div>}
                        </td>
                        <td className="tabular-nums">{e.attempts}</td>
                        <td>
                          {canRetry && e.status === 'failed' && (
                            <ActionButton url={`/api/admin/webhooks/${e.external_event_id}/retry`} label={t('integrations.retry')} className="crm-btn crm-btn-sm" successMessage={t('integrations.reprocessed')} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t('integrations.emailTitle')}>
          <div className="flex flex-wrap gap-4 text-sm mb-4">
            {(['sent', 'failed', 'skipped', 'pending'] as const).map((s) => (
              <span key={s}>
                <StatusBadge status={s} /> <span className="tabular-nums">{f.number(emailCount[s] ?? 0)}</span>
              </span>
            ))}
          </div>
          {emailProblems.length === 0 ? (
            <p className="text-sm text-zayro-gray">{t('integrations.nothingToRetry')}</p>
          ) : (
            <ul className="divide-y divide-zayro-border text-sm">
              {emailProblems.map((e) => (
                <li key={e.id} className="py-2 flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0">
                    {label(e.template)} → {label(e.recipient_type)}
                    {e.booking_id && (
                      <>
                        {' '}
                        · <Link href={`/admin/sessions/${e.booking_id}`}>{t('integrations.booking')}</Link>
                      </>
                    )}
                    <span className="block text-xs text-zayro-gray">
                      {f.instant(e.created_at)} · {t('integrations.attempts', { count: e.attempts })}
                      {e.error ? ` · ${e.error}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={e.status} />
                    {canRetry && <ActionButton url={`/api/admin/emails/${e.id}/retry`} label={t('integrations.retry')} className="crm-btn crm-btn-sm" successMessage={t('integrations.emailRetried')} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-zayro-gray mt-3">{t('integrations.emailNote')}</p>
        </Card>

        <Card title={t('integrations.configuration')}>
          <DefinitionList
            items={[
              [t('integrations.manageLinks'), <YesNo key="m" ok={isManageSecretConfigured()} yes={t('integrations.configured')} no={t('integrations.linksMissing')} />],
              ...cameraRows.map((r): [string, React.ReactNode] => [
                t('integrations.cameras', { name: r.name }),
                r.config.ok ? (
                  t('integrations.camerasValue', { included: r.config.included, extra: Math.max(0, 3 - r.config.included) })
                ) : (
                  <span key={r.id} className="text-red-700 font-medium">
                    {t('integrations.camerasInvalid', { reason: r.config.reason })}
                  </span>
                ),
              ]),
              [
                t('integrations.vendors'),
                <span key="av">
                  <YesNo ok={analytics.vendorSwitch} yes={t('integrations.on')} no={t('integrations.vendorsOff')} />
                  {analytics.vendorSwitch && !analytics.activeInThisEnvironment ? t('integrations.inactiveIn', { env: analytics.environment }) : ''}
                </span>,
              ],
              [t('integrations.encryption'), <YesNo key="ae" ok={analytics.encryptionSecretConfigured} yes={t('integrations.configured')} no={t('integrations.encryptionMissing')} />],
              [t('integrations.cron'), <YesNo key="ac" ok={analytics.cronSecretConfigured} yes={t('integrations.configured')} no={t('integrations.cronMissing')} />],
              [t('integrations.sheetsColumns'), t('integrations.sheetsColumnsValue', { headers: PAID_BOOKINGS_EXTENSION_HEADERS.join(' · ') })],
            ]}
          />
          {configWarnings.length > 0 && (
            <>
              <h3 className="text-sm font-semibold mt-5 mb-2">{t('integrations.warnings')}</h3>
              <ul className="text-xs divide-y divide-zayro-border">
                {configWarnings.map((l) => (
                  <li key={l.id} className="py-1.5">
                    <span className="text-zayro-gray">{f.instant(l.created_at)}</span> · <span className="text-red-700">{l.error_message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card title={t('integrations.google')}>
          <DefinitionList
            items={[
              [t('integrations.calendarConfigured'), <YesNo key="c" ok={google.calendarConfigured} yes={yes} no={no} />],
              [t('integrations.sheetsConfigured'), <YesNo key="s" ok={google.sheetsConfigured} yes={yes} no={no} />],
              [t('integrations.keyValid'), <YesNo key="k" ok={google.privateKeyValid} yes={yes} no={no} />],
              [t('integrations.tabs'), 'Paid Bookings · Studio Tours'],
              [t('integrations.lastCalendar'), f.instant(lastCal?.created_at)],
              [t('integrations.lastSheets'), f.instant(lastSheet?.created_at)],
            ]}
          />
          <GoogleConnectionTest />
          {missingSync.length > 0 && (
            <>
              <h3 className="text-sm font-semibold mt-5 mb-2">{t('integrations.missingSync')}</h3>
              <ul className="divide-y divide-zayro-border text-sm">
                {missingSync.map((b) => (
                  <li key={b.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/admin/sessions/${b.id}`}>
                      {f.date(toDateOnly(b.date))} {f.time(b.start)} · {b.service}
                    </Link>
                    {canRetry && <ActionButton url={`/api/admin/bookings/${b.id}/sync`} label={t('integrations.retrySync')} className="crm-btn crm-btn-sm" successMessage={t('integrations.syncAttempted')} />}
                  </li>
                ))}
              </ul>
            </>
          )}
          {googleFailures.length > 0 && (
            <>
              <h3 className="text-sm font-semibold mt-5 mb-2">{t('integrations.failures')}</h3>
              <ul className="text-xs divide-y divide-zayro-border">
                {googleFailures.map((l) => (
                  <li key={l.id} className="py-1.5">
                    <span className="text-zayro-gray">{f.instant(l.created_at)}</span> · {label(l.integration_type)} ·{' '}
                    {l.booking_id ? <Link href={`/admin/sessions/${l.booking_id}`}>{t('integrations.booking')}</Link> : '—'} · <span className="text-red-700">{l.error_message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
