import { db } from './db';
import { getBookingRules } from './availability';
import { formatTimeLabel } from './crm/time';

/** Booking facts shown in public copy (FAQ), read from the same settings the booking calendar uses. */
export interface BookingFacts {
  /** e.g. "8:00 AM to 10:00 PM (New York time), seven days a week" — null when hours differ by day. */
  hoursSentence: string | null;
  horizonDays: number;
  minNoticeHours: number;
  /** True only when the database has opening hours on all seven weekdays. */
  openSevenDays: boolean;
}

export const DEFAULT_BOOKING_FACTS: BookingFacts = {
  hoursSentence: '8:00 AM to 10:00 PM (New York time), seven days a week',
  horizonDays: 90,
  minNoticeHours: 1,
  // Unknown without the database: never claim it.
  openSevenDays: false,
};

type WeeklyRow = { day_of_week: string; start_time: string; end_time: string; is_available: boolean };

/** An active weekly row with a real window (an end of 00:00 means midnight). */
export function hasBookableWindow(r: WeeklyRow): boolean {
  return r.is_available && (r.start_time < r.end_time || (r.end_time === '00:00' && r.start_time !== '00:00'));
}

/** "Open 7 Days" may be shown only when the active weekly hours accept bookings on every weekday. */
export function isOpenSevenDays(rows: WeeklyRow[]): boolean {
  return new Set(rows.filter(hasBookableWindow).map((r) => r.day_of_week)).size === 7;
}

export async function getBookingFacts(): Promise<BookingFacts> {
  try {
    const [rows, rules] = await Promise.all([db.query.availability.findMany(), getBookingRules()]);
    const open = rows.filter(hasBookableWindow);
    const days = new Set(open.map((r) => r.day_of_week));
    const spans = new Set(open.map((r) => `${r.start_time}-${r.end_time}`));
    let hoursSentence: string | null = null;
    if (open.length > 0 && spans.size === 1) {
      const [start, end] = Array.from(spans)[0].split('-');
      const when = days.size === 7 ? 'seven days a week' : `on ${Array.from(days).join(', ')}`;
      hoursSentence = `${formatTimeLabel(start)} to ${formatTimeLabel(end)} (New York time), ${when}`;
    }
    return { hoursSentence, horizonDays: rules.horizonDays, minNoticeHours: rules.minAdvanceHours, openSevenDays: isOpenSevenDays(rows) };
  } catch (error) {
    console.error('Booking facts unavailable, using defaults:', (error as Error)?.message || error);
    return DEFAULT_BOOKING_FACTS;
  }
}
