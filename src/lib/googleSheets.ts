import { google, type sheets_v4 } from 'googleapis';
import type { Booking, Service } from './db/schema';
import { toDateOnly } from './utils';
import { STUDIO_TIMEZONE, getBookingKind } from './bookingKind';
import { describeMissingConfig, getGoogleAuth, getSheetsId, safeGoogleErrorMessage } from './googleAuth';

/**
 * Writes confirmed bookings into the owner's existing "ZAYRO Studios —
 * Bookings & Tours" spreadsheet (GOOGLE_SHEETS_ID). The spreadsheet, its two
 * tabs and their header rows are created by hand; this module only
 * validates them and never creates, renames, clears or reorders anything.
 */

export const PAID_BOOKINGS_SHEET = 'Paid Bookings';
export const STUDIO_TOURS_SHEET = 'Studio Tours';

export const PAID_BOOKINGS_HEADERS = [
  'Created At',
  'Booking ID',
  'Booking Date',
  'Start Time',
  'End Time',
  'Service',
  'Category',
  'Customer First Name',
  'Customer Last Name',
  'Customer Email',
  'Customer Phone',
  'Company',
  'Subtotal',
  'Tax',
  'Total',
  'Payment Status',
  'Stripe Session ID',
  'Stripe Payment ID',
  'Calendar Event ID',
  'Notes',
] as const;

export const STUDIO_TOURS_HEADERS = [
  'Created At',
  'Booking ID',
  'Tour Date',
  'Start Time',
  'End Time',
  'Customer First Name',
  'Customer Last Name',
  'Customer Email',
  'Customer Phone',
  'Company',
  'Calendar Event ID',
  'Status',
  'Notes',
] as const;

export const SHEET_TABS = [
  { sheetName: PAID_BOOKINGS_SHEET, headers: PAID_BOOKINGS_HEADERS },
  { sheetName: STUDIO_TOURS_SHEET, headers: STUDIO_TOURS_HEADERS },
] as const;

/** Booking ID is column B in both tabs; it's the idempotency key. */
const BOOKING_ID_COLUMN = 'B';
/** Upper bound on how many rows a lookup reads (the most recent ones). */
export const MAX_LOOKUP_ROWS = 10000;
const MAX_CELL_TEXT = 5000;

export type SheetTarget = (typeof SHEET_TABS)[number];

export type SheetTargetDecision = { target: SheetTarget } | { target: null; reason: string };

/**
 * Which tab (if any) a booking belongs in:
 * - only confirmed bookings whose payment succeeded (free confirmations are
 *   recorded as succeeded too);
 * - category 'tour' → Studio Tours;
 * - any other service with total > 0 (podcast, photography, …) → Paid Bookings;
 * - monthly packages → nowhere (a package purchase isn't a studio session);
 * - any other $0 service → nowhere. Being free does not make it a tour.
 */
export function getSheetTarget(booking: Booking, service: Service): SheetTargetDecision {
  if (booking.status !== 'confirmed') {
    return { target: null, reason: `Booking is ${booking.status}, not confirmed` };
  }
  if (booking.payment_status !== 'succeeded') {
    return { target: null, reason: `Payment status is ${booking.payment_status}` };
  }
  if (service.category === 'package') {
    return { target: null, reason: 'Monthly package purchases are not studio sessions' };
  }
  const kind = getBookingKind(booking, service);
  if (kind === 'tour') return { target: SHEET_TABS[1] };
  if (kind === 'paid') return { target: SHEET_TABS[0] };
  return { target: null, reason: 'Free non-tour services are not recorded in Sheets' };
}

// ----------------------------------------------------------------------
// Cell formatting
// ----------------------------------------------------------------------

/**
 * Cells are written with valueInputOption USER_ENTERED so dates, times and
 * numbers become real Sheets values. Every free-text value is therefore
 * forced to plain text with a leading apostrophe (Sheets' own "treat as
 * text" prefix, which is not shown or stored as part of the value). That
 * neutralises formula injection (=, +, -, @) and keeps phone numbers,
 * booking IDs etc. from being coerced into numbers or dates.
 */
export function textCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' || typeof value === 'function') return '';
  let text = String(value)
    .replace(/\r\n?/g, '\n')
    // Drop control characters except newline and tab.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim();
  if (!text) return '';
  if (text.length > MAX_CELL_TEXT) text = `${text.slice(0, MAX_CELL_TEXT)}…`;
  return `'${text}`;
}

