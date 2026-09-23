import type { Booking, Service } from './db/schema';
import { sendBookingConfirmationEmail, sendOwnerNotificationEmail } from './email';
import { logIntegration, syncGoogleIntegrations } from './integrationSync';
import type { CalendarSyncResult } from './googleCalendar';
import type { SheetsSyncResult } from './googleSheets';

export interface PostConfirmationResult {
  customerEmail: { sent: boolean; error?: string };
  ownerEmail: { sent: boolean; error?: string };
  calendar: CalendarSyncResult;
  sheets: SheetsSyncResult;
}

/**
 * Fires everything that should happen once a booking is confirmed (paid or
 * free): customer + owner emails, a Google Calendar event and a Google
 * Sheets row. Every side effect runs independently and is logged on its
 * own; a failure here never un-confirms the booking.
 *
 * Callers must only invoke this once per confirmation (the Stripe webhook
 * and free-confirm route guarantee that with a conditional status update).
 * The Google steps are additionally idempotent on their own, so the admin
 * retry can re-run them safely.
 */
export async function runPostConfirmationSideEffects(booking: Booking, service: Service): Promise<PostConfirmationResult> {
  const [customerEmail, ownerEmail, google] = await Promise.all([
    sendBookingConfirmationEmail({ booking, service }).catch((err) => ({ sent: false, error: String(err?.message || err) })),
    sendOwnerNotificationEmail({ booking, service }).catch((err) => ({ sent: false, error: String(err?.message || err) })),
    syncGoogleIntegrations(booking, service),
  ]);

  await logIntegration(
    'email',
    booking.id,
    customerEmail.sent ? 'success' : 'failed',
    customerEmail.sent ? 'Customer confirmation email sent' : `Customer email skipped: ${customerEmail.error}`
  );
  await logIntegration(
    'email',
    booking.id,
    ownerEmail.sent ? 'success' : 'failed',
    ownerEmail.sent ? 'Owner notification email sent' : `Owner email skipped: ${ownerEmail.error}`
  );

  return { customerEmail, ownerEmail, calendar: google.calendar, sheets: google.sheets };
}
