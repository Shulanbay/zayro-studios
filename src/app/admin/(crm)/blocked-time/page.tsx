import { redirect } from 'next/navigation';
import { and, asc, desc, gte, isNull, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { blockedTimes } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { formatInstantEt, todayInTz } from '@/lib/crm/time';
import { Card, EmptyState, Forbidden, PageHeader, humanize } from '@/components/crm/ui';
import { ActionButton } from '@/components/crm/client';
import { BlockTimeForm } from '@/components/crm/availability';

export const dynamic = 'force-dynamic';

export default async function BlockedTimePage() {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('bookings.read')) return <Forbidden what="blocked time" />;

  const now = new Date();
  const [upcoming, past] = await Promise.all([
    db.query.blockedTimes.findMany({ where: and(isNull(blockedTimes.deleted_at), gte(blockedTimes.end_datetime, now)), orderBy: [asc(blockedTimes.start_datetime)], limit: 200 }),
    db.query.blockedTimes.findMany({ where: and(isNull(blockedTimes.deleted_at), lt(blockedTimes.end_datetime, now)), orderBy: [desc(blockedTimes.start_datetime)], limit: 20 }),
  ]);
  const manage = admin.can('availability.manage');

  const list = (rows: typeof upcoming, removable: boolean) => (
    <ul className="divide-y divide-zayro-border text-sm">
      {rows.map((b) => (
        <li key={b.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="font-medium">
              {formatInstantEt(b.start_datetime)} → {formatInstantEt(b.end_datetime)}
            </span>
            <span className="block text-xs text-zayro-gray">
              {humanize(b.kind)}
              {b.reason ? ` · ${b.reason}` : ''}
              {b.series_id ? ' · repeating' : ''} · by {b.created_by ?? 'staff'}
              {b.google_calendar_event_id ? ' · in Google Calendar' : ''}
            </span>
          </span>
          {removable && manage && (
            <ActionButton
              url={`/api/admin/blocked-times?id=${b.id}`}
              method="DELETE"
              label="Remove"
              className="crm-btn crm-btn-sm"
              successMessage="Blocked time removed"
              confirm={{ title: 'Reopen this time?', body: 'Customers will be able to book it again straight away.', confirmLabel: 'Remove block' }}
            />
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader title="Blocked time" description="Closes the studio for part of a day (maintenance, private events). Times are New York time." />
      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4 items-start">
        {manage && (
          <Card title="Block time">
            <BlockTimeForm defaultDate={todayInTz()} />
          </Card>
        )}
        <div className="grid gap-4">
          <Card title={`Upcoming (${upcoming.length})`}>{upcoming.length ? list(upcoming, true) : <EmptyState title="Nothing blocked" />}</Card>
          {past.length > 0 && <Card title="Recent past">{list(past, false)}</Card>}
        </div>
      </div>
    </>
  );
}
