import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeCalendar, FakeSheets, apiError, clearGoogleEnv, makeBooking, makeService, setGoogleEnv, tourService } from '@/test/fakeGoogle';
import type { FakeDb } from '@/test/fakeDb';
import type { Booking, Service } from '@/lib/db/schema';

const google = vi.hoisted(() => ({ calendar: null as any, sheets: null as any }));
const admin = vi.hoisted(() => ({ session: null as { email: string } | null }));

vi.mock('@/lib/db', async () => {
  const { createFakeDb } = await import('@/test/fakeDb');
  return { db: createFakeDb() };
});

vi.mock('googleapis', () => ({
  google: {
    calendar: () => google.calendar,
    sheets: () => google.sheets,
    auth: {
      JWT: class {
        scopes: string[];
        constructor(opts: { scopes: string[] }) {
          this.scopes = opts.scopes;
        }
      },
    },
  },
}));

vi.mock('@/lib/email', () => ({
  sendBookingConfirmationEmail: vi.fn(async () => ({ sent: true })),
  sendOwnerNotificationEmail: vi.fn(async () => ({ sent: true })),
}));

vi.mock('@/lib/adminAuth', () => ({ getAdminSession: () => admin.session }));

const { db } = (await import('@/lib/db')) as unknown as { db: FakeDb };
const { runPostConfirmationSideEffects } = await import('./postConfirmation');
const { syncGoogleIntegrations } = await import('./integrationSync');
const { calendarEventIdForBooking } = await import('./googleCalendar');
const { POST: retryRoute } = await import('@/app/api/admin/bookings/[id]/sync/route');

function seed(booking: Booking, service: Service) {
  db.state.bookings.set(booking.id, booking);
  db.state.services.set(service.id, service);
}

const stored = (id: string) => db.state.bookings.get(id)!;
const logsOf = (type: string) => db.state.logs.filter((l) => l.integration_type === type);
const free = { subtotal: '0.00', tax_amount: '0.00', total_amount: '0.00' };

beforeEach(() => {
  setGoogleEnv();
  google.calendar = new FakeCalendar();
  google.sheets = new FakeSheets();
  db.state.bookings.clear();
  db.state.services.clear();
  db.state.logs.length = 0;
  db.state.executed.length = 0;
  admin.session = null;
});
afterEach(() => clearGoogleEnv());

