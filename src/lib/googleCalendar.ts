import { createHash } from 'crypto';
import { google, type calendar_v3 } from 'googleapis';
import type { Booking, Service } from './db/schema';
import { toDateOnly } from './utils';
import { BUSINESS_ADDRESS } from './constants';
import { STUDIO_TIMEZONE, bookingKindLabel, getBookingKind } from './bookingKind';
import {
  describeMissingConfig,
  getCalendarId,
  getGoogleAuth,
  googleErrorStatus,
  safeGoogleErrorMessage,
} from './googleAuth';

export type CalendarSyncResult =
  | { status: 'created' | 'already_exists'; eventId: string; message: string }
  | { status: 'skipped' | 'not_configured' | 'failed'; eventId: null; message: string };

/**
 * Deterministic Google Calendar event ID for a booking. Google only allows
 * base32hex characters (a–v, 0–9) and 5–1024 chars; a hex digest satisfies
 * that. Because the ID is derived from the booking, two concurrent syncs for
 * the same booking can never both create an event — the second insert gets
 * 409 Conflict and we fall back to the existing event.
 */
export function calendarEventIdForBooking(booking: Pick<Booking, 'booking_id'>): string {
  return `bk${createHash('sha256').update(`zayro-booking:${booking.booking_id}`).digest('hex').slice(0, 40)}`;
}

function addDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds the event body. Times are sent as wall-clock values plus an IANA
 * timeZone, so Google resolves EST/EDT itself — no UTC conversion (and no
 * chance of shifting the date) happens on our side.
 */
export function buildCalendarEvent(booking: Booking, service: Service): calendar_v3.Schema$Event {
  const kind = getBookingKind(booking, service);
  const label = bookingKindLabel(kind, booking);
  const datePart = toDateOnly(booking.booking_date);
  // A session ending at or before its start time runs past midnight.
  const endDate = booking.end_time <= booking.start_time ? addDays(datePart, 1) : datePart;
  const customerName = `${booking.customer_first_name} ${booking.customer_last_name}`.trim();
  const total = parseFloat(booking.total_amount);

  const description = [
    label,
    '',
    `Booking ID: ${booking.booking_id}`,
    `Service: ${service.name}`,
    `Customer: ${customerName}`,
    `Email: ${booking.customer_email}`,
    `Phone: ${booking.customer_phone}`,
    booking.company_name ? `Company: ${booking.company_name}` : null,
    `Payment status: ${booking.payment_status}`,
    `Total: $${Number.isFinite(total) ? total.toFixed(2) : booking.total_amount}`,
    booking.notes ? `\nNotes:\n${booking.notes}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');

  return {
    id: calendarEventIdForBooking(booking),
    summary: `${label}: ${service.name} — ${customerName}`,
    description,
    location: BUSINESS_ADDRESS,
    start: { dateTime: `${datePart}T${booking.start_time}:00`, timeZone: STUDIO_TIMEZONE },
    end: { dateTime: `${endDate}T${booking.end_time}:00`, timeZone: STUDIO_TIMEZONE },
    // Deliberately no attendees: the customer already gets our own
    // confirmation email and shouldn't also receive a Google invite.
    extendedProperties: {
      private: {
        bookingId: booking.booking_id,
        bookingType: kind,
      },
    },
  };
}

export function getCalendarClient(): calendar_v3.Calendar {
  return google.calendar({ version: 'v3', auth: getGoogleAuth() });
}

/**
 * Makes sure a confirmed booking has exactly one event in the studio
 * calendar. Safe to call any number of times, concurrently. Never throws.
 */
export async function syncCalendarEvent(
  booking: Booking,
  service: Service,
  options: { calendar?: calendar_v3.Calendar } = {}
): Promise<CalendarSyncResult> {
  if (booking.status !== 'confirmed') {
    return { status: 'skipped', eventId: null, message: `Booking is ${booking.status}, not confirmed` };
  }

  if (booking.google_calendar_event_id) {
    return {
      status: 'already_exists',
      eventId: booking.google_calendar_event_id,
      message: 'Booking already has a calendar event',
    };
  }

  const missing = options.calendar ? null : describeMissingConfig('calendar');
  if (missing) {
    return { status: 'not_configured', eventId: null, message: missing };
  }

  try {
    const calendar = options.calendar ?? getCalendarClient();
    const calendarId = getCalendarId();
    const requestBody = buildCalendarEvent(booking, service);
    const eventId = requestBody.id!;

    try {
      const created = await calendar.events.insert({ calendarId, requestBody, sendUpdates: 'none' });
      return { status: 'created', eventId: created.data.id || eventId, message: 'Calendar event created' };
    } catch (insertError) {
      // 409: an event with this deterministic ID already exists — created by
      // an earlier or concurrent run whose DB update didn't land. Reuse it.
      if (googleErrorStatus(insertError) !== 409) throw insertError;
      const existing = await calendar.events.get({ calendarId, eventId });
      const cancelled = existing.data.status === 'cancelled';
      return {
        status: 'already_exists',
        eventId: existing.data.id || eventId,
        message: cancelled
          ? 'Calendar event already exists but was deleted in Google Calendar; not recreated'
          : 'Calendar event already existed; reused',
      };
    }
  } catch (error) {
    const message = safeGoogleErrorMessage(error);
    console.error(`Google Calendar sync failed for booking ${booking.booking_id}: ${message}`);
    return { status: 'failed', eventId: null, message };
  }
}

/** Read-only connection check for admin diagnostics. */
export async function checkCalendarConnection(): Promise<{ ok: boolean; message: string }> {
  const missing = describeMissingConfig('calendar');
  if (missing) return { ok: false, message: missing };
  try {
    const res = await getCalendarClient().calendars.get({ calendarId: getCalendarId() });
    return { ok: true, message: `Connected (calendar time zone: ${res.data.timeZone || 'unknown'})` };
  } catch (error) {
    return { ok: false, message: safeGoogleErrorMessage(error) };
  }
}
