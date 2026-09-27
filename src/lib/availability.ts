import { db } from './db';
import {
  bookings,
  temporaryHolds,
  blockedTimes,
  availability as availabilityTable,
  availabilityOverrides,
  businessSettings,
} from './db/schema';
import type { AvailabilityOverride } from './db/schema';
import type { Executor } from './db/types';
import { and, eq, gt, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import {
  STUDIO_TZ,
  addDays,
  dayOfWeek,
  isDateString,
  minutesIntoDay,
  minutesToTime as toTime,
  timeToMinutes as toMinutes,
  todayInTz,
  wallTimeToUtc,
} from './crm/time';

/**
 * Studio availability. The studio is one room: every booking that holds the
 * room (confirmed / completed / no-show) and every active hold blocks it,
 * whatever service it is for. All evaluation happens in studio wall-clock
 * time (America/New_York); instants (blocked time, "now") are converted
 * with DST-aware helpers.
 */

export interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

interface BusyRange {
  start: number; // minutes since midnight (studio time)
  end: number;
}

/** Booking statuses that occupy the studio. */
export const ROOM_HOLDING_STATUSES = ['confirmed', 'completed', 'no_show'] as const;

export const timeToMinutes = toMinutes;
export const minutesToTime = toTime;

export function getDayOfWeek(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getUTCDay()];
}

export function overlaps(slot1Start: number, slot1End: number, slot2Start: number, slot2End: number): boolean {
  return slot1Start < slot2End && slot2Start < slot1End;
}

/**
 * Pure slot generator — no DB access. Slots start at business open and step
 * by the increment; slots starting before `minSlotStart` (the booking
 * cutoff) are dropped, so every offered start time stays on the grid.
 */