export function moneyCell(value: string | number | null | undefined): number | string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : '';
}

export function timeCell(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

export function dateCell(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = toDateOnly(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

/** "YYYY-MM-DD HH:mm:ss" in studio local time — parsed by Sheets as a date-time. */
export function timestampCell(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: STUDIO_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export type CellValue = string | number;

export function buildPaidBookingRow(booking: Booking, service: Service, calendarEventId: string | null): CellValue[] {
  return [
    timestampCell(booking.created_at),
    textCell(booking.booking_id),
    dateCell(booking.booking_date),
    timeCell(booking.start_time),
    timeCell(booking.end_time),
    textCell(service.name),
    textCell(service.category),
    textCell(booking.customer_first_name),
    textCell(booking.customer_last_name),
    textCell(booking.customer_email),
    textCell(booking.customer_phone),
    textCell(booking.company_name),
    moneyCell(booking.subtotal),
    moneyCell(booking.tax_amount),
    moneyCell(booking.total_amount),
    textCell(booking.payment_status),
    textCell(booking.stripe_session_id),
    textCell(booking.stripe_payment_id),
    textCell(calendarEventId),
    textCell(booking.notes),
  ];
}

export function buildStudioTourRow(booking: Booking, calendarEventId: string | null): CellValue[] {
  return [
    timestampCell(booking.created_at),
    textCell(booking.booking_id),
    dateCell(booking.booking_date),
    timeCell(booking.start_time),
    timeCell(booking.end_time),
    textCell(booking.customer_first_name),
    textCell(booking.customer_last_name),
    textCell(booking.customer_email),
    textCell(booking.customer_phone),
    textCell(booking.company_name),
    textCell(calendarEventId),
    textCell(booking.status),
    textCell(booking.notes),
  ];
}

// ----------------------------------------------------------------------
// A1 helpers
// ----------------------------------------------------------------------

function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function lastColumn(target: SheetTarget): string {
  return columnLetter(target.headers.length - 1);
}

export function rowRange(target: SheetTarget, row: number): string {
  return `${quoteSheet(target.sheetName)}!A${row}:${lastColumn(target)}${row}`;
}

/** Stable, human-readable value stored in bookings.google_sheets_row_id. */
export function formatRowId(target: SheetTarget, row: number): string {
  return `${target.sheetName}!A${row}:${lastColumn(target)}${row}`;
}

/** Parses "Paid Bookings!A14:T14" or "'Paid Bookings'!A14:T14". */
export function parseRowId(rowId: string | null | undefined): { sheetName: string; row: number } | null {
  if (!rowId) return null;
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))!A(\d+)(?::[A-Z]+\d+)?$/.exec(rowId.trim());
  if (!m) return null;
  const sheetName = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2];
  const row = parseInt(m[3], 10);
  return row >= 1 ? { sheetName, row } : null;
}

// ----------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------

export class SheetsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetsValidationError';
  }
}

export function compareHeaders(expected: readonly string[], actual: unknown[] | undefined): string | null {
  const row = (actual || []).map((v) => String(v ?? '').trim());
  for (let i = 0; i < expected.length; i++) {
    if ((row[i] || '') !== expected[i]) {
      return `column ${columnLetter(i)} should be "${expected[i]}" but is ${row[i] ? `"${row[i]}"` : 'empty'}`;
    }
  }
  return null;
}

/**
 * Checks the tab exists and its header row matches exactly. Returns the
 * tab's row count (used to bound lookups). Throws SheetsValidationError with
 * a message the owner can act on; never modifies the sheet.
 */