describe('post-confirmation: paid booking', () => {
  it('sends emails, creates the calendar event and the Paid Bookings row, and stores both IDs', async () => {
    const booking = makeBooking();
    const service = makeService();
    seed(booking, service);

    const result = await runPostConfirmationSideEffects(booking, service);

    expect(result.customerEmail.sent).toBe(true);
    expect(result.ownerEmail.sent).toBe(true);
    expect(result.calendar.status).toBe('created');
    expect(result.sheets).toMatchObject({ status: 'appended', sheetName: 'Paid Bookings' });

    const saved = stored(booking.id);
    expect(saved.google_calendar_event_id).toBe(calendarEventIdForBooking(booking));
    expect(saved.google_sheets_row_id).toBe('Paid Bookings!A2:T2');
    expect(saved.status).toBe('confirmed');

    const row = google.sheets.dataRows('Paid Bookings')[0];
    expect(row[18]).toBe(saved.google_calendar_event_id); // Calendar Event ID column
    expect(google.sheets.dataRows('Studio Tours')).toHaveLength(0);

    expect(logsOf('email')).toHaveLength(2);
    expect(logsOf('google_calendar')).toMatchObject([{ status: 'success', booking_id: booking.id }]);
    expect(logsOf('google_sheets')).toMatchObject([
      {
        status: 'success',
        booking_id: booking.id,
        response_data: expect.objectContaining({ operation: 'appended', sheet: 'Paid Bookings', range: 'Paid Bookings!A2:T2' }),
      },
    ]);
  });

  it('takes a per-booking advisory lock around each Google sync', async () => {
    const booking = makeBooking();
    seed(booking, makeService());
    await syncGoogleIntegrations(booking, makeService());
    expect(db.state.executed.filter((q) => q.includes('pg_advisory_xact_lock'))).toHaveLength(2);
  });

  it('a repeated webhook / retry does not add a second row or event', async () => {
    const booking = makeBooking();
    const service = makeService();
    seed(booking, service);

    await runPostConfirmationSideEffects(booking, service);
    // Replays pass the stale booking object (no IDs yet) — the fresh DB read wins.
    await runPostConfirmationSideEffects(booking, service);
    await syncGoogleIntegrations(booking, service);

    expect(google.calendar.store.size).toBe(1);
    expect(google.sheets.dataRows('Paid Bookings')).toHaveLength(1);
    expect(logsOf('google_sheets').map((l) => l.response_data.operation)).toEqual(['appended', 'updated', 'updated']);
  });

  it('concurrent syncs for the same booking produce exactly one event and one row', async () => {
    const booking = makeBooking();
    const service = makeService();
    seed(booking, service);

    await Promise.all([1, 2, 3, 4].map(() => syncGoogleIntegrations(booking, service)));

    expect(google.calendar.store.size).toBe(1);
    expect(google.sheets.dataRows('Paid Bookings')).toHaveLength(1);
  });

  it('recovers when the row was appended but saving its row id failed', async () => {
    const booking = makeBooking();
    const service = makeService();
    seed(booking, service);
    await syncGoogleIntegrations(booking, service);
    db.state.bookings.set(booking.id, { ...stored(booking.id), google_sheets_row_id: null });

    const again = await syncGoogleIntegrations(booking, service);
    expect(again.sheets.status).toBe('updated');
    expect(stored(booking.id).google_sheets_row_id).toBe('Paid Bookings!A2:T2');
    expect(google.sheets.dataRows('Paid Bookings')).toHaveLength(1);
  });

  it('never overwrites an event ID that is already stored (update-if-null)', async () => {
    const booking = makeBooking({ google_calendar_event_id: 'legacy-event' });
    seed(booking, makeService());
    await syncGoogleIntegrations(booking, makeService());
    expect(stored(booking.id).google_calendar_event_id).toBe('legacy-event');
    expect(google.calendar.insertCalls).toBe(0);
  });
});

describe('post-confirmation: free studio tour', () => {
  it('creates a calendar event and a Studio Tours row only', async () => {
    const booking = makeBooking({ ...free, stripe_payment_id: null, stripe_session_id: null });
    const service = tourService();
    booking.service_id = service.id;
    seed(booking, service);

    const result = await runPostConfirmationSideEffects(booking, service);

    expect(result.calendar.status).toBe('created');
    expect(result.sheets).toMatchObject({ status: 'appended', sheetName: 'Studio Tours', rowId: 'Studio Tours!A2:M2' });
    expect(google.sheets.dataRows('Paid Bookings')).toHaveLength(0);
    expect(google.calendar.store.get(stored(booking.id).google_calendar_event_id!).summary).toMatch(/^Free Studio Tour/);
  });

  it('an ordinary $0 service gets a calendar event but no sheet row', async () => {
    const booking = makeBooking(free);
    const service = makeService({ base_price: '0.00' });
    seed(booking, service);

    const result = await runPostConfirmationSideEffects(booking, service);
    expect(result.calendar.status).toBe('created');
    expect(result.sheets.status).toBe('skipped');
    expect(google.sheets.calls).toHaveLength(0);
    expect(logsOf('google_sheets')).toHaveLength(0);
  });
});

