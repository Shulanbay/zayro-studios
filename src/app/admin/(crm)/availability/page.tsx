import { redirect } from 'next/navigation';
import { asc, gte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { availabilityOverrides } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { getBookingRules } from '@/lib/availability';
import { bookableServiceOptions } from '@/lib/crm/serviceOptions';
import { formatDateLabel, formatTimeLabel, todayInTz } from '@/lib/crm/time';
import { Card, Forbidden, PageHeader, humanize } from '@/components/crm/ui';
import { ActionButton } from '@/components/crm/client';
import { AvailabilityPreview, BookingRulesForm, OverrideForm, WeeklyHoursEditor } from '@/components/crm/availability';

export const dynamic = 'force-dynamic';

const ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default async function AvailabilityPage() {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('availability.manage')) return <Forbidden what="availability" />;

  const today = todayInTz();
  const [days, rules, overrides, services] = await Promise.all([
    db.query.availability.findMany(),
    getBookingRules(),
    db.query.availabilityOverrides.findMany({ where: gte(availabilityOverrides.date, today), orderBy: [asc(availabilityOverrides.date)] }),
    bookableServiceOptions(),
  ]);
  days.sort((a, b) => ORDER.indexOf(a.day_of_week) - ORDER.indexOf(b.day_of_week));

  return (
    <>
      <PageHeader title="Availability" description="Opening hours and booking rules for the whole studio (one room). All times are New York time." />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Weekly hours">
          <WeeklyHoursEditor rows={days.map((d) => ({ id: d.id, day_of_week: d.day_of_week, start_time: d.start_time, end_time: d.end_time, is_available: d.is_available }))} />
        </Card>
        <Card title="Booking rules">
          <BookingRulesForm initial={rules} />
        </Card>
        <Card title="Dates with different hours">
          <OverrideForm />
          <h3 className="text-sm font-semibold mt-5 mb-2">Upcoming</h3>
          {overrides.length === 0 ? (
            <p className="text-sm text-zayro-gray">No holidays, days off or special hours set.</p>
          ) : (
            <ul className="divide-y divide-zayro-border text-sm">
              {overrides.map((o) => (
                <li key={o.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{formatDateLabel(o.date)}</span> · {o.is_closed ? `Closed (${humanize(o.kind)})` : `${formatTimeLabel(o.start_time!)} – ${formatTimeLabel(o.end_time!)}`}
                    {o.reason && <span className="text-zayro-gray"> — {o.reason}</span>}
                  </span>
                  <ActionButton url={`/api/admin/availability-overrides?id=${o.id}`} method="DELETE" label="Remove" className="crm-btn crm-btn-sm" successMessage="Override removed" />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Preview what customers see">
          <AvailabilityPreview defaultDate={today} services={services} />
        </Card>
      </div>
    </>
  );
}