export async function validateSheetTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  target: SheetTarget
): Promise<{ rowCount: number }> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(title,gridProperties.rowCount)',
  });
  const tab = meta.data.sheets?.find((s) => s.properties?.title === target.sheetName);
  if (!tab) {
    throw new SheetsValidationError(`Tab "${target.sheetName}" was not found in the spreadsheet (names must match exactly)`);
  }

  const header = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheet(target.sheetName)}!A1:${lastColumn(target)}1`,
  });
  const problem = compareHeaders(target.headers, header.data.values?.[0]);
  if (problem) {
    throw new SheetsValidationError(`Header row of "${target.sheetName}" is wrong: ${problem}`);
  }

  return { rowCount: tab.properties?.gridProperties?.rowCount || 1000 };
}

// ----------------------------------------------------------------------
// Sync
// ----------------------------------------------------------------------

export type SheetsSyncResult =
  | { status: 'appended' | 'updated'; sheetName: string; rowId: string; message: string }
  | { status: 'skipped' | 'not_configured' | 'failed'; sheetName: string | null; rowId: null; message: string };

export function getSheetsClient(): sheets_v4.Sheets {
  return google.sheets({ version: 'v4', auth: getGoogleAuth() });
}

async function readBookingIdAt(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  target: SheetTarget,
  row: number
): Promise<string> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheet(target.sheetName)}!${BOOKING_ID_COLUMN}${row}`,
  });
  return String(res.data.values?.[0]?.[0] ?? '').trim();
}

