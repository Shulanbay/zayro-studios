import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, eq, gt, gte, inArray, isNull, lt, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { availability, availabilityOverrides, blockedTimes, bookings, services, temporaryHolds } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { CATEGORY_LABELS, SERVICE_CATEGORIES } from '@/lib/catalog';
import { addDays, daysBetween, dayOfWeek, formatDateLabel, formatTimeLabel, isDateString, minutesIntoDay, timeToMinutes, todayInTz, wallTimeToUtc } from '@/lib/crm/time';
import { toDateOnly } from '@/lib/utils';
import { Forbidden, PageHeader, humanize, withParams } from '@/components/crm/ui';

export const dynamic = 'force-dynamic';

type View = 'day' | 'week' | 'month' | 'list';

interface Item {
  key: string;
  kind: 'booking' | 'hold' | 'block';
  date: string;
  start: number; // minutes into `date`
  end: number;
  title: string;
  subtitle: string;
  status: string;
  href?: string;
  category?: string;
}

const HOUR_PX = 44;

function startOfWeek(date: string) {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7)); // Monday
}

function tone(item: Item) {
  if (item.kind === 'block') return 'bg-slate-200/80 border-slate-300 text-slate-700';
  if (item.kind === 'hold') return 'bg-amber-50 border-amber-300 border-dashed text-amber-900';
  if (item.status === 'cancelled') return 'bg-white border-slate-200 text-slate-400 line-through';
  if (item.status === 'no_show') return 'bg-violet-50 border-violet-200 text-violet-900';
  if (item.status === 'payment_pending' || item.status === 'pending') return 'bg-amber-50 border-amber-200 text-amber-900';
  if (item.category === 'tour') return 'bg-sky-50 border-sky-200 text-sky-900';
  if (item.category === 'photography') return 'bg-rose-50 border-rose-200 text-rose-900';
  return 'bg-blue-50 border-blue-200 text-blue-900';
}

