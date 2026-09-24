import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { RouteDb } from '@/test/fakeRouteDb';
import { makeService } from '@/test/fakeGoogle';
import type { Service } from '@/lib/db/schema';

const h = vi.hoisted(() => ({
  stripeCreate: null as any,
  stripeEvent: null as any,
  stripeRetrieve: null as any,
  stripeExpire: null as any,
  sideEffects: null as any,
  session: null as { email: string } | null,
}));

vi.mock('@/lib/db', async () => {
  const { createRouteDb } = await import('@/test/fakeRouteDb');
  return { db: createRouteDb() };
});
vi.mock('stripe', () => ({
  default: class {
    checkout = {
      sessions: {
        create: (...args: any[]) => h.stripeCreate(...args),
        retrieve: (...args: any[]) => h.stripeRetrieve(...args),
        expire: (...args: any[]) => h.stripeExpire(...args),
      },
    };
    webhooks = { constructEvent: () => h.stripeEvent };
  },
}));
vi.mock('@/lib/postConfirmation', () => ({
  runPostConfirmationSideEffects: (...args: any[]) => h.sideEffects(...args),
}));
vi.mock('@/lib/crm/auth', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/crm/auth');
  const { NextResponse } = await import('next/server');
  const ctx = () =>
    h.session && {
      id: '00000000-0000-4000-8000-000000000001',
      email: h.session.email,
      fullName: null,
      roleId: 1,
      roleName: 'Owner',
      permissions: ['*'],
      can: () => true,
    };
  return {
    ...actual,
    getAdminContext: async () => ctx(),
    requirePermission: async () =>
      ctx() ? { ok: true, admin: ctx() } : { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) },
  };
});
vi.mock('next/headers', () => ({ headers: () => new Map([['stripe-signature', 't=1,v1=test']]) }));

const { db } = (await import('@/lib/db')) as unknown as { db: RouteDb };
const servicesRoute = await import('@/app/api/services/route');
const freeRoute = await import('@/app/api/booking/confirm-free/route');
const checkoutRoute = await import('@/app/api/payment/create-checkout-session/route');
const adminServicesRoute = await import('@/app/api/admin/services/route');

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
  h.stripeRetrieve = vi.fn(async () => ({ id: 'cs_test_1', status: 'open' }));
  h.stripeExpire = vi.fn(async () => ({ id: 'cs_test_1', status: 'expired' }));
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
    expect((await adminServicesRoute.GET(new NextRequest('http://localhost/api/admin/services'))).status).toBe(401);
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