export function generateSlotsForDay(params: {
  businessStart: number;
  businessEnd: number;
  durationMinutes: number;
  incrementMinutes: number;
  minSlotStart: number;
  busyRanges: BusyRange[]; // bookings + holds, buffers already applied
  blockedRanges: BusyRange[]; // blocked times, clipped to this day
}): TimeSlot[] {
  const { businessStart, businessEnd, durationMinutes, incrementMinutes, minSlotStart, busyRanges, blockedRanges } = params;
  const slots: TimeSlot[] = [];
  const step = Math.max(5, incrementMinutes || 30);

  for (let slotStart = businessStart; slotStart + durationMinutes <= businessEnd; slotStart += step) {
    if (slotStart < minSlotStart) continue;
    const slotEnd = slotStart + durationMinutes;
    const available =
      !busyRanges.some((b) => overlaps(slotStart, slotEnd, b.start, b.end)) &&
      !blockedRanges.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
    slots.push({ start: toTime(slotStart), end: toTime(slotEnd), available });
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Booking rules (business_settings)
// ---------------------------------------------------------------------------

export interface BookingRules {
  bufferBefore: number;
  bufferAfter: number;
  increment: number;
  minAdvanceHours: number;
  horizonDays: number;
}

export const BOOKING_RULE_KEYS = {
  bufferBefore: 'buffer_before_booking',
  bufferAfter: 'buffer_after_booking',
  increment: 'booking_increment_minutes',
  minAdvanceHours: 'min_advance_notice_hours',
  horizonDays: 'max_booking_horizon_days',
} as const;

const RULE_DEFAULTS: BookingRules = { bufferBefore: 0, bufferAfter: 0, increment: 30, minAdvanceHours: 1, horizonDays: 90 };

export async function getBookingRules(exec: Executor = db): Promise<BookingRules> {
  const rows = await exec.query.businessSettings.findMany({
    where: inArray(businessSettings.setting_key, Object.values(BOOKING_RULE_KEYS)),
  });
  const byKey = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
  const num = (key: keyof BookingRules) => {
    const n = parseFloat(byKey.get(BOOKING_RULE_KEYS[key]) ?? '');
    return Number.isFinite(n) && n >= 0 ? n : RULE_DEFAULTS[key];
  };
  return {
    bufferBefore: Math.round(num('bufferBefore')),
    bufferAfter: Math.round(num('bufferAfter')),
    increment: Math.max(5, Math.round(num('increment'))),
    minAdvanceHours: num('minAdvanceHours'),
    horizonDays: Math.max(1, Math.round(num('horizonDays'))),
  };
}

// ---------------------------------------------------------------------------
// Day context
// ---------------------------------------------------------------------------

export interface DayContext {
  date: string;
  /** Opening hours after overrides; null when the studio is closed. */
  open: { start: number; end: number } | null;
  override: AvailabilityOverride | null;
  closedReason: string | null;
  busy: BusyRange[];
  blocked: BusyRange[];
  minSlotStart: number;
  rules: BookingRules;
}

export interface DayOptions {
  /** Ignore this booking (rescheduling it must not conflict with itself). */
  excludeBookingId?: string;
  /** Ignore this hold. */
  excludeHoldId?: string;
  /** Staff bookings may be placed inside the notice window / in the past. */
  ignoreCutoff?: boolean;
  now?: Date;
  rules?: BookingRules;
}

/**
 * Marks active holds whose time is up as expired. Scoped to one date (or a
 * date range) when given, otherwise a global sweep; cheap either way
 * (indexed on status + expiry). Expired holds never block a slot even
 * before this runs — every read also filters on hold_expires_at.
 */
export async function expireOldHolds(bookingDate?: string | { from: string; to: string }, exec: Executor = db) {
  const now = new Date();
  const conditions = [eq(temporaryHolds.status, 'active'), lte(temporaryHolds.hold_expires_at, now)];
  if (typeof bookingDate === 'string') conditions.push(eq(temporaryHolds.booking_date, bookingDate));
  else if (bookingDate) {
    conditions.push(gte(temporaryHolds.booking_date, bookingDate.from), lte(temporaryHolds.booking_date, bookingDate.to));
  }
  await exec.update(temporaryHolds).set({ status: 'expired' }).where(and(...conditions));
}

/** Earliest bookable start (minutes into `date`) given the advance-notice rule. */
export function computeMinSlotStart(date: string, minAdvanceHours: number, now: Date, tz = STUDIO_TZ): number {
  const today = todayInTz(now, tz);
  if (date < today) return Number.MAX_SAFE_INTEGER;
  const earliest = new Date(now.getTime() + minAdvanceHours * 3600 * 1000);
  return Math.max(0, Math.ceil(minutesIntoDay(earliest, date, tz)));
}

/** Everything that decides availability for a run of dates, loaded in one go. */
interface RangeData {
  weekly: Map<string, { start_time: string; end_time: string }>;
  overrides: Map<string, AvailabilityOverride>;
  bookings: { starts_at: Date | string | null; ends_at: Date | string | null }[];
  holds: { booking_date: string | Date; start_time: string; end_time: string }[];
  blocks: { start_datetime: Date; end_datetime: Date }[];
}

async function loadRangeData(from: string, to: string, exec: Executor, options: DayOptions, now: Date): Promise<RangeData> {
  const rangeStart = wallTimeToUtc(from, '00:00');
  const rangeEnd = wallTimeToUtc(addDays(to, 1), '00:00');

  await expireOldHolds({ from, to }, exec);

  const bookingConditions = [
    eq(bookings.room_id, 1),
    inArray(bookings.status, [...ROOM_HOLDING_STATUSES]),
    lt(bookings.starts_at, rangeEnd),
    gt(bookings.ends_at, rangeStart),
  ];
  if (options.excludeBookingId) bookingConditions.push(ne(bookings.id, options.excludeBookingId));

  const holdConditions = [
    gte(temporaryHolds.booking_date, from),
    lte(temporaryHolds.booking_date, to),
    eq(temporaryHolds.status, 'active'),
    gt(temporaryHolds.hold_expires_at, now),
  ];
  if (options.excludeHoldId) holdConditions.push(ne(temporaryHolds.id, options.excludeHoldId));

  const [weeklyRows, overrideRows, roomBookings, holds, blocks] = await Promise.all([
    exec.query.availability.findMany({ where: eq(availabilityTable.is_available, true), orderBy: (a, { asc }) => [asc(a.id)] }),
    exec.query.availabilityOverrides.findMany({
      where: and(eq(availabilityOverrides.room_id, 1), gte(availabilityOverrides.date, from), lte(availabilityOverrides.date, to)),
    }),
    exec
      .select({ starts_at: bookings.starts_at, ends_at: bookings.ends_at })
      .from(bookings)
      .where(and(...bookingConditions)),
    exec.query.temporaryHolds.findMany({ where: and(...holdConditions) }),
    exec.query.blockedTimes.findMany({
      where: and(isNull(blockedTimes.deleted_at), lt(blockedTimes.start_datetime, rangeEnd), gt(blockedTimes.end_datetime, rangeStart)),
    }),
  ]);

  const weekly = new Map<string, { start_time: string; end_time: string }>();
  for (const row of weeklyRows) if (!weekly.has(row.day_of_week)) weekly.set(row.day_of_week, row);
  const overrides = new Map<string, AvailabilityOverride>();
  for (const row of overrideRows) overrides.set(toDateOnly(row.date), row);
  return { weekly, overrides, bookings: roomBookings, holds, blocks };
}

function toDateOnly(value: string | Date): string {
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

function buildDayContext(date: string, data: RangeData, rules: BookingRules, now: Date, options: DayOptions): DayContext {
  const weekly = data.weekly.get(dayOfWeek(date));
  const override = data.overrides.get(date);

  let open: DayContext['open'] = weekly ? { start: toMinutes(weekly.start_time), end: toMinutes(weekly.end_time) } : null;
  let closedReason: string | null = weekly ? null : 'Closed on this weekday';
  if (override) {
    if (override.is_closed) {
      open = null;
      closedReason = override.reason || override.kind.replace('_', ' ');
    } else if (override.start_time && override.end_time) {
      open = { start: toMinutes(override.start_time), end: toMinutes(override.end_time) };
      closedReason = null;
    }
  }

  const dayStart = wallTimeToUtc(date, '00:00').getTime();
  const dayEnd = wallTimeToUtc(addDays(date, 1), '00:00').getTime();
  const touchesDay = (start: Date | string, end: Date | string) => new Date(start).getTime() < dayEnd && new Date(end).getTime() > dayStart;

  const busy: BusyRange[] = [
    ...data.bookings
      .filter((b) => b.starts_at && b.ends_at && touchesDay(b.starts_at, b.ends_at))
      .map((b) => ({
        start: minutesIntoDay(new Date(b.starts_at!), date) - rules.bufferBefore,
        end: minutesIntoDay(new Date(b.ends_at!), date) + rules.bufferAfter,
      })),
    ...data.holds
      .filter((h) => toDateOnly(h.booking_date) === date)
      .map((h) => ({
        start: toMinutes(h.start_time) - rules.bufferBefore,
        end: toMinutes(h.end_time) + rules.bufferAfter,
      })),
  ];

  const blocked: BusyRange[] = data.blocks
    .filter((b) => touchesDay(b.start_datetime, b.end_datetime))
    .map((b) => ({
      start: Math.floor(minutesIntoDay(new Date(b.start_datetime), date)),
      end: Math.ceil(minutesIntoDay(new Date(b.end_datetime), date)),
    }));

  return {
    date,
    open,
    override: override ?? null,
    closedReason,
    busy,
    blocked,
    minSlotStart: options.ignoreCutoff ? 0 : computeMinSlotStart(date, rules.minAdvanceHours, now),
    rules,
  };
}

export async function loadDayContext(date: string, exec: Executor = db, options: DayOptions = {}): Promise<DayContext> {
  const rules = options.rules ?? (await getBookingRules(exec));
  const now = options.now ?? new Date();
  const data = await loadRangeData(date, date, exec, options, now);
  return buildDayContext(date, data, rules, now, options);
}

/** Day contexts for every date in [from, to] with a constant number of queries. */
export async function loadRangeContexts(from: string, to: string, exec: Executor = db, options: DayOptions = {}): Promise<DayContext[]> {
  const rules = options.rules ?? (await getBookingRules(exec));
  const now = options.now ?? new Date();
  if (to < from) return [];
  const data = await loadRangeData(from, to, exec, options, now);
  const days: DayContext[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) days.push(buildDayContext(date, data, rules, now, options));
  return days;
}

export function slotsFromContext(ctx: DayContext, durationMinutes: number): TimeSlot[] {
  if (!ctx.open) return [];
  return generateSlotsForDay({
    businessStart: ctx.open.start,
    businessEnd: ctx.open.end,
    durationMinutes,
    incrementMinutes: ctx.rules.increment,
    minSlotStart: ctx.minSlotStart,
    busyRanges: ctx.busy,
    blockedRanges: ctx.blocked,
  });
}

/**
 * Slots of `durationMinutes` (the selected service's length) for the whole
 * studio. Database errors propagate: callers must not mistake an outage for
 * "fully booked".
 */
export async function getAvailableTimeSlotsForDate(
  bookingDate: string,
  durationMinutes: number,
  exec: Executor = db,
  options: DayOptions = {}
): Promise<TimeSlot[]> {
  if (!isDateString(bookingDate)) return [];
  const ctx = await loadDayContext(bookingDate, exec, options);
  return slotsFromContext(ctx, durationMinutes);
}

/**
 * Dates in [fromDate, toDate] (clipped to today … today + horizon, ET) with
 * at least one free slot of `durationMinutes`. Five queries for the whole
 * range, not per day.
 */
export async function getAvailableDates(
  fromDate: string,
  toDate: string,
  durationMinutes = 60,
  exec: Executor = db,
  options: DayOptions = {}
): Promise<string[]> {
  if (!isDateString(fromDate) || !isDateString(toDate)) return [];
  const rules = options.rules ?? (await getBookingRules(exec));
  const today = todayInTz(options.now ?? new Date());
  const lastBookable = addDays(today, rules.horizonDays);
  const start = fromDate < today ? today : fromDate;
  const end = toDate < lastBookable ? toDate : lastBookable;
  const days = await loadRangeContexts(start, end, exec, { ...options, rules });
  return days.filter((ctx) => slotsFromContext(ctx, durationMinutes).some((s) => s.available)).map((ctx) => ctx.date);
}

/**
 * Authoritative server-side check that a specific requested slot is a real,
 * currently-available slot (business hours, overrides, cutoff, buffers,
 * bookings, holds and blocked time). Used by create-hold, manual bookings
 * and reschedules.
 */
export async function isSlotActuallyAvailable(
  bookingDate: string,
  startTime: string,
  endTime: string,
  durationMinutes: number,
  exec: Executor = db,
  options: DayOptions = {}
): Promise<boolean> {
  const slots = await getAvailableTimeSlotsForDate(bookingDate, durationMinutes, exec, options);
  return slots.some((s) => s.start === startTime && s.end === endTime && s.available);
}

/**
 * Is [startTime, endTime) on `bookingDate` free of other bookings, holds
 * and blocked time (buffers applied)? Unlike isSlotActuallyAvailable this
 * ignores opening hours and the grid — staff may book off-grid or outside
 * hours with an explicit override, but never on top of someone else.
 */
export async function checkTimeSlotConflict(
  bookingDate: string,
  startTime: string,
  endTime: string,
  exec: Executor = db,
  options: DayOptions = {}
): Promise<boolean> {
  const ctx = await loadDayContext(bookingDate, exec, { ...options, ignoreCutoff: true });
  const start = toMinutes(startTime);
  const end = toMinutes(endTime) <= start ? toMinutes(endTime) + 1440 : toMinutes(endTime);
  return (
    ctx.busy.some((b) => overlaps(start, end, b.start, b.end)) || ctx.blocked.some((b) => overlaps(start, end, b.start, b.end))
  );
}

/**
 * Serialises every writer that can occupy the studio on `date` (holds,
 * confirmations, manual bookings, reschedules, blocked time). Transaction
 * scoped — released on commit/rollback. Lock several dates in sorted order
 * to avoid deadlocks.
 */
export async function lockStudioDates(tx: Executor, dates: string[]) {
  for (const date of Array.from(new Set(dates)).sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`studio:${date}`}))`);
  }
}
