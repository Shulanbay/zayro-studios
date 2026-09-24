/**
 * Studio-time helpers. Bookings are defined in America/New_York wall-clock
 * time (a date plus HH:MM strings); instants are stored as UTC. These
 * functions convert between the two with Intl only, so they are correct on
 * both DST transitions regardless of the server's own time zone. Pure —
 * safe for client components and unit tests.
 */

export const STUDIO_TZ = 'America/New_York';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isTimeString(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function wallParts(instant: Date, tz = STUDIO_TZ): WallParts {
  const parts = Object.fromEntries(formatterFor(tz).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of `tz` from UTC at `instant`, in minutes (New York: -300 or -240). */
export function tzOffsetMinutes(instant: Date, tz = STUDIO_TZ): number {
  const p = wallParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/**
 * The UTC instant of a wall-clock date + time in `tz`. For a time that
 * doesn't exist (inside the spring-forward gap) the result is the
 * equivalent instant after the jump; for an ambiguous time (fall-back) the
 * first occurrence (daylight time) is returned.
 */
export function wallTimeToUtc(date: string, time: string, tz = STUDIO_TZ): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset1 = tzOffsetMinutes(new Date(guess), tz);
  let result = guess - offset1 * 60000;
  const offset2 = tzOffsetMinutes(new Date(result), tz);
  if (offset2 !== offset1) {
    const alt = guess - offset2 * 60000;
    // Prefer the candidate that round-trips to the requested wall time.
    const altWall = utcToWall(new Date(alt), tz);
    if (altWall.date === date && altWall.time === time) result = alt;
  }
  return new Date(result);
}

export function utcToWall(instant: Date, tz = STUDIO_TZ): { date: string; time: string; minutes: number } {
  const p = wallParts(instant, tz);
  const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const minutes = p.hour * 60 + p.minute;
  return { date, time: minutesToTime(minutes), minutes };
}

export function todayInTz(now = new Date(), tz = STUDIO_TZ): string {
  return utcToWall(now, tz).date;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export type DayName = (typeof DAY_NAMES)[number];

/** Weekday of a calendar date (independent of any time zone). */
export function dayOfWeek(date: string): DayName {
  return DAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/**
 * Minutes from the start of wall-clock `date` in `tz` to `instant`. Can be
 * negative (instant is on an earlier day) or ≥ 1440 (a later day) — used to
 * clip blocked-time ranges to a single day.
 */
export function minutesIntoDay(instant: Date, date: string, tz = STUDIO_TZ): number {
  const wall = utcToWall(instant, tz);
  return daysBetween(date, wall.date) * 1440 + wall.minutes;
}

/** "Mon, Oct 5, 2026" */
export function formatDateLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "2:30 PM" from "14:30" */
export function formatTimeLabel(time: string): string {
  const minutes = timeToMinutes(time);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** An instant shown in studio time: "Oct 5, 2026, 2:30 PM ET". */
export function formatInstantEt(instant: Date | string | null | undefined): string {
  if (!instant) return '—';
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleString('en-US', { timeZone: STUDIO_TZ, dateStyle: 'medium', timeStyle: 'short' })} ET`;
}
