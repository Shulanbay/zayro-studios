import { db } from './db';
import { bookings, integrationLogs } from './db/schema';
import { eq } from 'drizzle-orm';
import type { Booking, Service } from './db/schema';
import { sendBookingConfirmationEmail, sendOwnerNotificationEmail } from './email';
import { createCalendarEventForBooking } from './googleCalendar';

async function logIntegration(
  type: 'email' | 'google_calendar',
  bookingId: string,
  status: 'success' | 'failed',
  message: string
) {
  try {
    await db.insert(integrationLogs).values({
      integration_type: type,
      booking_id: bookingId,
      status,
      error_message: status === 'failed' ? message : null,
      response_data: { message, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error logging integration:', err);
  }
}

/**
 * Fires everything that should happen once a booking is confirmed
 * (paid or free): customer + owner emails, and a Google Calendar event.
 * Every side effect is independent and non-blocking for the caller — a
 * failure here never un-confirms the booking, it's just logged.
 */
export async function runPostConfirmationSideEffects(booking: Booking, service: Service): Promise<void> {
  const [customerEmailResult, ownerEmailResult, calendarResult] = await Promise.all([
    sendBookingConfirmationEmail({ booking, service }),
    sendOwnerNotificationEmail({ booking, service }),
    createCalendarEventForBooking(booking, service),
  ]);

  await logIntegration(
    'email',
    booking.id,
    customerEmailResult.sent ? 'success' : 'failed',
    customerEmailResult.sent ? 'Customer confirmation email sent' : `Customer email skipped: ${customerEmailResult.error}`
  );
  await logIntegration(
    'email',
    booking.id,
    ownerEmailResult.sent ? 'success' : 'failed',
    ownerEmailResult.sent ? 'Owner notification email sent' : `Owner email skipped: ${ownerEmailResult.error}`
  );
  await logIntegration(
    'google_calendar',
    booking.id,
    calendarResult.eventId ? 'success' : 'failed',
    calendarResult.eventId ? `Calendar event created: ${calendarResult.eventId}` : `Calendar skipped: ${calendarResult.error}`
  );

  if (calendarResult.eventId && calendarResult.eventId !== booking.google_calendar_event_id) {
    await db
      .update(bookings)
      .set({ google_calendar_event_id: calendarResult.eventId })
      .where(eq(bookings.id, booking.id));
  }
}
