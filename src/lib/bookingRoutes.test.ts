import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { RouteDb } from '@/test/fakeRouteDb';
import { makeService } from '@/test/fakeGoogle';
import type { Service } from '@/lib/db/schema';

const h = vi.hoisted(() => ({
  stripeCreate: null as any,
  stripeEvent: null as any,
  sideEffects: null as any,
  session: null as { email: string } | null,
}));

vi.mock('@/lib/db', async () => {
  const { createRouteDb } = await import('@/test/fakeRouteDb');
  return { db: createRouteDb() };
});
vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { create: (...args: any[]) => h.stripeCreate(...args) } };
    webhooks = { constructEvent: () => h.stripeEvent };
  },
}));
vi.mock('@/lib/postConfirmation', () => ({
  runPostConfirmationSideEffects: (...args: any[]) => h.sideEffects(...args),
}));
vi.mock('@/lib/adminAuth', () => ({ getAdminSession: () => h.session }));
vi.mock('next/headers', () => ({ headers: () => new Map([['stripe-signature', 't=1,v1=test']]) }));

const { db } = (await import('@/lib/db')) as unknown as { db: RouteDb };
const servicesRoute = await import('@/app/api/services/route');
const timesRoute = await import('@/app/api/booking/available-times/route');
const holdRoute = await import('@/app/api/booking/create-hold/route');
const freeRoute = await import('@/app/api/booking/confirm-free/route');
const checkoutRoute = await import('@/app/api/payment/create-checkout-session/route');
const adminServicesRoute = await import('@/app/api/admin/services/route');
const webhookRoute = await import('@/app/api/payment/webhook/route');

// ---------------------------------------------------------------------------
// Catalog fixture (mirrors the production catalog)
// ---------------------------------------------------------------------------
const catalog: Service[] = [
  makeService({ id: 1, name: 'Single Podcaster', base_price: '170.00', display_order: 10 }),
  makeService({ id: 2, name: 'Podcast Pro', base_price: '200.00', display_order: 20 }),
  makeService({ id: 3, name: 'Full Podcast Package', base_price: '450.00', display_order: 30 }),
  makeService({ id: 11, name: 'Headshot Session', category: 'photography', base_price: '250.00', duration_minutes: 45 }),
  makeService({ id: 12, name: 'Studio Photoshoot', category: 'photography', base_price: '350.00', duration_minutes: 90 }),
  makeService({ id: 13, name: 'Brand Content Session', category: 'photography', base_price: '550.00', duration_minutes: 120, badge: 'Most Popular' }),
  makeService({ id: 20, name: 'Free Studio Tour', category: 'tour', base_price: '0.00', duration_minutes: 30 }),
  makeService({ id: 30, name: '4 Sessions per Month', category: 'package', base_price: '680.00', session_count: 4, validity_days: 30, package_type: 'studio_recording', package_base_service_id: 2 }),
  makeService({ id: 40, name: 'Retired Session', base_price: '99.00', is_active: false }),
];
const byId = new Map(catalog.map((s) => [s.id, s]));
const DATE = '2030-01-07'; // a Monday, far enough ahead to clear advance-notice rules
const EMAIL = 'client@example.com';

function hold(serviceId: number, overrides: Record<string, unknown> = {}) {
  const service = byId.get(serviceId)!;
  const start = '12:00';
  const endMinutes = 12 * 60 + service.duration_minutes;
  return {
    id: 'hold-1',
    customer_email: EMAIL,
    service_id: serviceId,
    booking_date: DATE,
    start_time: start,
    end_time: `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`,
    duration_minutes: service.duration_minutes,
    status: 'active',
    hold_expires_at: new Date(Date.now() + 10 * 60 * 1000),
    created_at: new Date(),
    ...overrides,
  };
}

function post(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const customer = { firstName: 'Ada', lastName: 'Lovelace', email: EMAIL, phone: '+1 212 555 0100', company: '', notes: '' };

beforeEach(() => {
  db.reset();
  h.session = null;
  h.stripeCreate = vi.fn(async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }));
  h.sideEffects = vi.fn(async () => ({}));
  db.script.findFirst = {
    services: (w) => byId.get(Number(w.params[0])),
    businessSettings: (w) => (w.params[0] === 'tax_rate' ? { setting_key: 'tax_rate', setting_value: '0.08875' } : undefined),
    availability: () => ({ day_of_week: 'Monday', start_time: '09:00', end_time: '18:00', is_available: true }),
  };
  db.script.findMany = {
    services: () => catalog,
    // A confirmed Podcast Pro booking 10:00–11:00 — a different service.
    bookings: () => [{ id: 'b-other', service_id: 2, booking_date: DATE, start_time: '10:00', end_time: '11:00', status: 'confirmed' }],
    temporaryHolds: () => [],
    blockedTimes: () => [],
  };
});

