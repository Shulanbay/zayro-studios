/**
 * In-memory stand-ins for the parts of the Google Calendar / Sheets APIs
 * the integration uses, plus booking/service factories. Test-only.
 */
import type { Booking, Service } from '@/lib/db/schema';
import { PAID_BOOKINGS_HEADERS, STUDIO_TOURS_HEADERS } from '@/lib/googleSheets';

export function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    booking_id: 'ZAY-TEST00000001',
    customer_id: '99999999-2222-4333-8444-555555555555',
    service_id: 1,
    booking_date: '2026-11-01',
    start_time: '14:00',
    end_time: '15:00',
    duration_minutes: 60,
    customer_first_name: 'Ada',
    customer_last_name: 'Lovelace',
    customer_email: 'ada@example.com',
    customer_phone: '+1 212 555 0100',
    company_name: 'Analytical Engines',
    notes: null,
    status: 'confirmed',
    subtotal: '170.00',
    tax_amount: '14.66',
    total_amount: '184.66',
    payment_status: 'succeeded',
    stripe_payment_id: 'pi_test_123',
    stripe_session_id: 'cs_test_123',
    google_calendar_event_id: null,
    google_sheets_row_id: null,
    created_at: new Date('2026-10-20T18:05:09Z'),
    updated_at: new Date('2026-10-20T18:05:09Z'),
    ...overrides,
  };
}

export function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: 1,
    name: 'Single Podcaster',
    description: null,
    base_price: '170.00',
    duration_minutes: 60,
    category: 'podcast',
    features: [],
    is_active: true,
    display_order: 0,
    is_featured: false,
    badge: null,
    session_count: null,
    validity_days: null,
    package_type: null,
    package_base_service_id: null,
    created_at: new Date('2026-09-01T00:00:00Z'),
    updated_at: null,
    ...overrides,
  };
}

export const tourService = () =>
  makeService({ id: 7, name: 'Free Studio Tour', base_price: '0.00', duration_minutes: 30, category: 'tour' });

export function apiError(status: number, message: string) {
  const err: any = new Error(message);
  err.code = status;
  err.response = { status, data: { error: { message } } };
  return err;
}

// ----------------------------------------------------------------------
// Calendar
// ----------------------------------------------------------------------

export class FakeCalendar {
  store = new Map<string, any>();
  insertCalls = 0;
  failWith: Error | null = null;

  events = {
    insert: async ({ requestBody }: any) => {
      this.insertCalls++;
      if (this.failWith) throw this.failWith;
      await tick();
      if (this.store.has(requestBody.id)) throw apiError(409, 'The requested identifier already exists.');
      const event = { ...requestBody, status: 'confirmed' };
      this.store.set(requestBody.id, event);
      return { data: event };
    },
    get: async ({ eventId }: any) => {
      const event = this.store.get(eventId);
      if (!event) throw apiError(404, 'Not Found');
      return { data: event };
    },
  };

  calendars = {
    get: async () => ({ data: { timeZone: 'America/New_York' } }),
  };
}

// ----------------------------------------------------------------------
// Sheets
// ----------------------------------------------------------------------

type Cell = string | number;

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseRange(range: string) {
  const m = /^'((?:[^']|'')+)'!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range);
  if (!m) throw new Error(`FakeSheets: unsupported range ${range}`);
  return {
    tab: m[1].replace(/''/g, "'"),
    c1: colIndex(m[2]),
    r1: parseInt(m[3], 10),
    c2: colIndex(m[4] || m[2]),
    r2: parseInt(m[5] || m[3], 10),
  };
}

/** USER_ENTERED: a leading apostrophe marks text and isn't stored. */
function stored(value: Cell): Cell {
  return typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value;
}

export class FakeSheets {
  tabs: Record<string, { rows: Cell[][]; rowCount: number }> = {};
  calls: { method: string; range: string }[] = [];
  failWith: Error | null = null;

  constructor(options: { paidHeaders?: string[]; tourHeaders?: string[]; omitTab?: string } = {}) {
    const paid = options.paidHeaders ?? [...PAID_BOOKINGS_HEADERS];
    const tour = options.tourHeaders ?? [...STUDIO_TOURS_HEADERS];
    if (options.omitTab !== 'Paid Bookings') this.tabs['Paid Bookings'] = { rows: [paid], rowCount: 1000 };
    if (options.omitTab !== 'Studio Tours') this.tabs['Studio Tours'] = { rows: [tour], rowCount: 1000 };
  }

  dataRows(tab: string): Cell[][] {
    return this.tabs[tab].rows.slice(1).filter((r) => r && r.some((c) => c !== '' && c !== undefined));
  }

  private tab(name: string) {
    const t = this.tabs[name];
    if (!t) throw apiError(400, `Unable to parse range: ${name}`);
    return t;
  }

  spreadsheets = {
    get: async () => {
      if (this.failWith) throw this.failWith;
      return {
        data: {
          sheets: Object.entries(this.tabs).map(([title, t]) => ({
            properties: { title, gridProperties: { rowCount: t.rowCount } },
          })),
        },
      };
    },
    values: {
      get: async ({ range, majorDimension }: any) => {
        this.calls.push({ method: 'get', range });
        const r = parseRange(range);
        const t = this.tab(r.tab);
        const out: Cell[][] = [];
        for (let row = r.r1; row <= r.r2; row++) {
          const src = t.rows[row - 1] || [];
          out.push(src.slice(r.c1, r.c2 + 1).map((c) => c ?? ''));
        }
        if (majorDimension === 'COLUMNS') {
          return { data: { values: [out.map((row) => row[0] ?? '')] } };
        }
        return { data: { values: out } };
      },
      update: async ({ range, requestBody }: any) => {
        this.calls.push({ method: 'update', range });
        const r = parseRange(range);
        const t = this.tab(r.tab);
        t.rows[r.r1 - 1] = requestBody.values[0].map(stored);
        return { data: { updatedRange: range } };
      },
      append: async ({ range, requestBody }: any) => {
        this.calls.push({ method: 'append', range });
        await tick();
        const r = parseRange(range);
        const t = this.tab(r.tab);
        let last = t.rows.length;
        while (last > 0 && !(t.rows[last - 1] || []).some((c) => c !== '' && c !== undefined)) last--;
        const rowNumber = last + 1;
        t.rows[rowNumber - 1] = requestBody.values[0].map(stored);
        const width = requestBody.values[0].length;
        const lastCol = String.fromCharCode(64 + width);
        return { data: { updates: { updatedRange: `'${r.tab}'!A${rowNumber}:${lastCol}${rowNumber}` } } };
      },
    },
  };
}

/** Yields to the event loop so concurrent calls can interleave. */
export function tick() {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

export const FAKE_PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n';

export function setGoogleEnv() {
  process.env.GOOGLE_CALENDAR_EMAIL = 'zayro-booking-integration@example-project.iam.gserviceaccount.com';
  process.env.GOOGLE_CALENDAR_PRIVATE_KEY = FAKE_PEM.replace(/\n/g, '\\n');
  process.env.GOOGLE_CALENDAR_ID = 'studio-calendar@group.calendar.google.com';
  process.env.GOOGLE_SHEETS_ID = 'fake-spreadsheet-id';
}

export function clearGoogleEnv() {
  for (const k of [
    'GOOGLE_CALENDAR_EMAIL',
    'GOOGLE_CALENDAR_PRIVATE_KEY',
    'GOOGLE_CALENDAR_ID',
    'GOOGLE_SHEETS_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  ]) {
    delete process.env[k];
  }
}
