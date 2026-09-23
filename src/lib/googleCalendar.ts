import { google } from 'googleapis';
import type { Booking, Service } from './db/schema';

function isConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CALENDAR_EMAIL &&
    process.env.GOOGLE_CALENDAR_PRIVATE_KEY &&
    process.env.GOOGLE_CALENDAR_ID
  );
}

function getCalendarClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CALENDAR_EMAIL,
    // .env files store the key with literal \n sequences; convert to real newlines.
    key: (process.env.GOOGLE_CALENDAR_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

/**
 * Creates a Google Calendar event for a confirmed booking. No-ops (returns
 * null) when Google Calendar credentials aren't configured, so this is safe
 * to call unconditionally after every booking confirmation. Never throws.
 */
export async function createCalendarEventForBooking(
  booking: Booking,
  service: Service
): Promise<{ eventId: string | null; error?: string }> {
  if (!isConfigured()) {
    return { eventId: null, error: 'Google Calendar not configured' };
  }

  // Idempotency: don't create a second event for a booking that already has one.
  if (booking.google_calendar_event_id) {
    return { eventId: booking.google_calendar_event_id };
  }

  try {
    const calendar = getCalendarClient();
    const calendarId = process.env.GOOGLE_CALENDAR_ID!;

    const startDateTime = `${booking.booking_date}T${booking.start_time}:00`;
    const endDateTime = `${booking.booking_date}T${booking.end_time}:00`;

    const event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `${service.name} — ${booking.customer_first_name} ${booking.customer_last_name}`,
        description: [
          `Booking ID: ${booking.booking_id}`,
          `Customer: ${booking.customer_first_name} ${booking.customer_last_name}`,
          `Email: ${booking.customer_email}`,
          `Phone: ${booking.customer_phone}`,
          booking.notes ? `Notes: ${booking.notes}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        location: '40 W 37th St, Suite 603, New York, NY 10018',
        start: { dateTime: startDateTime, timeZone: 'America/New_York' },
        end: { dateTime: endDateTime, timeZone: 'America/New_York' },
      },
    });

    return { eventId: event.data.id || null };
  } catch (error: any) {
    console.error('Error creating Google Calendar event:', error);
    return { eventId: null, error: error?.message || String(error) };
  }
}
