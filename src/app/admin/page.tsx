import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/adminAuth';
import { db } from '@/lib/db';
import { bookings, integrationLogs } from '@/lib/db/schema';
import { and, eq, or, ilike, inArray } from 'drizzle-orm';
import { toDateOnly } from '@/lib/utils';
import { getGoogleConfigStatus } from '@/lib/googleAuth';
import { getBookingKind } from '@/lib/bookingKind';
import { getSheetTarget } from '@/lib/googleSheets';
import {
  AdminAvailabilityManager,
  AdminBlockedTimesManager,
  AdminServicesManager,
  AdminLogoutButton,
  StripeWebhookStatus,
  GoogleConnectionTest,
  BookingSyncButton,
} from '@/components/admin/AdminControls';

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = ['confirmed', 'payment_pending', 'pending', 'cancelled', 'completed', 'refunded'];

interface AdminPageProps {
  searchParams: { status?: string; date?: string; q?: string };
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const session = getAdminSession();
  if (!session) {
    redirect('/admin/login');
  }

  const { status, date, q } = searchParams;

  const conditions = [];
  if (status && STATUS_OPTIONS.includes(status)) {
    conditions.push(eq(bookings.status, status as any));
  }
  if (date) {
    conditions.push(eq(bookings.booking_date, date));
  }
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    conditions.push(or(ilike(bookings.booking_id, term), ilike(bookings.customer_email, term))!);
  }

  const lastSuccess = (type: 'google_calendar' | 'google_sheets') =>
    db.query.integrationLogs.findFirst({
      where: and(eq(integrationLogs.integration_type, type), eq(integrationLogs.status, 'success')),
      orderBy: (l, { desc }) => [desc(l.created_at)],
    });

  const [recentBookings, availabilityRows, services, blockedTimeRows, googleLogs, lastCalendarSuccess, lastSheetsSuccess] = await Promise.all([
    db.query.bookings.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: (b, { desc }) => [desc(b.created_at)],
      limit: 100,
    }),
    db.query.availability.findMany({ orderBy: (a, { asc }) => [asc(a.id)] }),
    db.query.services.findMany({ orderBy: (s, { asc }) => [asc(s.id)] }),
    db.query.blockedTimes.findMany({ orderBy: (b, { desc }) => [desc(b.start_datetime)] }),
    db.query.integrationLogs.findMany({
      where: inArray(integrationLogs.integration_type, ['google_calendar', 'google_sheets']),
      orderBy: (l, { desc }) => [desc(l.created_at)],
      limit: 15,
    }),
    lastSuccess('google_calendar'),
    lastSuccess('google_sheets'),
  ]);

  const googleConfig = getGoogleConfigStatus();
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const bookingNumberByUuid = new Map(recentBookings.map((b) => [b.id, b.booking_id]));
  const fmtTime = (d: Date | undefined | null) =>
    d ? d.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET' : 'never';

  const statusColor: Record<string, string> = {
    confirmed: 'text-green-700 bg-green-50',
    payment_pending: 'text-amber-700 bg-amber-50',
    pending: 'text-amber-700 bg-amber-50',
    cancelled: 'text-red-700 bg-red-50',
    refunded: 'text-red-700 bg-red-50',
    completed: 'text-zayro-gray bg-zayro-bg',
  };

  return (
    <div className="container py-12 md:py-16 max-w-6xl">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-10">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-zayro-dark">Admin</h1>
          <p className="text-zayro-gray text-sm mt-1">Signed in as {session.email}</p>
        </div>
        <AdminLogoutButton />
      </div>

      <section className="mb-10">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
          <h2 className="text-lg font-bold text-zayro-dark">Bookings ({recentBookings.length})</h2>
        </div>

        <form method="get" className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            name="q"
            placeholder="Search booking ID or email"
            defaultValue={q}
            className="text-sm py-2 px-3 flex-1 min-w-[200px]"
            aria-label="Search bookings"
          />
          <select name="status" defaultValue={status || ''} className="text-sm py-2 px-3 w-auto" aria-label="Filter by status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="date"
            defaultValue={date}
            className="text-sm py-2 px-3 w-auto"
            aria-label="Filter by date"
          />
          <button type="submit" className="button button-secondary text-sm py-2 px-4">
            Filter
          </button>
          {(status || date || q) && (
            <a href="/admin" className="button button-ghost text-sm py-2 px-4">
              Clear
            </a>
          )}
        </form>

        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm min-w-[880px]">
            <thead>
              <tr className="text-left text-zayro-gray border-b border-zayro-border">
                <th className="py-3 px-4 font-medium">Booking ID</th>
                <th className="px-4 font-medium">Customer</th>
                <th className="px-4 font-medium">Date / Time</th>
                <th className="px-4 font-medium">Status</th>
                <th className="px-4 font-medium">Type</th>
                <th className="px-4 font-medium">Total</th>
                <th className="px-4 font-medium">Calendar / Sheets</th>
              </tr>
            </thead>
            <tbody>
              {recentBookings.map((b) => (
                <tr key={b.id} className="border-b border-zayro-border last:border-0">
                  <td className="py-3 px-4 font-mono text-xs text-zayro-dark">{b.booking_id}</td>
                  <td className="px-4">
                    <span className="text-zayro-dark">
                      {b.customer_first_name} {b.customer_last_name}
                    </span>
                    <div className="text-zayro-gray text-xs">{b.customer_email}</div>
                  </td>
                  <td className="px-4 text-zayro-gray">
                    {toDateOnly(b.booking_date)} {b.start_time}-{b.end_time}
                  </td>
                  <td className="px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[b.status] || ''}`}>{b.status}</span>
                  </td>
                  <td className="px-4 text-zayro-gray text-xs">
                    {(() => {
                      const service = serviceById.get(b.service_id);
                      const kind = service ? getBookingKind(b, service) : parseFloat(b.total_amount) > 0 ? 'paid' : 'free';
                      return kind === 'tour' ? 'Tour' : kind === 'paid' ? 'Paid' : 'Free';
                    })()}
                  </td>
                  <td className="px-4 text-zayro-dark font-medium">${b.total_amount}</td>
                  <td className="px-4 text-xs">
                    {(() => {
                      if (b.status !== 'confirmed') return <span className="text-zayro-gray">—</span>;
                      const service = serviceById.get(b.service_id);
                      const sheetExpected = service ? getSheetTarget(b, service).target !== null : false;
                      const calendarOk = !!b.google_calendar_event_id;
                      const sheetsOk = !sheetExpected || !!b.google_sheets_row_id;
                      return (
                        <div className="flex flex-col gap-1 py-2">
                          <span>
                            <span className={calendarOk ? 'text-green-700' : 'text-red-700'}>{calendarOk ? '✓' : '✗'} Cal</span>
                            {' · '}
                            <span className={sheetsOk ? 'text-green-700' : 'text-red-700'}>
                              {sheetExpected ? (sheetsOk ? '✓' : '✗') : '–'} Sheet
                            </span>
                          </span>
                          {(!calendarOk || !sheetsOk) && <BookingSyncButton bookingId={b.id} />}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              ))}
              {recentBookings.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 px-4 text-center text-zayro-gray">
                    No bookings match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <AdminAvailabilityManager initialRows={availabilityRows} />
        <StripeWebhookStatus />
      </div>

      <section className="card mb-6">
        <h2 className="text-lg font-bold mb-4 text-zayro-dark">Google Calendar &amp; Sheets</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-sm">
          {[
            ['Calendar configured', googleConfig.calendarConfigured],
            ['Sheets configured', googleConfig.sheetsConfigured],
            ['Calendar ID present', googleConfig.calendarIdPresent],
            ['Sheets ID present', googleConfig.sheetsIdPresent],
            ['Service account email present', googleConfig.serviceAccountEmailPresent],
            ['Private key present & valid', googleConfig.privateKeyValid],
          ].map(([label, ok]) => (
            <div key={label as string} className="flex justify-between border-b border-zayro-border py-1.5">
              <span className="text-zayro-gray">{label}</span>
              <span className={ok ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>{ok ? 'yes' : 'no'}</span>
            </div>
          ))}
          <div className="flex justify-between border-b border-zayro-border py-1.5">
            <span className="text-zayro-gray">Last successful Calendar sync</span>
            <span className="text-zayro-dark">{fmtTime(lastCalendarSuccess?.created_at)}</span>
          </div>
          <div className="flex justify-between border-b border-zayro-border py-1.5">
            <span className="text-zayro-gray">Last successful Sheets sync</span>
            <span className="text-zayro-dark">{fmtTime(lastSheetsSuccess?.created_at)}</span>
          </div>
        </div>

        <GoogleConnectionTest />

        <h3 className="text-sm font-bold text-zayro-dark mt-6 mb-2">Recent Calendar / Sheets activity</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="text-left text-zayro-gray border-b border-zayro-border">
                <th className="py-2 font-medium">When</th>
                <th className="font-medium">Integration</th>
                <th className="font-medium">Booking</th>
                <th className="font-medium">Result</th>
                <th className="font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {googleLogs.map((log) => {
                const data = (log.response_data || {}) as { message?: string };
                return (
                  <tr key={log.id} className="border-b border-zayro-border last:border-0 align-top">
                    <td className="py-2 pr-3 text-zayro-gray whitespace-nowrap">{fmtTime(log.created_at)}</td>
                    <td className="pr-3">{log.integration_type === 'google_calendar' ? 'Calendar' : 'Sheets'}</td>
                    <td className="pr-3 font-mono">{(log.booking_id && bookingNumberByUuid.get(log.booking_id)) || '—'}</td>
                    <td className={`pr-3 font-medium ${log.status === 'success' ? 'text-green-700' : 'text-red-700'}`}>{log.status}</td>
                    <td className="text-zayro-gray break-words max-w-[360px]">{log.error_message || data.message || ''}</td>
                  </tr>
                );
              })}
              {googleLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-zayro-gray">
                    No Calendar/Sheets activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zayro-gray mt-3">
          Only yes/no status is shown here. Credentials are managed in Vercel environment variables and are never displayed.
        </p>
      </section>

      <div className="mb-6">
        <AdminServicesManager initialRows={services} />
      </div>

      <AdminBlockedTimesManager
        initialRows={blockedTimeRows.map((r) => ({
          ...r,
          start_datetime: r.start_datetime.toISOString(),
          end_datetime: r.end_datetime.toISOString(),
        }))}
      />
    </div>
  );
}
