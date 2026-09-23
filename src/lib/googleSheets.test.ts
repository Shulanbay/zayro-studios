import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getSheetTarget,
  textCell,
  moneyCell,
  timeCell,
  dateCell,
  timestampCell,
  buildPaidBookingRow,
  buildStudioTourRow,
  parseRowId,
  formatRowId,
  compareHeaders,
  syncBookingToSheet,
  findBookingRow,
  SHEET_TABS,
  PAID_BOOKINGS_HEADERS,
  STUDIO_TOURS_HEADERS,
  MAX_LOOKUP_ROWS,
} from './googleSheets';
import { FakeSheets, apiError, clearGoogleEnv, makeBooking, makeService, setGoogleEnv, tourService } from '@/test/fakeGoogle';

const free = { subtotal: '0.00', tax_amount: '0.00', total_amount: '0.00' };

describe('getSheetTarget', () => {
  it('maps a confirmed, paid booking to Paid Bookings', () => {
    expect(getSheetTarget(makeBooking(), makeService()).target?.sheetName).toBe('Paid Bookings');
  });

  it('maps a tour-category booking to Studio Tours', () => {
    expect(getSheetTarget(makeBooking(free), tourService()).target?.sheetName).toBe('Studio Tours');
  });

  it('does not treat an ordinary free service as a tour', () => {
    const d = getSheetTarget(makeBooking(free), makeService({ base_price: '0.00', category: 'podcast' }));
    expect(d.target).toBeNull();
  });

  it('skips pending, payment_pending and failed payments', () => {
    expect(getSheetTarget(makeBooking({ status: 'payment_pending', payment_status: 'pending' }), makeService()).target).toBeNull();
    expect(getSheetTarget(makeBooking({ status: 'pending' }), makeService()).target).toBeNull();
    expect(getSheetTarget(makeBooking({ payment_status: 'failed' }), makeService()).target).toBeNull();
    expect(getSheetTarget(makeBooking({ payment_status: 'pending' }), makeService()).target).toBeNull();
    expect(getSheetTarget(makeBooking({ status: 'cancelled' }), makeService()).target).toBeNull();
  });
});

