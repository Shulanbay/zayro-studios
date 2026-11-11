import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { bookingExtensions, bookings, integrationLogs, purchases, services } from './db/schema';
import type { Booking, Service } from './db/schema';
import { syncCalendarEvent, updateCalendarEvent, type CalendarSyncResult, type CalendarUpdateResult } from './googleCalendar';
import { syncBookingToSheet, type SheetExtras, type SheetsSyncResult } from './googleSheets';
import type { Executor } from './db/types';

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

type IntegrationType = 'stripe' | 'email' | 'google_calendar' | 'google_sheets' | 'admin';

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

const COLLECTED = ['paid', 'partially_refunded', 'refunded'];

/**
 * What the optional Paid Bookings columns show, from the database (the
 * source of truth): net money collected (paid − refunded) on the booking's
 * own purchase and on each extra-time purchase. Pending, failed and
 * cancelled payments count as nothing. Re-computed in full on every sync,
 * so repeating a sync never adds anything twice. Returns null when it can't
 * be computed — the sheet then leaves those cells empty instead of guessing.
 */
export async function sheetExtrasFor(booking: Booking, exec: Executor = db): Promise<SheetExtras | null> {
  try {
    const exts = await exec.query.bookingExtensions.findMany({ where: eq(bookingExtensions.booking_id, booking.id) });
    const ids = [...(booking.purchase_id ? [booking.purchase_id] : []), ...exts.map((e) => e.purchase_id)];
    const rows = ids.length ? await exec.query.purchases.findMany({ where: inArray(purchases.id, ids) }) : [];
    const net = (p: (typeof rows)[number]) => (COLLECTED.includes(p.status) ? Math.max(0, p.total_cents - p.refunded_cents) : 0);
    const extIds = new Set(exts.map((e) => e.purchase_id));
    const extensionNetCents = rows.filter((p) => extIds.has(p.id)).reduce((n, p) => n + net(p), 0);
    const own = booking.purchase_id ? rows.find((p) => p.id === booking.purchase_id) : undefined;
    // Bookings from before the CRM have no purchase row: their own payment is the booking total.
    const ownNet = own ? net(own) : booking.payment_status === 'succeeded' ? Math.round(parseFloat(booking.total_amount) * 100) : 0;
    return { extensionNetCents, totalPaidNetCents: ownNet + extensionNetCents };
  } catch (error) {
    console.error('[sheets] could not compute paid totals:', (error as Error)?.message || error);
    return null;
  }
}

/**
 * Runs `fn` inside a transaction holding a per-booking, per-integration
 * advisory lock. A concurrent caller for the same booking waits until the
 * first one commits, then re-reads the booking and sees its result — so two
 * webhooks/retries racing each other can't both append a sheet row. The
 * lock is released automatically on commit, rollback or a dropped
 * connection.
 */
export async function withBookingLock<T>(
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
        const r = await syncBookingToSheet(fresh, service, fresh.google_calendar_event_id, { extras: await sheetExtrasFor(fresh, tx) });
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

/**
 * After a reschedule / service change: patch the booking's event in place
 * (or create it if it never got one), then update the sheet row in place.
 */
export async function resyncGoogleAfterChange(booking: Booking, service: Service) {
  let calendar: CalendarUpdateResult;
  try {
    calendar =
      (await withBookingLock('google_calendar', booking.id, async (tx, fresh) => {
        const r = await updateCalendarEvent(fresh, service);
        if (r.eventId && r.eventId !== fresh.google_calendar_event_id) {
          await tx
            .update(bookings)
            .set({ google_calendar_event_id: r.eventId })
            .where(and(eq(bookings.id, fresh.id), isNull(bookings.google_calendar_event_id)));
        }
        return r;
      })) ?? { status: 'skipped', eventId: null, message: 'Booking not found' };
  } catch (err) {
    calendar = { status: 'failed', eventId: null, message: `Calendar update error: ${(err as Error)?.message || err}` };
  }
  if (calendar.status !== 'skipped') {
    await logIntegration('google_calendar', booking.id, calendar.eventId ? 'success' : 'failed', calendar.message, {
      operation: `update_${calendar.status}`,
      eventId: calendar.eventId,
    });
  }
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
