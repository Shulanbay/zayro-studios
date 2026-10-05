/**
 * Public booking lifecycle against a real Postgres (PGlite with every
 * migration): temporary holds, Checkout sessions, releases, concurrency and
 * what the public success page may reveal. Stripe is a small in-memory fake
 * that keeps session state (open / complete / expired) like the real API.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

const h = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.NEXTAUTH_SECRET = 'test-secret';
  return { sessions: new Map<string, any>(), counter: 0, creates: 0 };
});

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/pgliteDb');
  const { db, pg } = await createTestDb();
  return { db, pg };
});
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }), headers: () => new Map() }));
vi.mock('stripe', () => ({
  default: class {
    checkout = {
      sessions: {
        create: async (params: any) => {
          h.creates++;
          const id = `cs_test_lc${++h.counter}`;
          const session = {
            id,
            object: 'checkout.session',
            url: `https://checkout.stripe.test/${id}`,
            status: 'open',
            payment_status: 'unpaid',
            expires_at: params.expires_at,
            amount_total: params.line_items[0].price_data.unit_amount,
            currency: 'usd',
            metadata: params.metadata,
            payment_intent: null,
          };
          h.sessions.set(id, session);
          return session;
        },
        retrieve: async (id: string) => {
          const s = h.sessions.get(id);
          if (!s) throw new Error('No such checkout session');
          return s;
        },
        expire: async (id: string) => {
          const s = h.sessions.get(id);
          if (!s || s.status !== 'open') throw new Error('Only open sessions can be expired');
          s.status = 'expired';
          return s;
        },
      },
    };
    refunds = { create: async () => ({}), list: async () => ({ data: [] }) };
    webhooks = { constructEvent: () => ({}) };
    events = { retrieve: async () => ({}) };
  },
}));

delete process.env.RESEND_API_KEY;
delete process.env.GOOGLE_CALENDAR_EMAIL;

const { db, pg } = (await import('@/lib/db')) as unknown as { db: any; pg: import('@electric-sql/pglite').PGlite };
const schema = await import('@/lib/db/schema');
const { seedCatalog } = await import('@/test/pgliteDb');
const { processStripeEvent } = await import('./webhook');
const { cancelBooking } = await import('@/lib/cancelBooking');
const { getAvailableDates, getAvailableTimeSlotsForDate, isSlotActuallyAvailable, loadDayContext, loadRangeContexts } = await import(
  '@/lib/availability'
);
const holdRoute = await import('@/app/api/booking/create-hold/route');
const checkoutRoute = await import('@/app/api/payment/create-checkout-session/route');
const freeRoute = await import('@/app/api/booking/confirm-free/route');
const releaseRoute = await import('@/app/api/booking/release-hold/route');
const validateRoute = await import('@/app/api/booking/validate-hold/route');
const verifyBookingRoute = await import('@/app/api/booking/verify-booking/route');
const verifySessionRoute = await import('@/app/api/booking/verify-session/route');
const datesRoute = await import('@/app/api/booking/available-dates/route');

let ids: Record<string, number>;
let ip = 0;

function post(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.1.${Math.floor(++ip / 250)}.${ip % 250}` },
  });
}

async function count(table: string, where = 'true'): Promise<number> {
  const r = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`);
  return r.rows[0].n;
}

function endOf(start: string, minutes: number) {
  const total = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** The setup a podcast hold needs (photography and tours have nothing to choose). */
async function setupFor(category: string): Promise<number | undefined> {
  if (category !== 'podcast') return undefined;
  const r = await pg.query<{ id: number }>("SELECT id FROM setups WHERE slug = 'sofa-lounge'");
  return r.rows[0]?.id;
}

async function requestHold(date: string, start: string, email: string, serviceName = 'Podcast Pro', extra: Record<string, unknown> = {}) {
  const service = await db.query.services.findFirst({ where: eq(schema.services.id, ids[serviceName]) });
  const res = await holdRoute.POST(
    post('/api/booking/create-hold', {
      customer_email: email,
      service_id: service.id,
      booking_date: date,
      start_time: start,
      end_time: endOf(start, service.duration_minutes),
      duration_minutes: service.duration_minutes,
      setup_id: await setupFor(service.category),
      ...extra,
    })
  );
  return { status: res.status, body: await res.json() };
}