describe('GET /api/services', () => {
  it('lists only active, bookable services (no packages, no disabled services), in display order', async () => {
    const res = await servicesRoute.GET();
    const names = (await res.json()).map((s: any) => s.name);
    expect(names).not.toContain('Retired Session');
    expect(names).not.toContain('4 Sessions per Month');
    expect(names).toEqual(expect.arrayContaining(['Single Podcaster', 'Headshot Session', 'Free Studio Tour']));
    expect(names.indexOf('Single Podcaster')).toBeLessThan(names.indexOf('Podcast Pro'));
  });

  it('keeps the existing podcast prices', async () => {
    const res = await servicesRoute.GET();
    const prices = Object.fromEntries((await res.json()).map((s: any) => [s.name, s.base_price]));
    expect(prices).toMatchObject({ 'Single Podcaster': '170.00', 'Podcast Pro': '200.00', 'Full Podcast Package': '450.00' });
  });
});

describe('GET /api/booking/available-times', () => {
  const times = async (serviceId: number, duration = 15) =>
    timesRoute.GET(
      new NextRequest(`http://localhost/api/booking/available-times?service_id=${serviceId}&date=${DATE}&duration_minutes=${duration}`)
    );

  it("uses the service's own duration, whatever the client sends", async () => {
    const headshot = await (await times(11, 15)).json();
    const brand = await (await times(13, 15)).json();
    expect(headshot.duration_minutes).toBe(45);
    expect(brand.duration_minutes).toBe(120);
    expect(headshot.time_slots[0]).toMatchObject({ start: '09:00', end: '09:45' });
    expect(brand.time_slots[0]).toMatchObject({ start: '09:00', end: '11:00' });
    // Longer sessions fit fewer times into the day.
    expect(brand.time_slots.length).toBeLessThan(headshot.time_slots.length);
  });

  it("is studio-wide: another service's booking blocks the slot for photography too", async () => {
    const headshot = await (await times(11)).json();
    const slot = (start: string) => headshot.time_slots.find((s: any) => s.start === start);
    expect(slot('09:00').available).toBe(true); // 09:00–09:45
    expect(slot('09:30').available).toBe(false); // 09:30–10:15 overlaps 10:00–11:00
    expect(slot('10:30').available).toBe(false);
    expect(slot('11:00').available).toBe(true);
    const bookingRead = db.log.reads.find((r) => r.table === 'bookings');
    expect(bookingRead?.where.sql).not.toContain('service_id');
  });

  it('rejects monthly packages and disabled services', async () => {
    expect((await times(30)).status).toBe(400);
    expect((await times(40)).status).toBe(404);
  });
});

