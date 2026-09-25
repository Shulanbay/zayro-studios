import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookings, emailLogs, integrationLogs, services, webhookEvents } from '@/lib/db/schema';
import { rowsOf } from '@/lib/db/types';
import { getAdminContext } from '@/lib/crm/auth';
import { getGoogleConfigStatus } from '@/lib/googleAuth';
import { formatDateLabel, formatInstantEt, formatTimeLabel } from '@/lib/crm/time';
import { toDateOnly } from '@/lib/utils';
import { Card, DefinitionList, Forbidden, PageHeader, StatusBadge, humanize } from '@/components/crm/ui';
import { ActionButton } from '@/components/crm/client';
import { GoogleConnectionTest, StripeWebhookStatus } from '@/components/admin/AdminControls';

export const dynamic = 'force-dynamic';

function YesNo({ ok, yes = 'Yes', no = 'No' }: { ok: boolean; yes?: string; no?: string }) {
  return <span className={ok ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>{ok ? yes : no}</span>;
}

export default async function IntegrationsPage() {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('integrations.read')) return <Forbidden what="integrations" />;

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
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  const stripeMode = stripeKey.startsWith('sk_live_') || stripeKey.startsWith('rk_live_') ? 'Live' : stripeKey ? 'Test' : 'Not configured';
  const emailCount = Object.fromEntries(emailStats.map((r) => [r.status, Number(r.n)]));
  const canRetry = admin.can('integrations.retry');

  return (
    <>
      <PageHeader title="Integrations" description="Status of Stripe, email and Google. Only yes/no configuration is shown — credentials live in Vercel and are never displayed." />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Health">
          <DefinitionList
            items={[
              ['Database migrations applied', String(health?.migrations ?? '—')],
              ['Double-booking constraint', <YesNo key="o" ok={!!health?.overlap} yes="Installed" no="Missing — overlapping bookings exist or btree_gist unavailable" />],
              ['One customer per email', <YesNo key="u" ok={!!health?.unique_customers} yes="Enforced" no={`Not enforced (${health?.duplicate_groups ?? 0} duplicate group(s) to merge)`} />],
              ['Stripe mode', <span key="m" className={stripeMode === 'Live' ? 'text-amber-800 font-medium' : ''}>{stripeMode}</span>],
              ['Stripe webhook secret', <YesNo key="w" ok={!!process.env.STRIPE_WEBHOOK_SECRET} />],
              ['Email (Resend)', <YesNo key="e" ok={!!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM} />],
              ['Owner notifications to', process.env.OWNER_EMAIL ? 'configured' : <YesNo key="oe" ok={false} />],
            ]}
          />
        </Card>

        <StripeWebhookStatus />

        <Card title="Stripe webhook events" className="xl:col-span-2">
          {events.length === 0 ? (
            <p className="text-sm text-zayro-gray">No events received yet.</p>
          ) : (
            <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
              <table className="crm-table min-w-[760px]">
                <caption className="sr-only">Recent Stripe events</caption>
                <thead>
                  <tr>
                    <th scope="col">Received</th>
                    <th scope="col">Event</th>
                    <th scope="col">Status</th>
                    <th scope="col">Result</th>
                    <th scope="col">Tries</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const p = (e.safe_payload ?? {}) as { result?: string; bookingId?: string };
                    return (
                      <tr key={e.id}>
                        <td className="text-xs whitespace-nowrap">{formatInstantEt(e.received_at)}</td>
                        <td>
                          <code className="text-xs">{e.event_type}</code>
                          <div className="text-[11px] text-zayro-gray">{e.external_event_id}</div>
                        </td>
                        <td>
                          <StatusBadge status={e.status} />
                        </td>
                        <td className="text-xs">
                          {p.result ? humanize(p.result) : ''}
                          {p.bookingId && (
                            <>
                              {' '}
                              · <Link href={`/admin/sessions/${p.bookingId}`}>booking</Link>
                            </>
                          )}
                          {e.error && <div className="text-red-700 break-words">{e.error}</div>}
                        </td>
                        <td className="tabular-nums">{e.attempts}</td>
                        <td>
                          {canRetry && e.status === 'failed' && (
                            <ActionButton url={`/api/admin/webhooks/${e.external_event_id}/retry`} label="Retry" className="crm-btn crm-btn-sm" successMessage="Event reprocessed" />
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

        <Card title="Email (last 30 days)">
          <div className="flex flex-wrap gap-4 text-sm mb-4">
            {(['sent', 'failed', 'skipped', 'pending'] as const).map((s) => (
              <span key={s}>
                <StatusBadge status={s} /> <span className="tabular-nums">{emailCount[s] ?? 0}</span>
              </span>
            ))}
          </div>
          {emailProblems.length === 0 ? (
            <p className="text-sm text-zayro-gray">Nothing waiting to be retried.</p>
          ) : (
            <ul className="divide-y divide-zayro-border text-sm">
              {emailProblems.map((e) => (
                <li key={e.id} className="py-2 flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0">
                    {humanize(e.template)} → {e.recipient_type}
                    {e.booking_id && (
                      <>
                        {' '}
                        · <Link href={`/admin/sessions/${e.booking_id}`}>booking</Link>
                      </>
                    )}
                    <span className="block text-xs text-zayro-gray">
                      {formatInstantEt(e.created_at)} · {e.attempts} attempt(s){e.error ? ` · ${e.error}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={e.status} />
                    {canRetry && <ActionButton url={`/api/admin/emails/${e.id}/retry`} label="Retry" className="crm-btn crm-btn-sm" successMessage="Email retried" />}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-zayro-gray mt-3">Retrying an email never re-sends one that already went out, and never touches Calendar or Sheets.</p>
        </Card>

        <Card title="Google Calendar & Sheets">
          <DefinitionList
            items={[
              ['Calendar configured', <YesNo key="c" ok={google.calendarConfigured} />],
              ['Sheets configured', <YesNo key="s" ok={google.sheetsConfigured} />],
              ['Service account key valid', <YesNo key="k" ok={google.privateKeyValid} />],
              ['Sheet tabs', 'Paid Bookings · Studio Tours'],
              ['Last Calendar success', formatInstantEt(lastCal?.created_at)],
              ['Last Sheets success', formatInstantEt(lastSheet?.created_at)],
            ]}
          />
          <GoogleConnectionTest />
          {missingSync.length > 0 && (
            <>
              <h3 className="text-sm font-semibold mt-5 mb-2">Upcoming bookings without a Calendar event</h3>
              <ul className="divide-y divide-zayro-border text-sm">
                {missingSync.map((b) => (
                  <li key={b.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/admin/sessions/${b.id}`}>
                      {formatDateLabel(toDateOnly(b.date))} {formatTimeLabel(b.start)} · {b.service}
                    </Link>
                    {canRetry && <ActionButton url={`/api/admin/bookings/${b.id}/sync`} label="Retry sync" className="crm-btn crm-btn-sm" successMessage="Sync attempted" />}
                  </li>
                ))}
              </ul>
            </>
          )}
          {googleFailures.length > 0 && (
            <>
              <h3 className="text-sm font-semibold mt-5 mb-2">Recent failures</h3>
              <ul className="text-xs divide-y divide-zayro-border">
                {googleFailures.map((l) => (
                  <li key={l.id} className="py-1.5">
                    <span className="text-zayro-gray">{formatInstantEt(l.created_at)}</span> · {humanize(l.integration_type)} ·{' '}
                    {l.booking_id ? <Link href={`/admin/sessions/${l.booking_id}`}>booking</Link> : '—'} · <span className="text-red-700">{l.error_message}</span>
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