const contact = (email: string) => ({
  firstName: 'Test',
  lastName: 'Customer',
  email,
  phone: '+1 212 555 0100',
  intake: { peopleRecording: 2, peopleOnCamera: 2, recordingType: 'Podcast', editing: 'no' },
});

async function checkout(holdId: string, email: string) {
  const res = await checkoutRoute.POST(post('/api/payment/create-checkout-session', { holdId, ...contact(email) }));
  return { status: res.status, body: await res.json() };
}

function paidEvent(sessionId: string, type: Stripe.Event['type'] = 'checkout.session.completed'): Stripe.Event {
  const s = h.sessions.get(sessionId);
  s.status = 'complete';
  s.payment_status = 'paid';
  s.payment_intent = `pi_${sessionId}`;
  return { id: `evt_${sessionId}_${type}`, type, livemode: false, data: { object: { ...s } } } as unknown as Stripe.Event;
}

beforeAll(async () => {
  ids = await seedCatalog(pg);
});

beforeEach(() => {
  h.creates = 0;
});

// ---------------------------------------------------------------------------

describe('temporary holds', () => {
  it('many customers racing for one slot: exactly one hold wins', async () => {
    const attempts = await Promise.all(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((n, i) => requestHold('2030-04-01', i % 2 ? '10:00' : '10:30', `${n}@race.test`))
    );
    expect(attempts.filter((a) => a.status === 200)).toHaveLength(1);
    expect(attempts.filter((a) => a.status === 409)).toHaveLength(5);
    expect(await count('temporary_holds', `booking_date = '2030-04-01' AND status = 'active'`)).toBe(1);
  });

  it('the same customer asking again for the same slot gets the same hold', async () => {
    const first = await requestHold('2030-04-02', '10:00', 'again@example.com');
    const second = await requestHold('2030-04-02', '10:00', 'AGAIN@example.com');
    expect(second.status).toBe(200);
    expect(second.body.hold_id).toBe(first.body.hold_id);
    expect(await count('temporary_holds', `booking_date = '2030-04-02'`)).toBe(1);
    // The price shown on the summary comes from the server ($200 + 8.875%).
    expect(first.body.pricing).toMatchObject({ subtotal: '200.00', taxAmount: '17.75', total: '217.75' });
  });

  it('picking another time gives back the previous hold (only your own)', async () => {
    const first = await requestHold('2030-04-03', '10:00', 'mover@example.com');
    const second = await requestHold('2030-04-03', '14:00', 'mover@example.com', 'Podcast Pro', { previous_hold_id: first.body.hold_id });
    expect(second.status).toBe(200);
    const old = await db.query.temporaryHolds.findFirst({ where: eq(schema.temporaryHolds.id, first.body.hold_id) });
    expect(old.status).toBe('cancelled');
    expect(await isSlotActuallyAvailable('2030-04-03', '10:00', '11:00', 60)).toBe(true);

    // Someone else's hold id is ignored.
    const other = await requestHold('2030-04-03', '17:00', 'intruder@example.com', 'Podcast Pro', { previous_hold_id: second.body.hold_id });
    expect(other.status).toBe(200);
    const kept = await db.query.temporaryHolds.findFirst({ where: eq(schema.temporaryHolds.id, second.body.hold_id) });
    expect(kept.status).toBe('active');
  });

  it('an expired hold frees the slot and cannot be checked out', async () => {
    const hold = await requestHold('2030-04-04', '10:00', 'late@example.com');
    await db
      .update(schema.temporaryHolds)
      .set({ hold_expires_at: new Date(Date.now() - 1000) })
      .where(eq(schema.temporaryHolds.id, hold.body.hold_id));
    expect(await isSlotActuallyAvailable('2030-04-04', '10:00', '11:00', 60)).toBe(true);
    const res = await checkout(hold.body.hold_id, 'late@example.com');
    expect(res.status).toBe(410);
    expect(h.creates).toBe(0);
    const validation = await (await validateRoute.POST(post('/api/booking/validate-hold', { hold_id: hold.body.hold_id }))).json();
    expect(validation).toEqual({ valid: false, reason: 'hold_expired' });
  });

  it('a hold belongs to one customer and one service', async () => {
    const hold = await requestHold('2030-04-05', '10:00', 'owner@example.com');
    expect((await checkout(hold.body.hold_id, 'someone-else@example.com')).status).toBe(403);
    // The duration must be the service's own.
    const wrong = await holdRoute.POST(
      post('/api/booking/create-hold', {
        customer_email: 'x@example.com',
        service_id: ids['Headshot Session'],
        booking_date: '2030-04-05',
        start_time: '14:00',
        end_time: '15:00',
        duration_minutes: 60,
      })
    );
    expect(wrong.status).toBe(400);
  });

  it('validate-hold never returns the customer email', async () => {
    const hold = await requestHold('2030-04-06', '10:00', 'private@example.com');
    const body = await (await validateRoute.POST(post('/api/booking/validate-hold', { hold_id: hold.body.hold_id }))).json();
    expect(body.valid).toBe(true);
    expect(JSON.stringify(body)).not.toContain('private@example.com');
  });
});