describe('POST /api/booking/create-hold', () => {
  const body = (serviceId: number, overrides: Record<string, unknown> = {}) => {
    const hd = hold(serviceId);
    return {
      customer_email: EMAIL,
      service_id: serviceId,
      booking_date: DATE,
      start_time: hd.start_time,
      end_time: hd.end_time,
      duration_minutes: hd.duration_minutes,
      ...overrides,
    };
  };

  it('never creates a hold (time slot) for a monthly package', async () => {
    const res = await holdRoute.POST(post('/api/booking/create-hold', { ...body(2), service_id: 30 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Monthly packages/);
    expect(db.log.transactions).toBe(0);
    expect(db.log.inserts).toHaveLength(0);
  });

  it('rejects a duration that does not match the service', async () => {
    const res = await holdRoute.POST(post('/api/booking/create-hold', body(11, { duration_minutes: 60, end_time: '13:00' })));
    expect(res.status).toBe(400);
  });

  it('holds a photography slot under a studio-wide (per date) lock', async () => {
    const res = await holdRoute.POST(post('/api/booking/create-hold', body(11)));
    expect(res.status).toBe(200);
    expect(db.log.executed.some((q) => q.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(db.log.inserts).toMatchObject([{ table: 'temporary_holds', values: { service_id: 11, duration_minutes: 45, end_time: '12:45' } }]);
  });

  it('refuses a slot overlapping another service’s confirmed booking', async () => {
    const res = await holdRoute.POST(
      post('/api/booking/create-hold', body(11, { start_time: '10:00', end_time: '10:45' }))
    );
    expect(res.status).toBe(409);
    const bookingReads = db.log.reads.filter((r) => r.table === 'bookings');
    expect(bookingReads.length).toBeGreaterThan(0);
    expect(bookingReads.every((r) => !r.where.sql.includes('service_id'))).toBe(true);
    expect(db.log.inserts).toHaveLength(0);
  });
});

describe('POST /api/booking/confirm-free', () => {
  beforeEach(() => {
    db.script.updateReturning = { temporary_holds: () => [{ id: 'hold-1', status: 'converted_to_booking' }] };
  });

  it('confirms a Free Studio Tour without Stripe and runs the confirmation side effects', async () => {
    db.script.findFirst!.temporaryHolds = () => hold(20);
    const res = await freeRoute.POST(post('/api/booking/confirm-free', { holdId: 'hold-1', ...customer }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('confirmed');
    expect(h.stripeCreate).not.toHaveBeenCalled();
    const booking = db.log.inserts.find((i) => i.table === 'bookings')!.values;
    expect(booking).toMatchObject({ status: 'confirmed', payment_status: 'succeeded', total_amount: '0.00', service_id: 20 });
    expect(h.sideEffects).toHaveBeenCalledTimes(1);
    expect(h.sideEffects.mock.calls[0][1].category).toBe('tour');
  });

  it('stores the booking date as YYYY-MM-DD even when the driver returns the hold date as a Date', async () => {
    db.script.findFirst!.temporaryHolds = () => hold(20, { booking_date: new Date(`${DATE}T00:00:00.000Z`) });
    const res = await freeRoute.POST(post('/api/booking/confirm-free', { holdId: 'hold-1', ...customer }));
    expect(res.status).toBe(200);
    expect(db.log.inserts.find((i) => i.table === 'bookings')!.values.booking_date).toBe(DATE);
  });

  it('refuses to confirm a paid photography booking for free (server-side price check)', async () => {
    db.script.findFirst!.temporaryHolds = () => hold(13);
    const res = await freeRoute.POST(post('/api/booking/confirm-free', { holdId: 'hold-1', ...customer, total: 0 }));
    expect(res.status).toBe(400);
    expect((await res.json()).requiresPayment).toBe(true);
    expect(db.log.inserts.find((i) => i.table === 'bookings')).toBeUndefined();
    expect(h.sideEffects).not.toHaveBeenCalled();
  });

  it('refuses a monthly package', async () => {
    db.script.findFirst!.temporaryHolds = () => hold(2, { service_id: 30 });
    const res = await freeRoute.POST(post('/api/booking/confirm-free', { holdId: 'hold-1', ...customer }));
    expect(res.status).toBe(400);
    expect(db.log.inserts.find((i) => i.table === 'bookings')).toBeUndefined();
  });
});

describe('POST /api/payment/create-checkout-session', () => {
  it('sends a photography booking to Stripe with the price computed on the server', async () => {
    db.script.findFirst!.temporaryHolds = () => hold(11);
    const res = await checkoutRoute.POST(
      post('/api/payment/create-checkout-session', { holdId: 'hold-1', ...customer, price: 1, amount: 1 })
    );
    expect(res.status).toBe(200);
    expect(h.stripeCreate).toHaveBeenCalledTimes(1);
    const params = h.stripeCreate.mock.calls[0][0];
    // $250 + 8.875% tax, from the database — the client's "price: 1" is ignored.
    expect(params.line_items[0].price_data.unit_amount).toBe(27219);
    expect(params.line_items[0].price_data.product_data.name).toBe('Headshot Session');
    const booking = db.log.inserts.find((i) => i.table === 'bookings')!.values;
    expect(booking).toMatchObject({ status: 'payment_pending', subtotal: '250.00', total_amount: '272.19' });
  });

  it('stores the booking date as YYYY-MM-DD for paid bookings too', async () => {
    db.script.findFirst!.temporaryHolds = () => hold(11, { booking_date: new Date(`${DATE}T00:00:00.000Z`) });
    await checkoutRoute.POST(post('/api/payment/create-checkout-session', { holdId: 'hold-1', ...customer }));
    expect(db.log.inserts.find((i) => i.table === 'bookings')!.values.booking_date).toBe(DATE);
  });

  it('does not start Stripe for the Free Studio Tour', async () => {
    db.script.findFirst!.temporaryHolds = () => hold(20);
    const res = await checkoutRoute.POST(post('/api/payment/create-checkout-session', { holdId: 'hold-1', ...customer }));
    expect(res.status).toBe(400);
    expect((await res.json()).freeBooking).toBe(true);
    expect(h.stripeCreate).not.toHaveBeenCalled();
  });

  it('does not start Stripe for a monthly package', async () => {
    db.script.findFirst!.temporaryHolds = () => hold(2, { service_id: 30 });
    const res = await checkoutRoute.POST(post('/api/payment/create-checkout-session', { holdId: 'hold-1', ...customer }));
    expect(res.status).toBe(400);
    expect(h.stripeCreate).not.toHaveBeenCalled();
  });
});

describe('admin services API', () => {
  const patch = (body: unknown) =>
    new NextRequest('http://localhost/api/admin/services', { method: 'PATCH', body: JSON.stringify(body) });

  it('requires an admin session for every method', async () => {
    expect((await adminServicesRoute.GET()).status).toBe(401);
    expect((await adminServicesRoute.POST(post('/api/admin/services', { name: 'X' }))).status).toBe(401);
    expect((await adminServicesRoute.PATCH(patch({ id: 1, is_active: false }))).status).toBe(401);
    expect(db.log.reads).toHaveLength(0);
    expect(db.log.inserts).toHaveLength(0);
    expect(db.log.updates).toHaveLength(0);
  });

  it('creates a photography service with validated fields', async () => {
    h.session = { email: 'owner@example.com' };
    const res = await adminServicesRoute.POST(
      post('/api/admin/services', {
        name: 'Mini Headshot',
        base_price: '150',
        duration_minutes: '30',
        category: 'photography',
        features: 'One look\nOnline gallery',
        badge: 'New',
      })
    );
    expect(res.status).toBe(200);
    expect(db.log.inserts[0]).toMatchObject({
      table: 'services',
      values: { name: 'Mini Headshot', base_price: '150.00', category: 'photography', features: ['One look', 'Online gallery'], badge: 'New' },
    });
  });

  it('rejects a package priced from another package', async () => {
    h.session = { email: 'owner@example.com' };
    const res = await adminServicesRoute.POST(
      post('/api/admin/services', {
        name: 'Bad package',
        base_price: '500',
        duration_minutes: 60,
        category: 'package',
        session_count: 2,
        package_type: 'studio_recording',
        package_base_service_id: 30,
      })
    );
    expect(res.status).toBe(400);
    expect(db.log.inserts).toHaveLength(0);
  });

  it('disables a service', async () => {
    h.session = { email: 'owner@example.com' };
    const res = await adminServicesRoute.PATCH(patch({ id: 11, is_active: false }));
    expect(res.status).toBe(200);
    expect(db.log.updates[0]).toMatchObject({ table: 'services', values: { is_active: false } });
  });
});

describe('Stripe webhook: studio-wide conflict check', () => {
  const pending = {
    id: 'booking-photo',
    booking_id: 'ZAY-PHOTO',
    service_id: 13,
    booking_date: DATE,
    start_time: '12:00',
    end_time: '14:00',
    status: 'payment_pending',
    stripe_session_id: 'cs_test_1',
  };

  function deliver() {
    h.stripeEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          metadata: { holdId: 'hold-1', serviceId: '13' },
          amount_total: 59881, // $550 + 8.875%
          currency: 'usd',
          payment_intent: 'pi_test_1',
        },
      },
    };
    return webhookRoute.POST(
      new NextRequest('http://localhost/api/payment/webhook', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 't=1,v1=x' },
      })
    );
  }

  beforeEach(() => {
    db.script.findFirst!.temporaryHolds = () => hold(13);
    // 1st read: idempotency check (confirmed + session) → none; later reads → the pending booking.
    db.script.findFirst!.bookings = (w) => (w.sql.includes('"status"') ? undefined : { ...pending, status: 'confirmed' });
    db.script.updateReturning = { bookings: () => [{ id: pending.id }] };
  });

  it('flags a paid booking that overlaps another service’s confirmed booking', async () => {
    db.script.findMany!.bookings = () => [
      { id: 'b-podcast', service_id: 2, booking_date: DATE, start_time: '13:00', end_time: '14:00', status: 'confirmed' },
    ];
    const res = await deliver();
    expect((await res.json()).status).toBe('conflict_needs_manual_review');
    expect(db.log.updates.filter((u) => u.table === 'bookings')).toHaveLength(0);
    expect(h.sideEffects).not.toHaveBeenCalled();
  });

  it('confirms when nothing overlaps (touching edges are fine)', async () => {
    db.script.findMany!.bookings = () => [
      { id: 'b-podcast', service_id: 2, booking_date: DATE, start_time: '14:00', end_time: '15:00', status: 'confirmed' },
    ];
    const res = await deliver();
    expect((await res.json()).status).toBe('booking_confirmed');
    expect(h.sideEffects).toHaveBeenCalledTimes(1);
  });
});
