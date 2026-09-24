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

export async function expireOldHolds(bookingDate?: string, exec: Executor = db) {
  const now = new Date();
  const conditions = [eq(temporaryHolds.status, 'active'), lte(temporaryHolds.hold_expires_at, now)];
  if (bookingDate !== undefined) conditions.push(eq(temporaryHolds.booking_date, bookingDate));
  await exec.update(temporaryHolds).set({ status: 'expired' }).where(and(...conditions));
}

/** Earliest bookable start (minutes into `date`) given the advance-notice rule. */
export function computeMinSlotStart(date: string, minAdvanceHours: number, now: Date, tz = STUDIO_TZ): number {
  const today = todayInTz(now, tz);
  if (date < today) return Number.MAX_SAFE_INTEGER;
  const earliest = new Date(now.getTime() + minAdvanceHours * 3600 * 1000);
  return Math.max(0, Math.ceil(minutesIntoDay(earliest, date, tz)));
}

export async function loadDayContext(date: string, exec: Executor = db, options: DayOptions = {}): Promise<DayContext> {
  const rules = options.rules ?? (await getBookingRules(exec));
  const now = options.now ?? new Date();

  const [weekly, override] = await Promise.all([
    exec.query.availability.findFirst({
      where: and(eq(availabilityTable.day_of_week, dayOfWeek(date)), eq(availabilityTable.is_available, true)),
    }),
    exec.query.availabilityOverrides.findFirst({
      where: and(eq(availabilityOverrides.room_id, 1), eq(availabilityOverrides.date, date)),
    }),
  ]);

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

  const dayStart = wallTimeToUtc(date, '00:00');
  const dayEnd = wallTimeToUtc(addDays(date, 1), '00:00');

  await expireOldHolds(date, exec);

  const bookingConditions = [
    eq(bookings.room_id, 1),
    inArray(bookings.status, [...ROOM_HOLDING_STATUSES]),
    lt(bookings.starts_at, dayEnd),
    gt(bookings.ends_at, dayStart),
  ];
  if (options.excludeBookingId) bookingConditions.push(ne(bookings.id, options.excludeBookingId));

  const holdConditions = [
    eq(temporaryHolds.booking_date, date),
    eq(temporaryHolds.status, 'active'),
    gte(temporaryHolds.hold_expires_at, now),
  ];
  if (options.excludeHoldId) holdConditions.push(ne(temporaryHolds.id, options.excludeHoldId));

  const [roomBookings, holds, blocks] = await Promise.all([
    exec
      .select({ starts_at: bookings.starts_at, ends_at: bookings.ends_at })
      .from(bookings)
      .where(and(...bookingConditions)),
    exec.query.temporaryHolds.findMany({ where: and(...holdConditions) }),
    exec.query.blockedTimes.findMany({
      where: and(
        isNull(blockedTimes.deleted_at),
        lt(blockedTimes.start_datetime, dayEnd),
        gt(blockedTimes.end_datetime, dayStart)
      ),
    }),
  ]);

  const busy: BusyRange[] = [
    ...roomBookings
      .filter((b) => b.starts_at && b.ends_at)
      .map((b) => ({
        start: minutesIntoDay(new Date(b.starts_at!), date) - rules.bufferBefore,
        end: minutesIntoDay(new Date(b.ends_at!), date) + rules.bufferAfter,
      })),
    ...holds.map((h) => ({
      start: toMinutes(h.start_time) - rules.bufferBefore,
      end: toMinutes(h.end_time) + rules.bufferAfter,
    })),
  ];

  const blocked: BusyRange[] = blocks.map((b) => ({
    start: Math.floor(minutesIntoDay(b.start_datetime, date)),
    end: Math.ceil(minutesIntoDay(b.end_datetime, date)),
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

/** Slots of `durationMinutes` (the selected service's length) for the whole studio. */
export async function getAvailableTimeSlotsForDate(
  bookingDate: string,
  durationMinutes: number,
  exec: Executor = db,
  options: DayOptions = {}
): Promise<TimeSlot[]> {
  try {
    if (!isDateString(bookingDate)) return [];
    const ctx = await loadDayContext(bookingDate, exec, options);
    return slotsFromContext(ctx, durationMinutes);
  } catch (error) {
    console.error('Error getting available time slots:', error);
    return [];
  }
}

export async function getAvailableDates(fromDate: string, toDate: string, durationMinutes = 60): Promise<string[]> {
  try {
    if (!isDateString(fromDate) || !isDateString(toDate)) return [];
    const rules = await getBookingRules();
    const today = todayInTz();
    const lastBookable = addDays(today, rules.horizonDays);
    const end = toDate < lastBookable ? toDate : lastBookable;
    const availableDates: string[] = [];
    for (let date = fromDate < today ? today : fromDate; date <= end; date = addDays(date, 1)) {
      const ctx = await loadDayContext(date, db, { rules });
      if (slotsFromContext(ctx, durationMinutes).some((s) => s.available)) availableDates.push(date);
    }
    return availableDates;
  } catch (error) {
    console.error('Error getting available dates:', error);
    return [];
  }
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
