import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/adminAuth';
import { db } from '@/lib/db';
import { AdminAvailabilityManager, AdminBlockedTimesManager, AdminServicesManager, AdminLogoutButton } from '@/components/admin/AdminControls';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = getAdminSession();
  if (!session) {
    redirect('/admin/login');
  }

  const [recentBookings, availabilityRows, services, blockedTimeRows] = await Promise.all([
    db.query.bookings.findMany({
      orderBy: (b, { desc }) => [desc(b.created_at)],
      limit: 50,
    }),
    db.query.availability.findMany({ orderBy: (a, { asc }) => [asc(a.id)] }),
    db.query.services.findMany({ orderBy: (s, { asc }) => [asc(s.id)] }),
    db.query.blockedTimes.findMany({ orderBy: (b, { desc }) => [desc(b.start_datetime)] }),
  ]);

  const statusColor: Record<string, string> = {
    confirmed: 'text-green-700 bg-green-50',
    payment_pending: 'text-yellow-700 bg-yellow-50',
    pending: 'text-yellow-700 bg-yellow-50',
    cancelled: 'text-red-700 bg-red-50',
    refunded: 'text-red-700 bg-red-50',
    completed: 'text-zayro-gray bg-zayro-bg',
  };

  return (
    <div className="container py-12 md:py-16 max-w-6xl">
      <div className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl md:text-5xl font-black">ADMIN</h1>
          <p className="text-zayro-gray text-sm mt-1">Signed in as {session.email}</p>
        </div>
        <AdminLogoutButton />
      </div>

      <section className="mb-12">
        <h2 className="text-xl font-bold mb-4">Recent Bookings ({recentBookings.length})</h2>
        <div className="bg-white border border-zayro-bg overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-zayro-gray border-b border-zayro-bg">
                <th className="py-3 px-4">Booking ID</th>
                <th className="px-4">Customer</th>
                <th className="px-4">Date / Time</th>
                <th className="px-4">Status</th>
                <th className="px-4">Total</th>
              </tr>
            </thead>
            <tbody>
              {recentBookings.map((b) => (
                <tr key={b.id} className="border-b border-zayro-bg last:border-0">
                  <td className="py-3 px-4 font-mono">{b.booking_id}</td>
                  <td className="px-4">
                    {b.customer_first_name} {b.customer_last_name}
                    <div className="text-zayro-gray text-xs">{b.customer_email}</div>
                  </td>
                  <td className="px-4">
                    {b.booking_date} {b.start_time}-{b.end_time}
                  </td>
                  <td className="px-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${statusColor[b.status] || ''}`}>{b.status}</span>
                  </td>
                  <td className="px-4">${b.total_amount}</td>
                </tr>
              ))}
              {recentBookings.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 px-4 text-center text-zayro-gray">
                    No bookings yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
        <AdminAvailabilityManager initialRows={availabilityRows} />
        <AdminServicesManager initialRows={services} />
      </div>

      <AdminBlockedTimesManager initialRows={blockedTimeRows.map((r) => ({ ...r, start_datetime: r.start_datetime.toISOString(), end_datetime: r.end_datetime.toISOString() }))} />
    </div>
  );
}
