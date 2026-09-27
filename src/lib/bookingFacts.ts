import { db } from './db';
import { getBookingRules } from './availability';
import { formatTimeLabel } from './crm/time';

/** Booking facts shown in public copy (FAQ), read from the same settings the booking calendar uses. */
export interface BookingFacts {
  /** e.g. "8:00 AM to 10:00 PM (New York time), seven days a week" — null when hours differ by day. */
  hoursSentence: string | null;
  horizonDays: number;
  minNoticeHours: number;
}

export const DEFAULT_BOOKING_FACTS: BookingFacts = {
  hoursSentence: '8:00 AM to 10:00 PM (New York time), seven days a week',
  horizonDays: 90,
  minNoticeHours: 1,
};

export async function getBookingFacts(): Promise<BookingFacts> {
  try {
    const [rows, rules] = await Promise.all([db.query.availability.findMany(), getBookingRules()]);
    const open = rows.filter((r) => r.is_available);
    const days = new Set(open.map((r) => r.day_of_week));
    const spans = new Set(open.map((r) => `${r.start_time}-${r.end_time}`));
    let hoursSentence: string | null = null;
    if (open.length > 0 && spans.size === 1) {
      const [start, end] = Array.from(spans)[0].split('-');
      const when = days.size === 7 ? 'seven days a week' : `on ${Array.from(days).join(', ')}`;
      hoursSentence = `${formatTimeLabel(start)} to ${formatTimeLabel(end)} (New York time), ${when}`;
    }
    return { hoursSentence, horizonDays: rules.horizonDays, minNoticeHours: rules.minAdvanceHours };
  } catch (error) {
    console.error('Booking facts unavailable, using defaults:', (error as Error)?.message || error);
    return DEFAULT_BOOKING_FACTS;
  }
}