/** Bounded search of the Booking ID column over the most recent rows. */
export async function findBookingRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  target: SheetTarget,
  bookingId: string,
  rowCount: number
): Promise<number | null> {
  if (rowCount < 2) return null;
  const first = Math.max(2, rowCount - MAX_LOOKUP_ROWS + 1);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheet(target.sheetName)}!${BOOKING_ID_COLUMN}${first}:${BOOKING_ID_COLUMN}${rowCount}`,
    majorDimension: 'COLUMNS',
  });
  const column = res.data.values?.[0] || [];
  const index = column.findIndex((v) => String(v ?? '').trim() === bookingId);
  return index === -1 ? null : first + index;
}

function rowNumberFromUpdatedRange(updatedRange: string | null | undefined): number | null {
  const m = /!\$?[A-Z]*\$?(\d+)/.exec(updatedRange || '');
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Upserts the booking's row. Order of checks:
 * 1. the row stored in booking.google_sheets_row_id, if it still holds this
 *    booking's ID → update it in place;
 * 2. a bounded lookup of the Booking ID column → update the match;
 * 3. otherwise append a new row.
 * Callers must serialise concurrent calls for the same booking (see
 * integrationSync.ts); this function itself never throws.
 */
export async function syncBookingToSheet(
  booking: Booking,
  service: Service,
  calendarEventId: string | null,
  options: { sheets?: sheets_v4.Sheets } = {}
): Promise<SheetsSyncResult> {
  const decision = getSheetTarget(booking, service);
  if (!decision.target) {
    return { status: 'skipped', sheetName: null, rowId: null, message: decision.reason };
  }
  const target = decision.target;

  const missing = options.sheets ? null : describeMissingConfig('sheets');
  if (missing) {
    return { status: 'not_configured', sheetName: target.sheetName, rowId: null, message: missing };
  }

  try {
    const sheets = options.sheets ?? getSheetsClient();
    const spreadsheetId = getSheetsId();
    const { rowCount } = await validateSheetTab(sheets, spreadsheetId, target);

    const values =
      target.sheetName === PAID_BOOKINGS_SHEET
        ? buildPaidBookingRow(booking, service, calendarEventId)
        : buildStudioTourRow(booking, calendarEventId);

    let row: number | null = null;
    const stored = parseRowId(booking.google_sheets_row_id);
    if (stored && stored.sheetName === target.sheetName && stored.row >= 2) {
      const idAtRow = await readBookingIdAt(sheets, spreadsheetId, target, stored.row);
      if (idAtRow === booking.booking_id) row = stored.row;
    }
    if (row === null) {
      row = await findBookingRow(sheets, spreadsheetId, target, booking.booking_id, rowCount);
    }

    if (row !== null) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: rowRange(target, row),
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [values] },
      });
      return {
        status: 'updated',
        sheetName: target.sheetName,
        rowId: formatRowId(target, row),
        message: `Updated existing row ${row} in "${target.sheetName}"`,
      };
    }

    const appended = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${quoteSheet(target.sheetName)}!A1:${lastColumn(target)}1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    });
    const newRow = rowNumberFromUpdatedRange(appended.data.updates?.updatedRange);
    if (!newRow) {
      throw new Error('Sheets append succeeded but returned no row range');
    }
    return {
      status: 'appended',
      sheetName: target.sheetName,
      rowId: formatRowId(target, newRow),
      message: `Appended row ${newRow} to "${target.sheetName}"`,
    };
  } catch (error) {
    const message = error instanceof SheetsValidationError ? error.message : safeGoogleErrorMessage(error);
    console.error(`Google Sheets sync failed for booking ${booking.booking_id}: ${message}`);
    return { status: 'failed', sheetName: target.sheetName, rowId: null, message };
  }
}

export type SheetsCancelResult =
  | { status: 'updated'; rowId: string; message: string }
  | { status: 'skipped' | 'not_configured' | 'failed'; rowId: null; message: string };

/**
 * Reflects a cancellation in the booking's existing row: Studio Tours gets
 * Status = "cancelled", Paid Bookings (which has no status column) gets a
 * "CANCELLED …" prefix in Notes. Payment columns are left as they are —
 * a cancellation is not a refund. Only ever updates a row that still holds
 * this booking's ID; never appends or deletes. Never throws.
 */
export async function markBookingCancelledInSheet(
  booking: Booking,
  service: Service,
  options: { sheets?: sheets_v4.Sheets; now?: Date } = {}
): Promise<SheetsCancelResult> {
  if (booking.status !== 'cancelled') {
    return { status: 'skipped', rowId: null, message: `Booking is ${booking.status}, not cancelled` };
  }
  const stored = parseRowId(booking.google_sheets_row_id);
  const target = SHEET_TABS.find((t) => t.sheetName === stored?.sheetName);
  if (!stored || !target || stored.row < 2) {
    return { status: 'skipped', rowId: null, message: 'Booking has no sheet row' };
  }

  const missing = options.sheets ? null : describeMissingConfig('sheets');
  if (missing) return { status: 'not_configured', rowId: null, message: missing };

  try {
    const sheets = options.sheets ?? getSheetsClient();
    const spreadsheetId = getSheetsId();
    const { rowCount } = await validateSheetTab(sheets, spreadsheetId, target);

    let row: number | null = null;
    if ((await readBookingIdAt(sheets, spreadsheetId, target, stored.row)) === booking.booking_id) {
      row = stored.row;
    } else {
      row = await findBookingRow(sheets, spreadsheetId, target, booking.booking_id, rowCount);
    }
    if (row === null) {
      return { status: 'skipped', rowId: null, message: `Row for ${booking.booking_id} not found in "${target.sheetName}"` };
    }

    const when = (options.now ?? new Date()).toISOString().slice(0, 10);
    const values =
      target.sheetName === PAID_BOOKINGS_SHEET
        ? buildPaidBookingRow(
            { ...booking, notes: `CANCELLED ${when}${booking.notes ? ` — ${booking.notes}` : ''}` },
            service,
            booking.google_calendar_event_id
          )
        : buildStudioTourRow(booking, booking.google_calendar_event_id);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: rowRange(target, row),
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
    return {
      status: 'updated',
      rowId: formatRowId(target, row),
      message: `Marked row ${row} in "${target.sheetName}" as cancelled`,
    };
  } catch (error) {
    const message = error instanceof SheetsValidationError ? error.message : safeGoogleErrorMessage(error);
    console.error(`Google Sheets cancel-marking failed for booking ${booking.booking_id}: ${message}`);
    return { status: 'failed', rowId: null, message };
  }
}

/** Read-only check of both tabs and header rows for admin diagnostics. */
export async function checkSheetsConnection(): Promise<{ ok: boolean; message: string; tabs: { sheetName: string; ok: boolean; message: string }[] }> {
  const missing = describeMissingConfig('sheets');
  if (missing) return { ok: false, message: missing, tabs: [] };
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetsId();
    const tabs = [];
    for (const target of SHEET_TABS) {
      try {
        await validateSheetTab(sheets, spreadsheetId, target);
        tabs.push({ sheetName: target.sheetName, ok: true, message: 'Tab and headers OK' });
      } catch (error) {
        const message = error instanceof SheetsValidationError ? error.message : safeGoogleErrorMessage(error);
        tabs.push({ sheetName: target.sheetName, ok: false, message });
      }
    }
    const ok = tabs.every((t) => t.ok);
    return { ok, message: ok ? 'Connected; both tabs valid' : 'Connected, but a tab needs attention', tabs };
  } catch (error) {
    return { ok: false, message: safeGoogleErrorMessage(error), tabs: [] };
  }
}
