import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { bookings, integrationLogs, services } from './db/schema';
import type { Booking, Service } from './db/schema';
import { syncCalendarEvent, type CalendarSyncResult } from './googleCalendar';
import { syncBookingToSheet, type SheetsSyncResult } from './googleSheets';

/**
 * DB side of the Google integrations: serialises concurrent runs for the
 * same booking, persists the resulting IDs, and writes one integration_logs
 * row per attempt. The Google modules themselves stay DB-free.
 *
 * Nothing here throws to the caller and nothing here ever changes a
 * booking's status or payment — an integration failure is only logged.
 */

// Arbitrary constants namespacing our advisory locks (first int of the
// two-int pg_advisory_xact_lock form).
const LOCK_NAMESPACE = { google_calendar: 7301, google_sheets: 7302 } as const;

type IntegrationType = 'email' | 'google_calendar' | 'google_sheets';

export async function logIntegration(
  type: IntegrationType,
  bookingId: string,
  status: 'success' | 'failed',
  message: string,
  details: Record<string, string | number | boolean | null> = {}
) {
  try {
    await db.insert(integrationLogs).values({
      integration_type: type,
      booking_id: bookingId,
      status,
      error_message: status === 'failed' ? message : null,
      response_data: { message, ...details, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error logging integration:', (err as Error)?.message || err);
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` inside a transaction holding a per-booking, per-integration
 * advisory lock. A concurrent caller for the same booking waits until the
 * first one commits, then re-reads the booking and sees its result — so two
 * webhooks/retries racing each other can't both append a sheet row. The
 * lock is released automatically on commit, rollback or a dropped
 * connection.
 */
async function withBookingLock<T>(
  type: keyof typeof LOCK_NAMESPACE,
  bookingUuid: string,
  fn: (tx: Tx, fresh: Booking) => Promise<T>
): Promise<T | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${sql.raw(String(LOCK_NAMESPACE[type]))}, hashtext(${bookingUuid}::text))`
    );
    const fresh = await tx.query.bookings.findFirst({ where: eq(bookings.id, bookingUuid) });
    if (!fresh) return null;
    return fn(tx, fresh);
  });
}

export async function syncCalendarForBooking(booking: Booking, service: Service): Promise<CalendarSyncResult> {
  let result: CalendarSyncResult;
  try {
    result =
      (await withBookingLock('google_calendar', booking.id, async (tx, fresh) => {
        const r = await syncCalendarEvent(fresh, service);
        if (r.eventId && r.eventId !== fresh.google_calendar_event_id) {
          // update-if-null: never overwrite an ID another run already stored.
          await tx
            .update(bookings)
            .set({ google_calendar_event_id: r.eventId })
            .where(and(eq(bookings.id, fresh.id), isNull(bookings.google_calendar_event_id)));
        }
        return r;
      })) ?? { status: 'skipped', eventId: null, message: 'Booking not found' };
  } catch (err) {
    result = { status: 'failed', eventId: null, message: `Calendar sync error: ${(err as Error)?.message || err}` };
  }

  if (result.status !== 'skipped') {
    await logIntegration(
      'google_calendar',
      booking.id,
      result.eventId ? 'success' : 'failed',
      result.message,
      { operation: result.status, eventId: result.eventId }
    );
  }
  return result;
}

export async function syncSheetsForBooking(booking: Booking, service: Service): Promise<SheetsSyncResult> {
  let result: SheetsSyncResult;
  try {
    result =
      (await withBookingLock('google_sheets', booking.id, async (tx, fresh) => {
        const r = await syncBookingToSheet(fresh, service, fresh.google_calendar_event_id);
        if (r.rowId && r.rowId !== fresh.google_sheets_row_id) {
          await tx.update(bookings).set({ google_sheets_row_id: r.rowId }).where(eq(bookings.id, fresh.id));
        }
        return r;
      })) ?? { status: 'skipped', sheetName: null, rowId: null, message: 'Booking not found' };
  } catch (err) {
    result = {
      status: 'failed',
      sheetName: null,
      rowId: null,
      message: `Sheets sync error: ${(err as Error)?.message || err}`,
    };
  }

  if (result.status !== 'skipped') {
    await logIntegration(
      'google_sheets',
      booking.id,
      result.rowId ? 'success' : 'failed',
      result.message,
      { operation: result.status, sheet: result.sheetName, range: result.rowId }
    );
  }
  return result;
}

/**
 * Calendar first (so the sheet row can carry the event ID), then Sheets.
 * Sheets still runs if Calendar failed — the event ID cell just stays empty
 * until a retry fills it in.
 */
export async function syncGoogleIntegrations(booking: Booking, service: Service) {
  const calendar = await syncCalendarForBooking(booking, service);
  const sheets = await syncSheetsForBooking(booking, service);
  return { calendar, sheets };
}

/** Loads booking + service by booking UUID; used by the admin retry. */
export async function loadBookingWithService(bookingUuid: string): Promise<{ booking: Booking; service: Service } | null> {
  const booking = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingUuid) });
  if (!booking) return null;
  const service = await db.query.services.findFirst({ where: eq(services.id, booking.service_id) });
  if (!service) return null;
  return { booking, service };
}