export default async function CalendarPage({ searchParams }: { searchParams: { view?: string; date?: string; category?: string; cancelled?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('bookings.read')) return <Forbidden what="the calendar" />;

  const view: View = (['day', 'week', 'month', 'list'] as const).includes(searchParams.view as View) ? (searchParams.view as View) : 'week';
  const today = todayInTz();
  const anchor = isDateString(searchParams.date) ? searchParams.date : today;
  const category = (SERVICE_CATEGORIES as readonly string[]).includes(searchParams.category ?? '') ? searchParams.category : undefined;
  const showCancelled = searchParams.cancelled === '1';

  let from: string;
  let days: number;
  if (view === 'day') {
    from = anchor;
    days = 1;
  } else if (view === 'week') {
    from = startOfWeek(anchor);
    days = 7;
  } else if (view === 'month') {
    const first = `${anchor.slice(0, 8)}01`;
    from = startOfWeek(first);
    const nextMonth = new Date(`${first}T12:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const last = addDays(nextMonth.toISOString().slice(0, 10), -1);
    days = daysBetween(from, addDays(startOfWeek(last), 6)) + 1;
  } else {
    from = anchor;
    days = 14;
  }
  const to = addDays(from, days - 1);
  const rangeStart = wallTimeToUtc(from, '00:00');
  const rangeEnd = wallTimeToUtc(addDays(to, 1), '00:00');

  const statuses = ['confirmed', 'completed', 'no_show', 'payment_pending', 'pending', ...(showCancelled ? (['cancelled'] as const) : [])] as const;
  const [bookingRows, holdRows, blockRows, weekly, overrides] = await Promise.all([
    db
      .select({
        id: bookings.id,
        code: bookings.booking_id,
        date: bookings.booking_date,
        start: bookings.start_time,
        end: bookings.end_time,
        status: bookings.status,
        first: bookings.customer_first_name,
        last: bookings.customer_last_name,
        service: services.name,
        category: services.category,
      })
      .from(bookings)
      .innerJoin(services, eq(services.id, bookings.service_id))
      .where(and(inArray(bookings.status, [...statuses]), lt(bookings.starts_at, rangeEnd), gt(bookings.ends_at, rangeStart))),
    db.query.temporaryHolds.findMany({
      where: and(eq(temporaryHolds.status, 'active'), gte(temporaryHolds.hold_expires_at, new Date()), gte(temporaryHolds.booking_date, from), lte(temporaryHolds.booking_date, to)),
    }),
    db.query.blockedTimes.findMany({ where: and(isNull(blockedTimes.deleted_at), lt(blockedTimes.start_datetime, rangeEnd), gt(blockedTimes.end_datetime, rangeStart)) }),
    db.query.availability.findMany({ where: eq(availability.is_available, true) }),
    db.query.availabilityOverrides.findMany({ where: and(gte(availabilityOverrides.date, from), lte(availabilityOverrides.date, to)) }),
  ]);

  const items: Item[] = [];
  for (const b of bookingRows) {
    if (category && b.category !== category) continue;
    const date = toDateOnly(b.date);
    items.push({
      key: b.id,
      kind: 'booking',
      date,
      start: timeToMinutes(b.start),
      end: timeToMinutes(b.end) <= timeToMinutes(b.start) ? 1440 : timeToMinutes(b.end),
      title: `${b.first} ${b.last}`.trim(),
      subtitle: `${b.service} · ${formatTimeLabel(b.start)}–${formatTimeLabel(b.end)}`,
      status: b.status,
      href: `/admin/sessions/${b.id}`,
      category: b.category,
    });
  }
  if (!category) {
    for (const h of holdRows) {
      items.push({ key: h.id, kind: 'hold', date: toDateOnly(h.booking_date), start: timeToMinutes(h.start_time), end: timeToMinutes(h.end_time), title: 'Checkout hold', subtitle: `${formatTimeLabel(h.start_time)}–${formatTimeLabel(h.end_time)} · expires soon`, status: 'hold' });
    }
  }
  for (const bl of blockRows) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const s = Math.max(0, minutesIntoDay(bl.start_datetime, d));
      const e = Math.min(1440, minutesIntoDay(bl.end_datetime, d));
      if (e > s) items.push({ key: `${bl.id}-${d}`, kind: 'block', date: d, start: s, end: e, title: bl.reason || 'Blocked', subtitle: humanize(bl.kind), status: 'blocked', href: '/admin/blocked-time' });
    }
  }
  items.sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1));

  const hoursFor = (date: string): [number, number] | null => {
    const o = overrides.find((x) => x.date === date);
    if (o) return o.is_closed || !o.start_time || !o.end_time ? null : [timeToMinutes(o.start_time), timeToMinutes(o.end_time)];
    const w = weekly.find((x) => x.day_of_week === dayOfWeek(date));
    return w ? [timeToMinutes(w.start_time), timeToMinutes(w.end_time)] : null;
  };

  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const openRanges = dates.map(hoursFor).filter(Boolean) as [number, number][];
  const gridStart = Math.floor(Math.min(8 * 60, ...openRanges.map((r) => r[0]), ...items.filter((i) => i.kind !== 'block').map((i) => i.start)) / 60) * 60;
  const gridEnd = Math.ceil(Math.max(22 * 60, ...openRanges.map((r) => r[1]), ...items.filter((i) => i.kind !== 'block').map((i) => i.end)) / 60) * 60;
  const hours = Array.from({ length: (gridEnd - gridStart) / 60 }, (_, i) => gridStart + i * 60);

  const params: Record<string, string | undefined> = { view, date: anchor, category, cancelled: showCancelled ? '1' : undefined };
  const step = view === 'day' ? 1 : view === 'week' ? 7 : view === 'list' ? 14 : 0;
  const prevDate = view === 'month' ? (() => { const d = new Date(`${anchor.slice(0, 8)}01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })() : addDays(anchor, -step);
  const nextDate = view === 'month' ? (() => { const d = new Date(`${anchor.slice(0, 8)}01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })() : addDays(anchor, step);
  const title =
    view === 'month'
      ? new Date(`${anchor}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : view === 'day'
        ? formatDateLabel(anchor)
        : `${formatDateLabel(from)} – ${formatDateLabel(to)}`;
  const canCreate = admin.can('bookings.create');

  const timeGrid = (cols: string[]) => (
    <div className="card !p-0 overflow-hidden">
      <div className="crm-table-wrap">
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${cols.length}, minmax(${cols.length > 1 ? 120 : 240}px, 1fr))`, minWidth: cols.length > 1 ? 56 + cols.length * 120 : undefined }}>
          <div className="border-b border-zayro-border bg-[#F9FBFE]" />
          {cols.map((d) => {
            const hrs = hoursFor(d);
            return (
              <div key={d} className={`border-b border-l border-zayro-border px-2 py-2 text-xs bg-[#F9FBFE] ${d === today ? 'text-zayro-primary font-semibold' : 'text-zayro-dark'}`}>
                <Link href={withParams('/admin/calendar', params, { view: 'day', date: d })}>{formatDateLabel(d).replace(/, \d{4}$/, '')}</Link>
                <div className="text-[11px] text-zayro-gray font-normal">{hrs ? `${formatTimeLabel(`${String(Math.floor(hrs[0] / 60)).padStart(2, '0')}:${String(hrs[0] % 60).padStart(2, '0')}`)}–${formatTimeLabel(`${String(Math.floor(hrs[1] / 60)).padStart(2, '0')}:${String(hrs[1] % 60).padStart(2, '0')}`)}` : 'Closed'}</div>
              </div>
            );
          })}
          <div className="relative" style={{ height: hours.length * HOUR_PX }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute right-1 text-[10px] text-zayro-gray" style={{ top: i * HOUR_PX - 6 }}>
                {i === 0 ? '' : formatTimeLabel(`${String(h / 60).padStart(2, '0')}:00`).replace(':00 ', ' ')}
              </div>
            ))}
          </div>
          {cols.map((d) => {
            const hrs = hoursFor(d);
            const dayItems = items.filter((i) => i.date === d);
            return (
              <div key={d} className="relative border-l border-zayro-border" style={{ height: hours.length * HOUR_PX }}>
                {hours.map((h, i) => {
                  const open = !!hrs && h >= hrs[0] && h < hrs[1];
                  const time = `${String(h / 60).padStart(2, '0')}:00`;
                  return canCreate && open ? (
                    <Link
                      key={h}
                      href={`/admin/sessions/new?date=${d}&time=${time}`}
                      className="absolute left-0 right-0 border-t border-zayro-border/70 hover:bg-blue-50/40 focus-visible:bg-blue-50"
                      style={{ top: i * HOUR_PX, height: HOUR_PX }}
                      aria-label={`New booking ${formatDateLabel(d)} ${formatTimeLabel(time)}`}
                    />
                  ) : (
                    <div key={h} className={`absolute left-0 right-0 border-t border-zayro-border/70 ${open ? '' : 'bg-slate-50'}`} style={{ top: i * HOUR_PX, height: HOUR_PX }} />
                  );
                })}
                {dayItems.map((it) => {
                  const s0 = Math.max(it.start, gridStart);
                  const e0 = Math.min(it.end, gridEnd);
                  if (e0 <= s0) return null;
                  const top = ((s0 - gridStart) / 60) * HOUR_PX;
                  const height = Math.max(20, ((e0 - s0) / 60) * HOUR_PX - 2);
                  const body = (
                    <>
                      <span className="block font-semibold truncate">{it.title}</span>
                      {height > 30 && <span className="block truncate opacity-80">{it.subtitle}</span>}
                    </>
                  );
                  const cls = `absolute left-1 right-1 rounded-lg border px-1.5 py-1 text-[11px] leading-tight overflow-hidden ${tone(it)} ${it.kind === 'block' ? 'z-0' : 'z-10'}`;
                  return it.href ? (
                    <Link key={it.key} href={it.href} className={cls} style={{ top, height }} title={`${it.title} — ${it.subtitle}`}>
                      {body}
                    </Link>
                  ) : (
                    <div key={it.key} className={cls} style={{ top, height }} title={`${it.title} — ${it.subtitle}`}>
                      {body}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`${title} · New York time · the CRM database is the source of truth; Google Calendar mirrors it.`}
        actions={
          <>
            {admin.can('availability.manage') && (
              <Link href="/admin/blocked-time" className="crm-btn">
                Block time
              </Link>
            )}
            {canCreate && (
              <Link href={`/admin/sessions/new?date=${anchor}`} className="crm-btn crm-btn-primary">
                New booking
              </Link>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex gap-1" role="group" aria-label="Move">
          <Link className="crm-btn crm-btn-sm" href={withParams('/admin/calendar', params, { date: prevDate })} aria-label="Previous">
            ←
          </Link>
          <Link className="crm-btn crm-btn-sm" href={withParams('/admin/calendar', params, { date: today })}>
            Today
          </Link>
          <Link className="crm-btn crm-btn-sm" href={withParams('/admin/calendar', params, { date: nextDate })} aria-label="Next">
            →
          </Link>
        </div>
        <div className="flex gap-1" role="group" aria-label="View">
          {(['day', 'week', 'month', 'list'] as const).map((v) => (
            <Link key={v} className={`crm-btn crm-btn-sm ${view === v ? '!border-zayro-primary !text-zayro-primary' : ''}`} aria-current={view === v ? 'page' : undefined} href={withParams('/admin/calendar', params, { view: v })}>
              {humanize(v)}
            </Link>
          ))}
        </div>
        <form method="get" className="flex flex-wrap items-center gap-2 ml-auto">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={anchor} />
          <label className="sr-only" htmlFor="cal-cat">
            Category
          </label>
          <select id="cal-cat" name="category" defaultValue={category ?? ''} className="!w-auto">
            <option value="">All services</option>
            {SERVICE_CATEGORIES.filter((c) => c !== 'package').map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="cancelled" value="1" defaultChecked={showCancelled} /> Show cancelled
          </label>
          <button type="submit" className="crm-btn crm-btn-sm">
            Apply
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-zayro-gray mb-3" aria-label="Legend">
        {[
          ['bg-blue-50 border-blue-200', 'Podcast / session'],
          ['bg-rose-50 border-rose-200', 'Photography'],
          ['bg-sky-50 border-sky-200', 'Studio tour'],
          ['bg-amber-50 border-amber-300 border-dashed', 'Hold / awaiting payment'],
          ['bg-slate-200 border-slate-300', 'Blocked'],
        ].map(([cls, label]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 rounded border ${cls}`} /> {label}
          </span>
        ))}
      </div>

      {view === 'day' && timeGrid([anchor])}
      {view === 'week' && timeGrid(dates)}

      {view === 'month' && (
        <div className="card !p-0 overflow-hidden">
          <div className="crm-table-wrap">
            <div className="grid grid-cols-7 min-w-[720px]">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="px-2 py-2 text-xs font-semibold text-zayro-gray bg-[#F9FBFE] border-b border-zayro-border">
                  {d}
                </div>
              ))}
              {dates.map((d) => {
                const dayItems = items.filter((i) => i.date === d);
                const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
                return (
                  <div key={d} className={`min-h-[110px] border-b border-l border-zayro-border p-1.5 ${inMonth ? '' : 'bg-slate-50/70'} ${hoursFor(d) ? '' : 'bg-slate-50'}`}>
                    <Link href={withParams('/admin/calendar', params, { view: 'day', date: d })} className={`text-xs font-semibold ${d === today ? 'text-white bg-zayro-primary rounded-full px-1.5' : inMonth ? 'text-zayro-dark' : 'text-zayro-gray'}`}>
                      {Number(d.slice(8))}
                    </Link>
                    <ul className="mt-1 grid gap-0.5">
                      {dayItems.slice(0, 4).map((it) => (
                        <li key={it.key}>
                          {it.href ? (
                            <Link href={it.href} className={`block truncate rounded border px-1 text-[11px] ${tone(it)}`} title={`${it.title} — ${it.subtitle}`}>
                              {it.kind === 'booking' ? `${formatTimeLabel(`${String(Math.floor(it.start / 60)).padStart(2, '0')}:${String(it.start % 60).padStart(2, '0')}`)} ` : ''}
                              {it.title}
                            </Link>
                          ) : (
                            <span className={`block truncate rounded border px-1 text-[11px] ${tone(it)}`}>{it.title}</span>
                          )}
                        </li>
                      ))}
                      {dayItems.length > 4 && (
                        <li>
                          <Link href={withParams('/admin/calendar', params, { view: 'day', date: d })} className="text-[11px]">
                            +{dayItems.length - 4} more
                          </Link>
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {view === 'list' && (
        <div className="card">
          {dates.map((d) => {
            const dayItems = items.filter((i) => i.date === d);
            return (
              <section key={d} className="py-2 border-b border-zayro-border last:border-0">
                <h2 className={`text-sm font-semibold mb-1 ${d === today ? 'text-zayro-primary' : ''}`}>
                  {formatDateLabel(d)} {!hoursFor(d) && <span className="text-xs font-normal text-zayro-gray">· closed</span>}
                </h2>
                {dayItems.length === 0 ? (
                  <p className="text-xs text-zayro-gray">Nothing scheduled.</p>
                ) : (
                  <ul className="grid gap-1">
                    {dayItems.map((it) => (
                      <li key={it.key} className={`rounded-lg border px-2 py-1.5 text-sm flex flex-wrap justify-between gap-2 ${tone(it)}`}>
                        {it.href ? <Link href={it.href} className="font-medium text-inherit">{it.title}</Link> : <span className="font-medium">{it.title}</span>}
                        <span className="text-xs">
                          {it.subtitle} · {humanize(it.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
