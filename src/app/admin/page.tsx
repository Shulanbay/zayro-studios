import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/adminAuth';
import { db } from '@/lib/db';
import { bookings } from '@/lib/db/schema';
import { and, eq, or, ilike } from 'drizzle-orm';
import {
  AdminAvailabilityManager,
  AdminBlockedTimesManager,
  AdminServicesManager,
  AdminLogoutButton,
  StripeWebhookStatus,
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

  const [recentBookings, availabilityRows, services, blockedTimeRows] = await Promise.all([
    db.query.bookings.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: (b, { desc }) => [desc(b.created_at)],
      limit: 100,
    }),
    db.query.availability.findMany({ orderBy: (a, { asc }) => [asc(a.id)] }),
    db.query.services.findMany({ orderBy: (s, { asc }) => [asc(s.id)] }),
    db.query.blockedTimes.findMany({ orderBy: (b, { desc }) => [desc(b.start_datetime)] }),
  ]);

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
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-zayro-gray border-b border-zayro-border">
                <th className="py-3 px-4 font-medium">Booking ID</th>
                <th className="px-4 font-medium">Customer</th>
                <th className="px-4 font-medium">Date / Time</th>
                <th className="px-4 font-medium">Status</th>
                <th className="px-4 font-medium">Type</th>
                <th className="px-4 font-medium">Total</th>
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
                    {b.booking_date} {b.start_time}-{b.end_time}
                  </td>
                  <td className="px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[b.status] || ''}`}>{b.status}</span>
                  </td>
                  <td className="px-4 text-zayro-gray text-xs">{parseFloat(b.total_amount) === 0 ? 'Free' : 'Paid'}</td>
                  <td className="px-4 text-zayro-dark font-medium">${b.total_amount}</td>
                </tr>
              ))}
              {recentBookings.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 px-4 text-center text-zayro-gray">
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