describe('cell formatting', () => {
  it('forces user text to plain text, neutralising formulas', () => {
    for (const evil of ['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)']) {
      expect(textCell(evil)).toBe(`'${evil}`);
    }
    expect(textCell('plain')).toBe("'plain");
  });

  it('renders empty/undefined/objects as empty cells, never "undefined" or [object Object]', () => {
    expect(textCell(null)).toBe('');
    expect(textCell(undefined)).toBe('');
    expect(textCell('   ')).toBe('');
    expect(textCell({ a: 1 })).toBe('');
  });

  it('keeps newlines in notes but strips other control characters', () => {
    expect(textCell('line 1\r\nline 2\u0007')).toBe("'line 1\nline 2");
  });

  it('formats money as numbers, time as HH:mm, dates as ISO', () => {
    expect(moneyCell('184.66')).toBe(184.66);
    expect(moneyCell('0.00')).toBe(0);
    expect(moneyCell(null)).toBe('');
    expect(timeCell('9:05')).toBe('09:05');
    expect(timeCell('14:00:00')).toBe('14:00');
    expect(dateCell('2026-11-01')).toBe('2026-11-01');
    expect(dateCell(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01');
    expect(dateCell('2026-11-01T00:00:00.000Z')).toBe('2026-11-01');
  });

  it('formats Created At in New York time', () => {
    expect(timestampCell(new Date('2026-10-20T18:05:09Z'))).toBe('2026-10-20 14:05:09');
    expect(timestampCell(new Date('2026-01-15T05:00:00Z'))).toBe('2026-01-15 00:00:00');
  });

  it('builds a Paid Bookings row matching the header order', () => {
    const row = buildPaidBookingRow(makeBooking({ notes: '=cmd' }), makeService(), 'evt1');
    expect(row).toHaveLength(PAID_BOOKINGS_HEADERS.length);
    const byHeader = Object.fromEntries(PAID_BOOKINGS_HEADERS.map((h, i) => [h, row[i]]));
    expect(byHeader).toMatchObject({
      'Created At': '2026-10-20 14:05:09',
      'Booking ID': "'ZAY-TEST00000001",
      'Booking Date': '2026-11-01',
      'Start Time': '14:00',
      'End Time': '15:00',
      Service: "'Single Podcaster",
      Category: "'podcast",
      'Customer Email': "'ada@example.com",
      'Customer Phone': "'+1 212 555 0100",
      Subtotal: 170,
      Tax: 14.66,
      Total: 184.66,
      'Payment Status': "'succeeded",
      'Stripe Session ID': "'cs_test_123",
      'Stripe Payment ID': "'pi_test_123",
      'Calendar Event ID': "'evt1",
      Notes: "'=cmd",
    });
    for (const cell of row) {
      expect(cell).not.toBeUndefined();
      expect(String(cell)).not.toContain('[object');
      expect(String(cell)).not.toBe('undefined');
    }
  });

  it('builds a Studio Tours row matching the header order', () => {
    const row = buildStudioTourRow(makeBooking({ ...free, company_name: null }), null);
    expect(row).toHaveLength(STUDIO_TOURS_HEADERS.length);
    const byHeader = Object.fromEntries(STUDIO_TOURS_HEADERS.map((h, i) => [h, row[i]]));
    expect(byHeader).toMatchObject({ 'Tour Date': '2026-11-01', Company: '', 'Calendar Event ID': '', Status: "'confirmed" });
  });
});

describe('row ids and headers', () => {
  it('round-trips the stored row id', () => {
    const id = formatRowId(SHEET_TABS[0], 14);
    expect(id).toBe('Paid Bookings!A14:T14');
    expect(parseRowId(id)).toEqual({ sheetName: 'Paid Bookings', row: 14 });
    expect(parseRowId("'Studio Tours'!A3:M3")).toEqual({ sheetName: 'Studio Tours', row: 3 });
    expect(parseRowId('garbage')).toBeNull();
    expect(parseRowId(null)).toBeNull();
  });

  it('describes the first header mismatch', () => {
    expect(compareHeaders(PAID_BOOKINGS_HEADERS, [...PAID_BOOKINGS_HEADERS])).toBeNull();
    const wrong: string[] = [...PAID_BOOKINGS_HEADERS];
    wrong[2] = 'Date';
    expect(compareHeaders(PAID_BOOKINGS_HEADERS, wrong)).toBe('column C should be "Booking Date" but is "Date"');
    expect(compareHeaders(PAID_BOOKINGS_HEADERS, PAID_BOOKINGS_HEADERS.slice(0, 5))).toMatch(/column F .* empty/);
  });
});

describe('syncBookingToSheet', () => {
  let sheets: FakeSheets;
  beforeEach(() => {
    setGoogleEnv();
    sheets = new FakeSheets();
  });
  afterEach(() => clearGoogleEnv());

  const opts = () => ({ sheets: sheets as any });

  it('appends a paid booking to Paid Bookings and returns its row id', async () => {
    const r = await syncBookingToSheet(makeBooking(), makeService(), 'evt1', opts());
    expect(r).toMatchObject({ status: 'appended', sheetName: 'Paid Bookings', rowId: 'Paid Bookings!A2:T2' });
    expect(sheets.dataRows('Paid Bookings')).toHaveLength(1);
    expect(sheets.dataRows('Paid Bookings')[0][1]).toBe('ZAY-TEST00000001');
    expect(sheets.dataRows('Studio Tours')).toHaveLength(0);
  });

  it('appends a tour only to Studio Tours', async () => {
    const r = await syncBookingToSheet(makeBooking(free), tourService(), null, opts());
    expect(r).toMatchObject({ status: 'appended', sheetName: 'Studio Tours', rowId: 'Studio Tours!A2:M2' });
    expect(sheets.dataRows('Paid Bookings')).toHaveLength(0);
  });

  it('does not write an ordinary free booking or an unpaid booking anywhere', async () => {
    const a = await syncBookingToSheet(makeBooking(free), makeService({ base_price: '0.00' }), null, opts());
    const b = await syncBookingToSheet(makeBooking({ status: 'payment_pending', payment_status: 'pending' }), makeService(), null, opts());
    const c = await syncBookingToSheet(makeBooking({ payment_status: 'failed' }), makeService(), null, opts());
    expect([a.status, b.status, c.status]).toEqual(['skipped', 'skipped', 'skipped']);
    expect(sheets.calls).toHaveLength(0);
  });

  it('updates the stored row in place instead of appending again', async () => {
    const first = await syncBookingToSheet(makeBooking(), makeService(), null, opts());
    const again = await syncBookingToSheet(makeBooking({ google_sheets_row_id: first.rowId }), makeService(), 'evt-later', opts());
    expect(again).toMatchObject({ status: 'updated', rowId: first.rowId });
    expect(sheets.dataRows('Paid Bookings')).toHaveLength(1);
    expect(sheets.dataRows('Paid Bookings')[0][18]).toBe('evt-later');
    expect(sheets.calls.filter((c) => c.method === 'append')).toHaveLength(1);
  });

  it('finds the existing row by Booking ID when the row id was never saved (repeated webhook)', async () => {
    await syncBookingToSheet(makeBooking(), makeService(), null, opts());
    const again = await syncBookingToSheet(makeBooking(), makeService(), null, opts());
    expect(again.status).toBe('updated');
    expect(sheets.dataRows('Paid Bookings')).toHaveLength(1);
  });

  it('falls back to lookup when the stored row now holds another booking (rows were re-sorted)', async () => {
    await syncBookingToSheet(makeBooking({ booking_id: 'ZAY-OTHER' }), makeService(), null, opts());
    await syncBookingToSheet(makeBooking(), makeService(), null, opts()); // row 3
    const r = await syncBookingToSheet(
      makeBooking({ google_sheets_row_id: 'Paid Bookings!A2:T2' }),
      makeService(),
      null,
      opts()
    );
    expect(r).toMatchObject({ status: 'updated', rowId: 'Paid Bookings!A3:T3' });
    expect(sheets.dataRows('Paid Bookings')).toHaveLength(2);
    expect(sheets.dataRows('Paid Bookings')[0][1]).toBe('ZAY-OTHER');
  });

  it('bounds the lookup range to the most recent MAX_LOOKUP_ROWS rows', async () => {
    const calls: string[] = [];
    const fake = {
      spreadsheets: { values: { get: async ({ range }: any) => (calls.push(range), { data: { values: [[]] } }) } },
    };
    await findBookingRow(fake as any, 'id', SHEET_TABS[0], 'ZAY-X', 50000);
    expect(calls[0]).toBe(`'Paid Bookings'!B${50000 - MAX_LOOKUP_ROWS + 1}:B50000`);
  });

  it('fails with a clear message (and writes nothing) when headers are wrong', async () => {
    const headers: string[] = [...PAID_BOOKINGS_HEADERS];
    headers[0] = 'Timestamp';
    sheets = new FakeSheets({ paidHeaders: headers });
    const r = await syncBookingToSheet(makeBooking(), makeService(), null, opts());
    expect(r.status).toBe('failed');
    expect(r.message).toBe('Header row of "Paid Bookings" is wrong: column A should be "Created At" but is "Timestamp"');
    expect(sheets.calls.some((c) => c.method !== 'get')).toBe(false);
  });

  it('fails clearly when a tab is missing', async () => {
    sheets = new FakeSheets({ omitTab: 'Studio Tours' });
    const r = await syncBookingToSheet(makeBooking(free), tourService(), null, opts());
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/Tab "Studio Tours" was not found/);
  });

  it('returns failed (never throws) on an API error', async () => {
    sheets.failWith = apiError(403, 'The caller does not have permission');
    const r = await syncBookingToSheet(makeBooking(), makeService(), null, opts());
    expect(r).toMatchObject({ status: 'failed', rowId: null });
    expect(r.message).toContain('does not have permission');
  });

  it('reports not_configured when GOOGLE_SHEETS_ID is missing', async () => {
    delete process.env.GOOGLE_SHEETS_ID;
    const r = await syncBookingToSheet(makeBooking(), makeService(), null);
    expect(r.status).toBe('not_configured');
    expect(r.message).toMatch(/GOOGLE_SHEETS_ID/);
  });
});
