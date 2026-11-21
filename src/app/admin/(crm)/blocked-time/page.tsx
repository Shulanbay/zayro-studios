import { redirect } from 'next/navigation';
import { and, asc, desc, gte, isNull, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { blockedTimes } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { todayInTz } from '@/lib/crm/time';
import { getAdminI18n } from '@/lib/i18n/server';
import { Card, EmptyState, Forbidden, PageHeader } from '@/components/crm/ui';
import { ActionButton } from '@/components/crm/client';
import { BlockTimeForm } from '@/components/crm/availability';

export const dynamic = 'force-dynamic';

export default async function BlockedTimePage() {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('bookings.read')) return <Forbidden what="blocked time" />;
  const { t, f, label } = getAdminI18n(admin);

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
              {f.instant(b.start_datetime)} → {f.instant(b.end_datetime)}
            </span>
            <span className="block text-xs text-zayro-gray">
              {t.dynamic(`availability.blocked.kinds.${b.kind}`, label(b.kind))}
              {b.reason ? ` · ${b.reason}` : ''}
              {b.series_id ? ` · ${t('availability.blocked.repeating')}` : ''} · {t('availability.blocked.by', { name: b.created_by ?? t('availability.blocked.staff') })}
              {b.google_calendar_event_id ? ` · ${t('availability.blocked.inCalendar')}` : ''}
            </span>
          </span>
          {removable && manage && (
            <ActionButton
              url={`/api/admin/blocked-times?id=${b.id}`}
              method="DELETE"
              label={t('availability.blocked.remove')}
              className="crm-btn crm-btn-sm"
              successMessage={t('availability.blocked.removed')}
              confirm={{ title: t('availability.blocked.reopenTitle'), body: t('availability.blocked.reopenBody'), confirmLabel: t('availability.blocked.reopenConfirm') }}
            />
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader title={t('availability.blocked.title')} description={t('availability.blocked.description')} />
      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4 items-start">
        {manage && (
          <Card title={t('availability.blocked.block')}>
            <BlockTimeForm defaultDate={todayInTz()} />
          </Card>
        )}
        <div className="grid gap-4">
          <Card title={t('availability.blocked.upcoming', { count: upcoming.length })}>{upcoming.length ? list(upcoming, true) : <EmptyState title={t('availability.blocked.nothing')} />}</Card>
          {past.length > 0 && <Card title={t('availability.blocked.recent')}>{list(past, false)}</Card>}
        </div>
      </div>
    </>
  );
}