describe('post-confirmation: failures never affect the booking', () => {
  it('a Sheets API failure is logged and leaves the booking confirmed', async () => {
    const booking = makeBooking();
    seed(booking, makeService());
    google.sheets.failWith = apiError(403, 'The caller does not have permission');

    const result = await runPostConfirmationSideEffects(booking, makeService());

    expect(result.sheets.status).toBe('failed');
    expect(result.calendar.status).toBe('created');
    expect(stored(booking.id)).toMatchObject({ status: 'confirmed', payment_status: 'succeeded', google_sheets_row_id: null });
    expect(logsOf('google_sheets')).toMatchObject([
      { status: 'failed', error_message: 'The caller does not have permission (HTTP 403)' },
    ]);
  });

  it('a Calendar API failure is logged, and Sheets still runs', async () => {
    const booking = makeBooking();
    seed(booking, makeService());
    google.calendar.failWith = apiError(404, 'Not Found');

    const result = await runPostConfirmationSideEffects(booking, makeService());

    expect(result.calendar.status).toBe('failed');
    expect(result.sheets.status).toBe('appended');
    expect(stored(booking.id)).toMatchObject({ status: 'confirmed', google_calendar_event_id: null });
    expect(google.sheets.dataRows('Paid Bookings')[0][18]).toBe(''); // no event ID yet
    expect(logsOf('google_calendar')).toMatchObject([{ status: 'failed' }]);
  });

  it('missing credentials are logged as failed, without throwing', async () => {
    clearGoogleEnv();
    const booking = makeBooking();
    seed(booking, makeService());
    const result = await runPostConfirmationSideEffects(booking, makeService());
    expect(result.calendar.status).toBe('not_configured');
    expect(result.sheets.status).toBe('not_configured');
    expect(stored(booking.id).status).toBe('confirmed');
  });

  it('logs never contain key material', async () => {
    const booking = makeBooking();
    seed(booking, makeService());
    google.sheets.failWith = new Error(`boom ${process.env.GOOGLE_CALENDAR_PRIVATE_KEY!.replace(/\\n/g, '\n')}`);
    await runPostConfirmationSideEffects(booking, makeService());
    expect(JSON.stringify(db.state.logs)).not.toContain('MIIE');
  });

  it('pending bookings are not written to Sheets or Calendar', async () => {
    const booking = makeBooking({ status: 'payment_pending', payment_status: 'pending' });
    seed(booking, makeService());
    const r = await syncGoogleIntegrations(booking, makeService());
    expect(r.calendar.status).toBe('skipped');
    expect(r.sheets.status).toBe('skipped');
    expect(google.calendar.insertCalls).toBe(0);
    expect(google.sheets.calls).toHaveLength(0);
  });
});

describe('admin retry endpoint', () => {
  const call = (id: string) =>
    retryRoute(new NextRequest(`http://localhost/api/admin/bookings/${id}/sync`, { method: 'POST' }), { params: { id } });

  it('requires an admin session', async () => {
    const booking = makeBooking();
    seed(booking, makeService());
    const res = await call(booking.id);
    expect(res.status).toBe(401);
    expect(google.calendar.insertCalls).toBe(0);
  });

  it('rejects invalid ids, unknown bookings and unconfirmed bookings', async () => {
    admin.session = { email: 'owner@example.com' };
    expect((await call('not-a-uuid')).status).toBe(400);
    expect((await call('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    const pending = makeBooking({ status: 'payment_pending', payment_status: 'pending' });
    seed(pending, makeService());
    expect((await call(pending.id)).status).toBe(409);
  });

  it('fills in a failed sync and is idempotent on repeat', async () => {
    admin.session = { email: 'owner@example.com' };
    const booking = makeBooking();
    const service = makeService();
    seed(booking, service);

    google.sheets.failWith = apiError(500, 'Backend Error');
    await runPostConfirmationSideEffects(booking, service);
    expect(stored(booking.id).google_sheets_row_id).toBeNull();
    google.sheets.failWith = null;

    const first = await call(booking.id);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      calendar: { status: 'already_exists' },
      sheets: { status: 'appended', sheet: 'Paid Bookings', range: 'Paid Bookings!A2:T2' },
    });

    const second = await call(booking.id);
    expect(await second.json()).toMatchObject({ sheets: { status: 'updated' } });

    expect(google.calendar.store.size).toBe(1);
    expect(google.sheets.dataRows('Paid Bookings')).toHaveLength(1);
    expect(stored(booking.id)).toMatchObject({ status: 'confirmed', payment_status: 'succeeded' });
  });
});
