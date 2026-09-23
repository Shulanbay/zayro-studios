import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildCalendarEvent, calendarEventIdForBooking, syncCalendarEvent } from './googleCalendar';
import { FakeCalendar, apiError, clearGoogleEnv, makeBooking, makeService, setGoogleEnv, tourService } from '@/test/fakeGoogle';

describe('calendarEventIdForBooking', () => {
  it('is deterministic per booking and valid for Google (base32hex, 5–1024 chars)', () => {
    const a = calendarEventIdForBooking({ booking_id: 'ZAY-AAAA' });
    expect(calendarEventIdForBooking({ booking_id: 'ZAY-AAAA' })).toBe(a);
    expect(calendarEventIdForBooking({ booking_id: 'ZAY-BBBB' })).not.toBe(a);
    expect(a).toMatch(/^[a-v0-9]{5,1024}$/);
  });
});

describe('buildCalendarEvent', () => {
  it('uses the booking date/time as New York wall-clock time', () => {
    const event = buildCalendarEvent(makeBooking(), makeService());
    expect(event.start).toEqual({ dateTime: '2026-11-01T14:00:00', timeZone: 'America/New_York' });
    expect(event.end).toEqual({ dateTime: '2026-11-01T15:00:00', timeZone: 'America/New_York' });
  });

  it('does not shift the date when the driver returns a Date object (UTC midnight)', () => {
    const event = buildCalendarEvent(
      makeBooking({ booking_date: new Date('2026-03-08T00:00:00Z') as unknown as string, start_time: '09:00', end_time: '10:30' }),
      makeService()
    );
    // 2026-03-08 is the US spring-forward day; Google applies EDT from the timeZone.
    expect(event.start?.dateTime).toBe('2026-03-08T09:00:00');
    expect(event.end?.dateTime).toBe('2026-03-08T10:30:00');
  });

  it('rolls the end date forward for sessions that cross midnight', () => {
    const event = buildCalendarEvent(makeBooking({ start_time: '23:00', end_time: '00:30' }), makeService());
    expect(event.start?.dateTime).toBe('2026-11-01T23:00:00');
    expect(event.end?.dateTime).toBe('2026-11-02T00:30:00');
  });

  it('includes booking details, location and private extended properties, but no attendees', () => {
    const booking = makeBooking({ notes: 'Bring two mics' });
    const event = buildCalendarEvent(booking, makeService());
    expect(event.summary).toBe('Paid Booking: Single Podcaster — Ada Lovelace');
    for (const part of [
      'Booking ID: ZAY-TEST00000001',
      'Email: ada@example.com',
      'Phone: +1 212 555 0100',
      'Company: Analytical Engines',
      'Payment status: succeeded',
      'Total: $184.66',
      'Bring two mics',
    ]) {
      expect(event.description).toContain(part);
    }
    expect(event.location).toContain('40 W 37th St');
    expect(event.extendedProperties?.private).toEqual({ bookingId: 'ZAY-TEST00000001', bookingType: 'paid' });
    expect(event.attendees).toBeUndefined();
    expect(event.id).toBe(calendarEventIdForBooking(booking));
  });

  it('labels a tour as Free Studio Tour', () => {
    const event = buildCalendarEvent(makeBooking({ subtotal: '0.00', tax_amount: '0.00', total_amount: '0.00' }), tourService());
    expect(event.summary).toMatch(/^Free Studio Tour: Free Studio Tour — /);
    expect(event.extendedProperties?.private?.bookingType).toBe('tour');
  });
});

describe('syncCalendarEvent', () => {
  let calendar: FakeCalendar;
  beforeEach(() => {
    setGoogleEnv();
    calendar = new FakeCalendar();
  });
  afterEach(() => clearGoogleEnv());

  it('creates an event for a confirmed booking', async () => {
    const booking = makeBooking();
    const r = await syncCalendarEvent(booking, makeService(), { calendar: calendar as any });
    expect(r.status).toBe('created');
    expect(r.eventId).toBe(calendarEventIdForBooking(booking));
    expect(calendar.store.size).toBe(1);
  });

  it('creates an event for a free studio tour', async () => {
    const r = await syncCalendarEvent(makeBooking({ total_amount: '0.00' }), tourService(), { calendar: calendar as any });
    expect(r.status).toBe('created');
  });

  it('does not call Google when the booking already has an event ID', async () => {
    const r = await syncCalendarEvent(makeBooking({ google_calendar_event_id: 'existing123' }), makeService(), {
      calendar: calendar as any,
    });
    expect(r).toMatchObject({ status: 'already_exists', eventId: 'existing123' });
    expect(calendar.insertCalls).toBe(0);
  });

  it('reuses the existing event when it was created but the DB update was lost', async () => {
    const booking = makeBooking();
    await syncCalendarEvent(booking, makeService(), { calendar: calendar as any });
    // DB still has google_calendar_event_id = null
    const again = await syncCalendarEvent(booking, makeService(), { calendar: calendar as any });
    expect(again).toMatchObject({ status: 'already_exists', eventId: calendarEventIdForBooking(booking) });
    expect(calendar.store.size).toBe(1);
  });

  it('creates exactly one event under concurrent calls', async () => {
    const booking = makeBooking();
    const results = await Promise.all(
      [1, 2, 3].map(() => syncCalendarEvent(booking, makeService(), { calendar: calendar as any }))
    );
    expect(calendar.store.size).toBe(1);
    expect(new Set(results.map((r) => r.eventId)).size).toBe(1);
    expect(results.filter((r) => r.status === 'created')).toHaveLength(1);
  });

  it('skips bookings that are not confirmed', async () => {
    const r = await syncCalendarEvent(makeBooking({ status: 'payment_pending' }), makeService(), { calendar: calendar as any });
    expect(r.status).toBe('skipped');
    expect(calendar.insertCalls).toBe(0);
  });

  it('returns failed (never throws) on an API error', async () => {
    calendar.failWith = apiError(403, 'You need to have writer access to this calendar.');
    const r = await syncCalendarEvent(makeBooking(), makeService(), { calendar: calendar as any });
    expect(r).toMatchObject({ status: 'failed', eventId: null });
    expect(r.message).toContain('writer access');
  });

  it('reports not_configured without calling Google when credentials are missing', async () => {
    clearGoogleEnv();
    const r = await syncCalendarEvent(makeBooking(), makeService());
    expect(r.status).toBe('not_configured');
    expect(r.message).toMatch(/GOOGLE_CALENDAR_PRIVATE_KEY/);
  });
});