// ---------------------------------------------------------------------------

describe('Checkout and holds', () => {
  it('stretches the hold to the Checkout session expiry', async () => {
    const hold = await requestHold('2030-04-08', '10:00', 'stretch@example.com');
    const res = await checkout(hold.body.hold_id, 'stretch@example.com');
    expect(res.status).toBe(200);
    const session = h.sessions.get(res.body.sessionId);
    const row = await db.query.temporaryHolds.findFirst({ where: eq(schema.temporaryHolds.id, hold.body.hold_id) });
    expect(new Date(row.hold_expires_at).getTime()).toBe(session.expires_at * 1000);
    expect(session.expires_at * 1000 - Date.now()).toBeGreaterThan(30 * 60 * 1000 - 5000);
  });

  it('asking for Checkout twice reuses the open session: one booking, one purchase', async () => {
    const hold = await requestHold('2030-04-09', '10:00', 'twice@example.com');
    const [a, b] = await Promise.all([checkout(hold.body.hold_id, 'twice@example.com'), checkout(hold.body.hold_id, 'twice@example.com')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.sessionId).toBe(a.body.sessionId);
    expect(h.creates).toBe(1);
    expect(await count('bookings', `booking_date = '2030-04-09'`)).toBe(1);
    expect(await count('purchases', `stripe_checkout_session_id = '${a.body.sessionId}'`)).toBe(1);
  });

  it('leaving Checkout releases the slot and expires the session', async () => {
    const hold = await requestHold('2030-04-10', '10:00', 'leaver@example.com');
    const { body } = await checkout(hold.body.hold_id, 'leaver@example.com');
    const booking = await db.query.bookings.findFirst({ where: eq(schema.bookings.stripe_session_id, body.sessionId) });

    const res = await releaseRoute.POST(post('/api/booking/release-hold', { hold_id: hold.body.hold_id }));
    expect(await res.json()).toEqual({ released: true });
    expect(h.sessions.get(body.sessionId).status).toBe('expired');
    const cancelled = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    expect(cancelled.status).toBe('cancelled');
    const purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, cancelled.purchase_id) });
    expect(purchase.status).toBe('cancelled');
    expect(await isSlotActuallyAvailable('2030-04-10', '10:00', '11:00', 60)).toBe(true);

    // Stripe's own "expired" event afterwards changes nothing.
    const s = h.sessions.get(body.sessionId);
    const expired = await processStripeEvent({
      id: `evt_exp_${body.sessionId}`,
      type: 'checkout.session.expired',
      data: { object: { ...s } },
    } as unknown as Stripe.Event);
    expect(expired.body).toMatchObject({ status: 'unchanged' });
    // Releasing twice is harmless.
    expect(await (await releaseRoute.POST(post('/api/booking/release-hold', { hold_id: hold.body.hold_id }))).json()).toMatchObject({
      released: false,
    });
  });

  it('does not release a hold whose Checkout was already paid', async () => {
    const hold = await requestHold('2030-04-11', '10:00', 'payer@example.com');
    const { body } = await checkout(hold.body.hold_id, 'payer@example.com');
    const event = paidEvent(body.sessionId);
    const res = await releaseRoute.POST(post('/api/booking/release-hold', { hold_id: hold.body.hold_id }));
    expect(await res.json()).toEqual({ released: false, paid: true });
    // The webhook then confirms normally.
    expect((await processStripeEvent(event)).body).toMatchObject({ status: 'booking_confirmed' });
    const hold2 = await db.query.temporaryHolds.findFirst({ where: eq(schema.temporaryHolds.id, hold.body.hold_id) });
    expect(hold2.status).toBe('converted_to_booking');
  });

  it('an expired Checkout (webhook) releases the booking and the slot', async () => {
    const hold = await requestHold('2030-04-12', '10:00', 'expiry@example.com');
    const { body } = await checkout(hold.body.hold_id, 'expiry@example.com');
    const s = h.sessions.get(body.sessionId);
    s.status = 'expired';
    const result = await processStripeEvent({ id: `evt_x_${s.id}`, type: 'checkout.session.expired', data: { object: { ...s } } } as unknown as Stripe.Event);
    expect(result.body).toMatchObject({ status: 'released' });
    const row = await db.query.temporaryHolds.findFirst({ where: eq(schema.temporaryHolds.id, hold.body.hold_id) });
    expect(row.status).toBe('cancelled');
    expect(await isSlotActuallyAvailable('2030-04-12', '10:00', '11:00', 60)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('concurrent confirmation of one slot', () => {
  it('two payments landing at once for overlapping bookings: one confirmed, one flagged for refund', async () => {
    // A's hold ran out while A was still on the Stripe page; B then took
    // the same time. Both pay; the webhooks arrive together.
    const a = await requestHold('2030-04-15', '10:00', 'first@example.com');
    const aCheckout = await checkout(a.body.hold_id, 'first@example.com');
    await db.update(schema.temporaryHolds).set({ hold_expires_at: new Date(Date.now() - 1000) }).where(eq(schema.temporaryHolds.id, a.body.hold_id));
    const b = await requestHold('2030-04-15', '10:30', 'second@example.com');
    expect(b.status).toBe(200);
    const bCheckout = await checkout(b.body.hold_id, 'second@example.com');

    const results = await Promise.all([processStripeEvent(paidEvent(aCheckout.body.sessionId)), processStripeEvent(paidEvent(bCheckout.body.sessionId))]);
    const statuses = results.map((r) => r.body.status).sort();
    expect(statuses).toEqual(['booking_confirmed', 'needs_review']);
    expect(await count('bookings', `booking_date = '2030-04-15' AND status = 'confirmed'`)).toBe(1);
    expect(await count('bookings', `booking_date = '2030-04-15' AND needs_refund_review`)).toBe(1);
    expect(await count('purchases', `needs_refund_review AND status = 'paid'`)).toBeGreaterThanOrEqual(1);
  });

  it('the same free tour confirmed three times at once creates one booking', async () => {
    const hold = await requestHold('2030-04-16', '11:00', 'tour@example.com', 'Free Studio Tour');
    expect(hold.status).toBe(200);
    expect(hold.body.pricing.total).toBe('0.00');
    const responses = await Promise.all(
      [1, 2, 3].map(() => freeRoute.POST(post('/api/booking/confirm-free', { holdId: hold.body.hold_id, ...contact('tour@example.com') })))
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies.filter((b) => b.status === 'confirmed')).toHaveLength(1);
    expect(await count('bookings', `booking_date = '2030-04-16'`)).toBe(1);
    expect(await count('purchases', `type = 'studio_tour' AND total_cents = 0 AND order_number = 'ZO-${bodies.find((b) => b.bookingId).bookingId.slice(4)}'`)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('public success page data', () => {
  it('a free booking returns a summary without phone or full email', async () => {
    const hold = await requestHold('2030-04-17', '11:00', 'visitor@example.com', 'Free Studio Tour');
    const confirmed = await (await freeRoute.POST(post('/api/booking/confirm-free', { holdId: hold.body.hold_id, ...contact('visitor@example.com') }))).json();
    const res = await verifyBookingRoute.POST(post('/api/booking/verify-booking', { bookingId: confirmed.bookingId }));
    const body = await res.json();
    expect(body.status).toBe('confirmed');
    expect(body.booking).toMatchObject({ bookingId: confirmed.bookingId, isFree: true, emailHint: 'v***@example.com', firstName: 'Test' });
    const json = JSON.stringify(body);
    expect(json).not.toContain('visitor@example.com');
    expect(json).not.toContain('555');
    // Unknown or malformed ids reveal nothing.
    expect(await (await verifyBookingRoute.POST(post('/api/booking/verify-booking', { bookingId: 'ZAY-NOPE00000000' }))).json()).toEqual({ status: 'not_found' });
    expect(await (await verifyBookingRoute.POST(post('/api/booking/verify-booking', { bookingId: "x' OR 1=1" }))).json()).toEqual({ status: 'not_found' });
  });

  it('a paid session reports processing, then confirmed, and needs_review when paid after cancellation', async () => {
    const hold = await requestHold('2030-04-18', '10:00', 'success@example.com');
    const { body } = await checkout(hold.body.hold_id, 'success@example.com');
    const verify = async () => (await verifySessionRoute.POST(post('/api/booking/verify-session', { sessionId: body.sessionId }))).json();
    expect(await verify()).toEqual({ status: 'pending' });
    const event = paidEvent(body.sessionId);
    expect(await verify()).toEqual({ status: 'processing' });
    await processStripeEvent(event);
    const done = await verify();
    expect(done.status).toBe('confirmed');
    expect(JSON.stringify(done)).not.toContain('success@example.com');

    // Cancelled by staff first, paid later from an old tab.
    const hold2 = await requestHold('2030-04-18', '15:00', 'oldtab@example.com');
    const c2 = await checkout(hold2.body.hold_id, 'oldtab@example.com');
    const booking2 = await db.query.bookings.findFirst({ where: eq(schema.bookings.stripe_session_id, c2.body.sessionId) });
    const cancelled = await cancelBooking(booking2.id, 'staff@zayro.test', { reason: 'Customer asked' });
    expect(cancelled.ok).toBe(true);
    await processStripeEvent(paidEvent(c2.body.sessionId));
    const late = await (await verifySessionRoute.POST(post('/api/booking/verify-session', { sessionId: c2.body.sessionId }))).json();
    expect(late.status).toBe('needs_review');
    const row = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking2.id) });
    expect(row.status).toBe('cancelled');
    expect(await isSlotActuallyAvailable('2030-04-18', '15:00', '16:00', 60)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('availability ranges', () => {
  it('the range loader agrees with the per-day loader', async () => {
    await requestHold('2030-05-02', '12:00', 'range@example.com');
    await db.insert(schema.availabilityOverrides).values({ date: '2030-05-03', kind: 'holiday', is_closed: true, reason: 'Holiday' });
    const now = new Date('2030-05-01T12:00:00Z');
    const range = await loadRangeContexts('2030-05-01', '2030-05-07', db, { now });
    expect(range.map((d) => d.date)).toEqual(['2030-05-01', '2030-05-02', '2030-05-03', '2030-05-04', '2030-05-05', '2030-05-06', '2030-05-07']);
    for (const ctx of range) {
      const single = await loadDayContext(ctx.date, db, { now });
      expect(ctx).toEqual(single);
    }
    const dates = await getAvailableDates('2030-05-01', '2030-05-07', 60, db, { now });
    expect(dates).not.toContain('2030-05-03');
    expect(dates).toContain('2030-05-02');
  });

  it('past days and past times are never offered', async () => {
    const now = new Date('2030-05-10T20:10:00Z'); // 16:10 EDT
    expect(await getAvailableDates('2030-05-08', '2030-05-12', 60, db, { now })).toEqual(['2030-05-10', '2030-05-11', '2030-05-12']);
    const today = await getAvailableTimeSlotsForDate('2030-05-10', 60, db, { now });
    expect(today[0].start).toBe('17:30'); // 1 hour notice, next half hour
    expect(await getAvailableTimeSlotsForDate('2030-05-09', 60, db, { now })).toEqual([]);
  });

  it('the dates API rejects oversized or malformed ranges', async () => {
    const get = (qs: string) => datesRoute.GET(new NextRequest(`http://localhost/api/booking/available-dates?${qs}`));
    expect((await get(`service_id=${ids['Podcast Pro']}&from_date=2030-01-01&to_date=2030-12-31`)).status).toBe(400);
    expect((await get(`service_id=${ids['Podcast Pro']}&from_date=2030-02-31&to_date=2030-03-01`)).status).toBe(400);
  });

  it('services hidden from booking or quote-only cannot be held', async () => {
    await db.update(schema.services).set({ quote_only: true }).where(eq(schema.services.id, ids['Studio Photoshoot']));
    const res = await requestHold('2030-05-20', '10:00', 'quote@example.com', 'Studio Photoshoot');
    expect(res.status).toBe(400);
    await db.update(schema.services).set({ quote_only: false, visible_in_booking: false }).where(eq(schema.services.id, ids['Studio Photoshoot']));
    expect((await requestHold('2030-05-20', '10:00', 'quote@example.com', 'Studio Photoshoot')).status).toBe(400);
    await db.update(schema.services).set({ visible_in_booking: true }).where(eq(schema.services.id, ids['Studio Photoshoot']));
    expect((await requestHold('2030-05-20', '10:00', 'quote@example.com', 'Studio Photoshoot')).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------

describe('hourly sessions, add-ons and intake questions', () => {
  async function addonId(slug: string): Promise<number> {
    const r = await pg.query<{ id: number }>('SELECT id FROM service_addons WHERE slug = $1', [slug]);
    return r.rows[0].id;
  }

  async function holdFor(date: string, start: string, email: string, hours: number, addons: { id: number; quantity: number }[], serviceName = 'Podcast Pro') {
    const service = await db.query.services.findFirst({ where: eq(schema.services.id, ids[serviceName]) });
    const res = await holdRoute.POST(
      post('/api/booking/create-hold', {
        customer_email: email,
        service_id: service.id,
        booking_date: date,
        start_time: start,
        end_time: endOf(start, service.duration_minutes * hours),
        duration_minutes: service.duration_minutes * hours,
        hours,
        addons,
        setup_id: await setupFor(service.category),
      })
    );
    return { status: res.status, body: await res.json() };
  }

  it('prices a 3-hour session with per-hour and per-session extras on the server', async () => {
    const camera = await addonId('additional-camera');
    const editing = await addonId('full-podcast-editing');
    const hold = await holdFor('2030-06-03', '10:00', 'long@example.com', 3, [
      { id: camera, quantity: 2 },
      { id: editing, quantity: 1 },
    ]);
    expect(hold.status, JSON.stringify(hold.body)).toBe(200);
    // 3 × $200 + camera $50 × 2 × 3 h + editing $200 = $1,100; tax 8.875% = $97.63
    expect(hold.body.pricing).toMatchObject({ subtotal: '1100.00', taxAmount: '97.63', total: '1197.63', units: 3, durationMinutes: 180 });
    expect(hold.body.pricing.lines).toHaveLength(3);

    // The whole three hours are held.
    expect(await isSlotActuallyAvailable('2030-06-03', '12:00', '13:00', 60)).toBe(false);
    expect(await isSlotActuallyAvailable('2030-06-03', '13:00', '14:00', 60)).toBe(true);

    const guests = ['Guest.One@example.com', 'guest.two@example.com', 'long@example.com', 'guest.one@example.com'];
    const res = await checkoutRoute.POST(
      post('/api/payment/create-checkout-session', {
        holdId: hold.body.hold_id,
        ...contact('long@example.com'),
        intake: { peopleRecording: 3, peopleOnCamera: 2, recordingType: 'Interview', editing: 'yes', project: 'Pilot episode', guests, price: 1 },
      })
    );
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.pricing.total).toBe('1197.63');
    expect(h.sessions.get(body.sessionId).amount_total).toBe(119763);

    const booking = await db.query.bookings.findFirst({ where: eq(schema.bookings.stripe_session_id, body.sessionId) });
    expect(booking).toMatchObject({ duration_minutes: 180, start_time: '10:00', end_time: '13:00', subtotal: '1100.00', total_amount: '1197.63' });
    // Guests: de-duplicated, lower-cased, and never the customer themselves.
    expect(booking.intake).toEqual({
      peopleRecording: 3,
      peopleOnCamera: 2,
      recordingType: 'Interview',
      editing: 'yes',
      project: 'Pilot episode',
      guests: ['guest.one@example.com', 'guest.two@example.com'],
      setupName: 'Sofa Lounge',
    });
    expect(booking.setup_id).toBe(await setupFor('podcast'));
    const items = await pg.query<any>('SELECT item_type, quantity, unit_price_cents, total_cents FROM purchase_items WHERE purchase_id = $1 ORDER BY total_cents DESC', [booking.purchase_id]);
    expect(items.rows).toEqual([
      { item_type: 'service', quantity: 3, unit_price_cents: 20000, total_cents: 60000 },
      { item_type: 'addon', quantity: 6, unit_price_cents: 5000, total_cents: 30000 },
      { item_type: 'addon', quantity: 1, unit_price_cents: 20000, total_cents: 20000 },
    ]);

    // Paid: confirmed for exactly that amount; each guest gets one invitation.
    expect((await processStripeEvent(paidEvent(body.sessionId))).body).toMatchObject({ status: 'booking_confirmed' });
    expect(await count('email_logs', `booking_id = '${booking.id}' AND template = 'guest_invite' AND recipient_type = 'guest'`)).toBe(2);
    expect(await count('email_logs', `booking_id = '${booking.id}' AND recipient = 'long@example.com' AND template = 'guest_invite'`)).toBe(0);

    // A later price change never touches what was sold.
    await db.update(schema.serviceAddons).set({ price_cents: 99900 }).where(eq(schema.serviceAddons.id, camera));
    const after = await pg.query<any>('SELECT sum(total_cents)::int AS t FROM purchase_items WHERE purchase_id = $1', [booking.purchase_id]);
    expect(after.rows[0].t).toBe(110000);
    await db.update(schema.serviceAddons).set({ price_cents: 5000 }).where(eq(schema.serviceAddons.id, camera));

    // Rescheduling keeps the three hours.
    const { rescheduleBooking: reschedule } = await import('./bookings');
    const moved = await reschedule(booking.id, { date: '2030-06-04', startTime: '14:00' }, { id: null, email: 'staff@zayro.test' });
    expect(moved.booking).toMatchObject({ start_time: '14:00', end_time: '17:00', duration_minutes: 180 });
  });

  it('refuses lengths and extras the service does not allow', async () => {
    const camera = await addonId('additional-camera');
    const teleprompter = await addonId('teleprompter');
    // Longer than 9 hours, or hours on a fixed-length photoshoot.
    expect((await holdFor('2030-06-05', '08:00', 'a@example.com', 10, [])).status).toBe(400);
    expect((await holdFor('2030-06-05', '08:00', 'a@example.com', 2, [], 'Headshot Session')).status).toBe(400);
    // Nine hours is the limit and fits an 08:00–22:00 day.
    const nine = await holdFor('2030-06-05', '08:00', 'nine@example.com', 9, []);
    expect(nine.status).toBe(200);
    expect(nine.body.pricing.subtotal).toBe('1800.00');
    // Too many of one extra, an unknown extra, an inactive extra, extras on a free tour or a photoshoot.
    expect((await holdFor('2030-06-06', '10:00', 'b@example.com', 1, [{ id: camera, quantity: 9 }])).status).toBe(400);
    expect((await holdFor('2030-06-06', '10:00', 'b@example.com', 1, [{ id: 999999, quantity: 1 }])).status).toBe(400);
    await db.update(schema.serviceAddons).set({ active: false }).where(eq(schema.serviceAddons.id, teleprompter));
    expect((await holdFor('2030-06-06', '10:00', 'b@example.com', 1, [{ id: teleprompter, quantity: 1 }])).status).toBe(400);
    await db.update(schema.serviceAddons).set({ active: true }).where(eq(schema.serviceAddons.id, teleprompter));
    expect((await holdFor('2030-06-06', '11:00', 'b@example.com', 1, [{ id: camera, quantity: 1 }], 'Free Studio Tour')).status).toBe(400);
    expect((await holdFor('2030-06-06', '12:00', 'b@example.com', 1, [{ id: camera, quantity: 1 }], 'Headshot Session')).status).toBe(400);
  });

  it('requires the answers the studio needs before a podcast checkout', async () => {
    const hold = await requestHold('2030-06-07', '10:00', 'intake@example.com');
    const attempt = async (intake: unknown) => {
      const res = await checkoutRoute.POST(post('/api/payment/create-checkout-session', { holdId: hold.body.hold_id, ...contact('intake@example.com'), intake }));
      return { status: res.status, body: await res.json() };
    };
    expect((await attempt(undefined)).status).toBe(400);
    expect((await attempt({ peopleRecording: 2, peopleOnCamera: 3, recordingType: 'Podcast', editing: 'no' })).status).toBe(400);
    expect((await attempt({ peopleRecording: 2, peopleOnCamera: 2, recordingType: 'Karaoke', editing: 'no' })).status).toBe(400);
    expect((await attempt({ peopleRecording: 2, peopleOnCamera: 2, recordingType: 'Podcast', editing: 'no', guests: ['not-an-email'] })).status).toBe(400);
    expect(h.creates).toBe(0);
    expect((await attempt({ peopleRecording: 2, peopleOnCamera: 0, recordingType: 'Podcast', editing: 'maybe' })).status).toBe(200);
  });

  it('the public add-ons list shows only active extras for paid podcast services', async () => {
    const addonsRoute = await import('@/app/api/booking/addons/route');
    const get = async (name: string) => (await addonsRoute.GET(new NextRequest(`http://localhost/api/booking/addons?service_id=${ids[name]}`))).json();
    const podcast = await get('Podcast Pro');
    expect(podcast).toHaveLength(11);
    expect(podcast.find((a: any) => a.name === 'Additional Camera')).toMatchObject({ price: '50.00', unit: 'hour', max_quantity: 3 });
    expect(await get('Free Studio Tour')).toEqual([]);
    expect(await get('Headshot Session')).toEqual([]);
  });
});

describe('studio setups', () => {
  it('a podcast booking needs one of the four setups; photography gets its only one automatically', async () => {
    const setupsRoute = await import('@/app/api/booking/setups/route');
    const list = await (await setupsRoute.GET(new NextRequest(`http://localhost/api/booking/setups?service_id=${ids['Podcast Pro']}`))).json();
    expect(list.map((s: any) => s.name)).toEqual(['Sofa Lounge', 'Cream Lounge', 'Garden Lounge', 'Library Table']);
    expect(list[0]).toMatchObject({ seats: 3, image: '/setups/sofa-lounge.webp' });

    const body = (setup_id?: number) => ({
      customer_email: 'setup@example.com',
      service_id: ids['Podcast Pro'],
      booking_date: '2030-06-10',
      start_time: '10:00',
      end_time: '11:00',
      duration_minutes: 60,
      setup_id,
    });
    const none = await holdRoute.POST(post('/api/booking/create-hold', body()));
    expect(none.status).toBe(400);
    expect((await none.json()).error).toMatch(/setup/i);
    const photo = await pg.query<{ id: number }>("SELECT id FROM setups WHERE slug = 'photo-studio'");
    expect((await holdRoute.POST(post('/api/booking/create-hold', body(photo.rows[0].id)))).status).toBe(400);
    expect((await holdRoute.POST(post('/api/booking/create-hold', body(list[2].id)))).status).toBe(200);

    const headshot = await requestHold('2030-06-10', '14:00', 'photo@example.com', 'Headshot Session');
    expect(headshot.status).toBe(200);
    const hold = await db.query.temporaryHolds.findFirst({ where: eq(schema.temporaryHolds.id, headshot.body.hold_id) });
    expect(hold.selection.setupId).toBe(photo.rows[0].id);
  });
});
