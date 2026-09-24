/**
 * End-to-end tests of the CRM against a real Postgres (PGlite with every
 * migration, triggers and the bookings_no_overlap constraint). Stripe is
 * faked; Google and Resend are unconfigured, so their side effects are
 * logged as not configured / skipped.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

const h = vi.hoisted(() => ({
  sessionToken: null as string | null,
  refundCreate: null as any,
  sessionCounter: 0,
}));

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/pgliteDb');
  const { db, pg } = await createTestDb();
  return { db, pg };
});
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (name: string) => (name === 'zayro_admin_session' && h.sessionToken ? { value: h.sessionToken } : undefined) }),
  headers: () => new Map([['stripe-signature', 't=1,v1=test']]),
}));
vi.mock('stripe', () => ({
  default: class {
    checkout = {
      sessions: {
        create: async (params: any) => {
          h.sessionCounter++;
          return { id: `cs_test_${h.sessionCounter}`, url: `https://checkout.stripe.test/${h.sessionCounter}`, params };
        },
        retrieve: async (id: string) => ({ id, status: 'open' }),
        expire: async (id: string) => ({ id, status: 'expired' }),
      },
    };
    refunds = {
      create: (...args: any[]) => h.refundCreate(...args),
      list: async () => ({ data: [] }),
    };
    webhooks = { constructEvent: () => ({}) };
    events = { retrieve: async () => ({}) };
  },
}));

process.env.NEXTAUTH_SECRET = 'test-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.ADMIN_EMAILS = 'owner@zayro.test';
delete process.env.RESEND_API_KEY;
delete process.env.GOOGLE_CALENDAR_EMAIL;

const { db, pg } = (await import('@/lib/db')) as unknown as { db: any; pg: import('@electric-sql/pglite').PGlite };
const schema = await import('@/lib/db/schema');
const { seedCatalog } = await import('@/test/pgliteDb');
const { createManualBooking, rescheduleBooking, setBookingOutcome, markPurchasePaid } = await import('./bookings');
const { cancelBooking } = await import('@/lib/cancelBooking');
const { processStripeEvent } = await import('./webhook');
const { issueRefund, refundableCents } = await import('./refunds');
const { assignPackage, adjustCredits, expireDuePackages } = await import('./packages');
const { upsertCustomer, previewMerge, mergeCustomers } = await import('./customers');
const { getAvailableTimeSlotsForDate, isSlotActuallyAvailable } = await import('@/lib/availability');
const { addDays, todayInTz } = await import('./time');
const { resolveAdminProfile, requirePermission } = await import('./auth');
const { consumeLoginToken } = await import('./login');
const { createLoginToken, createSessionToken } = await import('@/lib/adminAuth');
const holdRoute = await import('@/app/api/booking/create-hold/route');
const checkoutRoute = await import('@/app/api/payment/create-checkout-session/route');
const freeRoute = await import('@/app/api/booking/confirm-free/route');

const actor = { id: null, email: 'staff@zayro.test' };
let ids: Record<string, number>;
let ipCounter = 0;

function post(url: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.0.${++ipCounter % 250}`, ...extraHeaders },
  });
}

async function count(table: string, where = 'true'): Promise<number> {
  const r = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`);
  return r.rows[0].n;
}

async function bookingByCode(code: string) {
  return db.query.bookings.findFirst({ where: eq(schema.bookings.booking_id, code) });
}

/** Public flow: hold → Stripe Checkout. Returns the payment_pending booking and the fake session. */
async function startCheckout(date: string, start: string, serviceName = 'Podcast Pro', email = 'client@example.com') {
  const service = await db.query.services.findFirst({ where: eq(schema.services.id, ids[serviceName]) });
  const endMinutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + service.duration_minutes;
  const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  const holdRes = await holdRoute.POST(
    post('/api/booking/create-hold', {
      customer_email: email,
      service_id: service.id,
      booking_date: date,
      start_time: start,
      end_time: end,
      duration_minutes: service.duration_minutes,
    })
  );
  const hold = await holdRes.json();
  expect(holdRes.status, JSON.stringify(hold)).toBe(200);
  const res = await checkoutRoute.POST(
    post('/api/payment/create-checkout-session', {
      holdId: hold.hold_id,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email,
      phone: '+1 212 555 0100',
    })
  );
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  const booking = await db.query.bookings.findFirst({ where: eq(schema.bookings.stripe_session_id, body.sessionId) });
  return { booking, sessionId: body.sessionId as string, holdId: hold.hold_id as string };
}

let eventCounter = 0;
function checkoutEvent(
  booking: { id: string; total_amount: string },
  sessionId: string,
  holdId: string,
  overrides: Partial<Stripe.Checkout.Session> = {},
  type: Stripe.Event['type'] = 'checkout.session.completed',
  eventId = `evt_${++eventCounter}`
): Stripe.Event {
  return {
    id: eventId,
    type,
    livemode: false,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        amount_total: Math.round(parseFloat(booking.total_amount) * 100),
        currency: 'usd',
        payment_status: 'paid',
        payment_intent: `pi_${sessionId}`,
        metadata: { bookingId: booking.id, holdId },
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

beforeAll(async () => {
  ids = await seedCatalog(pg);
});

// ---------------------------------------------------------------------------

describe('availability and double-booking protection', () => {
  it('the database rejects two overlapping room-holding bookings, whatever wrote them', async () => {
    const customer = await upsertCustomer(db, { email: 'raw@example.com', firstName: 'Raw' });
    const base = {
      customer_id: customer.id,
      service_id: ids['Podcast Pro'],
      booking_date: '2030-02-04',
      duration_minutes: 60,
      customer_first_name: 'R',
      customer_last_name: 'W',
      customer_email: 'raw@example.com',
      customer_phone: '1',
      status: 'confirmed' as const,
      subtotal: '0',
      tax_amount: '0',
      total_amount: '0',
    };
    await db.insert(schema.bookings).values({ ...base, booking_id: 'ZAY-RAW1', start_time: '10:00', end_time: '11:00' });
    await expect(
      db.insert(schema.bookings).values({ ...base, booking_id: 'ZAY-RAW2', start_time: '10:30', end_time: '11:30' })
    ).rejects.toMatchObject({ code: '23P01' });
    // Touching edges are fine, and cancelled bookings don't hold the room.
    await db.insert(schema.bookings).values({ ...base, booking_id: 'ZAY-RAW3', start_time: '11:00', end_time: '12:00' });
    await db.insert(schema.bookings).values({ ...base, booking_id: 'ZAY-RAW4', start_time: '10:15', end_time: '10:45', status: 'cancelled' });
  });

  it('two concurrent staff bookings for the same slot: exactly one wins', async () => {
    const make = (email: string) =>
      createManualBooking(
        { serviceId: ids['Podcast Pro'], date: '2030-02-05', startTime: '14:00', customer: { email, firstName: 'C' }, payment: { mode: 'unpaid' } },
        actor
      );
    const results = await Promise.allSettled([make('one@example.com'), make('two@example.com')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.status).toBe(409);
    expect(await count('bookings', `booking_date = '2030-02-05' AND status = 'confirmed'`)).toBe(1);
  });

  it('an active public hold blocks staff and other customers from the same slot', async () => {
    await startCheckout('2030-02-06', '10:00');
    await expect(
      createManualBooking(
        { serviceId: ids['Headshot Session'], date: '2030-02-06', startTime: '10:30', customer: { email: 'x@example.com', firstName: 'X' }, payment: { mode: 'unpaid' } },
        actor
      )
    ).rejects.toMatchObject({ status: 409 });
    const res = await holdRoute.POST(
      post('/api/booking/create-hold', {
        customer_email: 'other@example.com',
        service_id: ids['Headshot Session'],
        booking_date: '2030-02-06',
        start_time: '10:30',
        end_time: '11:15',
        duration_minutes: 45,
      })
    );
    expect(res.status).toBe(409);
  });

  it('blocked time is evaluated in New York time (not UTC) and closes public slots', async () => {
    // Owner blocks 13:00–15:00 ET on a summer day (EDT, UTC-4).
    await db.insert(schema.blockedTimes).values({
      start_datetime: new Date('2030-07-01T17:00:00Z'),
      end_datetime: new Date('2030-07-01T19:00:00Z'),
      reason: 'Maintenance',
    });
    const slots = await getAvailableTimeSlotsForDate('2030-07-01', 60);
    const free = (t: string) => slots.find((s) => s.start === t)?.available;
    expect(free('12:00')).toBe(true);
    expect(free('12:30')).toBe(false);
    expect(free('13:00')).toBe(false);
    expect(free('14:30')).toBe(false);
    expect(free('15:00')).toBe(true);
  });

  it('applies buffers before and after bookings', async () => {
    await db.update(schema.businessSettings).set({ setting_value: '15' }).where(eq(schema.businessSettings.setting_key, 'buffer_after_booking'));
    await createManualBooking(
      { serviceId: ids['Podcast Pro'], date: '2030-02-07', startTime: '10:00', customer: { email: 'buf@example.com', firstName: 'B' }, payment: { mode: 'comp' } },
      actor
    );
    expect(await isSlotActuallyAvailable('2030-02-07', '11:00', '12:00', 60)).toBe(false); // inside the 15-min buffer
    expect(await isSlotActuallyAvailable('2030-02-07', '11:30', '12:30', 60)).toBe(true);
    await db.update(schema.businessSettings).set({ setting_value: '0' }).where(eq(schema.businessSettings.setting_key, 'buffer_after_booking'));
  });

  it('enforces the booking cutoff for customers but not for staff', async () => {
    const now = new Date('2030-03-04T15:10:00Z'); // 10:10 ET (EST)
    const slots = await getAvailableTimeSlotsForDate('2030-03-04', 60, db, { now });
    // 1 hour notice → the first bookable slot is 11:30 on the 30-minute grid.
    expect(slots.find((s) => s.start === '11:00')).toBeUndefined();
    expect(slots[0].start).toBe('11:30');
    const staff = await getAvailableTimeSlotsForDate('2030-03-04', 60, db, { now, ignoreCutoff: true });
    expect(staff[0].start).toBe('08:00');
  });

  it('generates correct wall-clock slots on both DST transition days', async () => {
    for (const date of ['2030-03-10', '2030-11-03']) {
      const slots = await getAvailableTimeSlotsForDate(date, 60, db, { now: new Date('2030-01-01T00:00:00Z') });
      expect(slots[0]).toMatchObject({ start: '08:00', end: '09:00' });
      expect(slots[slots.length - 1]).toMatchObject({ start: '21:00', end: '22:00' });
      expect(slots).toHaveLength(27);
    }
    const { booking } = await createManualBooking(
      { serviceId: ids['Podcast Pro'], date: '2030-03-10', startTime: '10:00', customer: { email: 'dst@example.com', firstName: 'D' }, payment: { mode: 'comp' } },
      actor
    );
    const row = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    expect(new Date(row.starts_at).toISOString()).toBe('2030-03-10T14:00:00.000Z'); // EDT already in force
  });

  it('reschedules into a free slot, never onto another booking', async () => {
    const a = await createManualBooking(
      { serviceId: ids['Podcast Pro'], date: '2030-02-11', startTime: '09:00', customer: { email: 'r1@example.com', firstName: 'R' }, payment: { mode: 'comp' } },
      actor
    );
    await createManualBooking(
      { serviceId: ids['Podcast Pro'], date: '2030-02-11', startTime: '12:00', customer: { email: 'r2@example.com', firstName: 'R' }, payment: { mode: 'comp' } },
      actor
    );
    await expect(rescheduleBooking(a.booking.id, { date: '2030-02-11', startTime: '11:30' }, actor)).rejects.toMatchObject({ status: 409 });
    // Moving 30 minutes later overlaps its own old slot — allowed.
    const moved = await rescheduleBooking(a.booking.id, { date: '2030-02-11', startTime: '09:30' }, actor);
    expect(moved.booking.start_time).toBe('09:30');
    const audit = await count('audit_logs', `operation = 'booking.reschedule' AND entity_id = '${a.booking.id}'`);
    expect(audit).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('Stripe webhook', () => {
  it('confirms once: duplicate deliveries create no second booking, purchase or email', async () => {
    const { booking, sessionId, holdId } = await startCheckout('2030-02-12', '10:00');
    expect(booking.status).toBe('payment_pending');
    const event = checkoutEvent(booking, sessionId, holdId);

    const first = await processStripeEvent(event);
    expect(first).toMatchObject({ httpStatus: 200, body: { status: 'booking_confirmed' } });
    const second = await processStripeEvent(event);
    expect(second).toMatchObject({ httpStatus: 200, body: { duplicate: true } });

    const confirmed = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    expect(confirmed).toMatchObject({ status: 'confirmed', payment_status: 'succeeded', stripe_payment_id: `pi_${sessionId}` });
    const purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, confirmed.purchase_id) });
    expect(purchase).toMatchObject({ status: 'paid', total_cents: 21775, stripe_payment_intent_id: `pi_${sessionId}` });
    expect(await count('purchases', `stripe_checkout_session_id = '${sessionId}'`)).toBe(1);
    expect(await count('webhook_events', `external_event_id = '${event.id}'`)).toBe(1);
    expect(await count('email_logs', `booking_id = '${booking.id}' AND template = 'booking_confirmation'`)).toBe(1);
    // A *different* event for the same session (Stripe resends) is also a no-op.
    const again = await processStripeEvent(checkoutEvent(booking, sessionId, holdId));
    expect(again.body).toMatchObject({ status: 'already_processed' });
  });

  it('checks the payment against the price at checkout, not the current service price', async () => {
    const { booking, sessionId, holdId } = await startCheckout('2030-02-13', '10:00');
    await db.update(schema.services).set({ base_price: '999.00' }).where(eq(schema.services.id, ids['Podcast Pro']));
    const result = await processStripeEvent(checkoutEvent(booking, sessionId, holdId));
    await db.update(schema.services).set({ base_price: '200.00' }).where(eq(schema.services.id, ids['Podcast Pro']));
    expect(result.body).toMatchObject({ status: 'booking_confirmed' });
    // The historical line item still says $200.
    const item = await pg.query<{ unit_price_cents: number }>(
      `SELECT unit_price_cents FROM purchase_items i JOIN bookings b ON b.purchase_id = i.purchase_id WHERE b.id = '${booking.id}'`
    );
    expect(item.rows[0].unit_price_cents).toBe(20000);
  });

  it('never confirms a booking an admin cancelled before the payment landed', async () => {
    const { booking, sessionId, holdId } = await startCheckout('2030-02-14', '10:00');
    const cancelled = await cancelBooking(booking.id, actor, { reason: 'Customer asked' });
    expect(cancelled.ok).toBe(true);
    const result = await processStripeEvent(checkoutEvent(booking, sessionId, holdId));
    expect(result.body).toMatchObject({ status: 'needs_review' });
    const row = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    expect(row).toMatchObject({ status: 'cancelled', payment_status: 'succeeded', needs_refund_review: true });
    const purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, row.purchase_id) });
    expect(purchase).toMatchObject({ status: 'paid', needs_refund_review: true });
  });

  it('flags a payment whose slot was taken after the hold expired', async () => {
    const { booking, sessionId, holdId } = await startCheckout('2030-02-18', '10:00');
    // Hold expires; staff books the same time.
    await pg.query(`UPDATE temporary_holds SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`, [holdId]);
    await createManualBooking(
      { serviceId: ids['Podcast Pro'], date: '2030-02-18', startTime: '10:00', customer: { email: 'walkin@example.com', firstName: 'W' }, payment: { mode: 'comp' } },
      actor
    );
    const result = await processStripeEvent(checkoutEvent(booking, sessionId, holdId));
    expect(result.body).toMatchObject({ status: 'needs_review' });
    const row = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    expect(row).toMatchObject({ status: 'cancelled', payment_status: 'succeeded', needs_refund_review: true });
    expect(await count('bookings', `booking_date = '2030-02-18' AND status = 'confirmed'`)).toBe(1);
  });

  it('waits for delayed payment methods, then confirms on async success', async () => {
    const { booking, sessionId, holdId } = await startCheckout('2030-02-19', '10:00');
    const pending = await processStripeEvent(checkoutEvent(booking, sessionId, holdId, { payment_status: 'unpaid' }));
    expect(pending.body).toMatchObject({ status: 'awaiting_async_payment' });
    expect((await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) })).status).toBe('payment_pending');
    const ok = await processStripeEvent(checkoutEvent(booking, sessionId, holdId, {}, 'checkout.session.async_payment_succeeded'));
    expect(ok.body).toMatchObject({ status: 'booking_confirmed' });
  });

  it('releases the booking when the async payment fails', async () => {
    const { booking, sessionId, holdId } = await startCheckout('2030-02-20', '10:00');
    const failed = await processStripeEvent(checkoutEvent(booking, sessionId, holdId, {}, 'checkout.session.async_payment_failed'));
    expect(failed.body).toMatchObject({ status: 'released' });
    const row = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    expect(row).toMatchObject({ status: 'cancelled', payment_status: 'failed' });
    expect(await isSlotActuallyAvailable('2030-02-20', '10:00', '11:00', 60)).toBe(true);
  });

  it('records a failed handler and lets the retry succeed', async () => {
    const event = checkoutEvent({ id: '00000000-0000-4000-8000-00000000dead', total_amount: '10.00' }, 'cs_missing', 'hold-x');
    const failed = await processStripeEvent(event);
    expect(failed.httpStatus).toBe(500);
    const row = await db.query.webhookEvents.findFirst({ where: eq(schema.webhookEvents.external_event_id, event.id) });
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
    expect(JSON.stringify(row.safe_payload)).not.toMatch(/Lovelace|@example/);
  });
});

// ---------------------------------------------------------------------------

describe('refunds', () => {
  async function paidBooking(date: string) {
    const { booking, sessionId, holdId } = await startCheckout(date, '10:00');
    await processStripeEvent(checkoutEvent(booking, sessionId, holdId));
    return db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
  }

  it('partial then full refund, with an idempotency key, and never more than was paid', async () => {
    const booking = await paidBooking('2030-02-21');
    let n = 0;
    h.refundCreate = vi.fn(async (params: any) => ({ id: `re_${++n}`, status: 'succeeded', amount: params.amount }));

    const before = await refundableCents(db, booking.purchase_id);
    expect(before.available).toBe(21775);
    await expect(
      issueRefund({ purchaseId: booking.purchase_id, amountCents: 5000, reason: 'Late start', expectedAvailableCents: 1 }, actor)
    ).rejects.toMatchObject({ status: 409 }); // stale dialog
    await expect(
      issueRefund({ purchaseId: booking.purchase_id, amountCents: 30000, reason: 'Too much', expectedAvailableCents: 21775 }, actor)
    ).rejects.toMatchObject({ status: 400 });

    const partial = await issueRefund({ purchaseId: booking.purchase_id, amountCents: 5000, reason: 'Late start', expectedAvailableCents: 21775 }, actor);
    expect(partial.refund.status).toBe('succeeded');
    expect(h.refundCreate.mock.calls[0][1]).toEqual({ idempotencyKey: `zayro-refund-${partial.refund.id}` });
    let purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, booking.purchase_id) });
    expect(purchase).toMatchObject({ status: 'partially_refunded', refunded_cents: 5000 });
    expect((await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) })).payment_status).toBe('partially_refunded');

    await issueRefund({ purchaseId: booking.purchase_id, amountCents: 16775, reason: 'Cancelled', expectedAvailableCents: 16775, cancelBooking: true }, actor);
    purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, booking.purchase_id) });
    expect(purchase).toMatchObject({ status: 'refunded', refunded_cents: 21775 });
    const row = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    expect(row).toMatchObject({ status: 'cancelled', payment_status: 'refunded' });
    await expect(
      issueRefund({ purchaseId: booking.purchase_id, amountCents: 1, reason: 'More', expectedAvailableCents: 0 }, actor)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('keeps a failed Stripe refund visible and the payment untouched', async () => {
    const booking = await paidBooking('2030-02-25');
    h.refundCreate = vi.fn(async () => {
      throw new Error('card_declined');
    });
    const result = await issueRefund({ purchaseId: booking.purchase_id, amountCents: 1000, reason: 'Test', expectedAvailableCents: 21775 }, actor);
    expect(result.refund).toMatchObject({ status: 'failed' });
    const purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, booking.purchase_id) });
    expect(purchase).toMatchObject({ status: 'paid', refunded_cents: 0 });
  });

  it('reconciles a refund made in the Stripe Dashboard from charge.refunded', async () => {
    const booking = await paidBooking('2030-02-26');
    const event = {
      id: `evt_charge_${booking.id}`,
      type: 'charge.refunded',
      livemode: false,
      data: {
        object: {
          id: 'ch_1',
          object: 'charge',
          amount_refunded: 2000,
          refunds: { data: [{ id: 're_dash_1', object: 'refund', amount: 2000, status: 'succeeded', payment_intent: booking.stripe_payment_id, metadata: {} }] },
        },
      },
    } as unknown as Stripe.Event;
    await processStripeEvent(event);
    await processStripeEvent({ ...event, id: `${event.id}_dup` } as Stripe.Event);
    const purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, booking.purchase_id) });
    expect(purchase).toMatchObject({ status: 'partially_refunded', refunded_cents: 2000 });
    expect(await count('refunds', `stripe_refund_id = 're_dash_1'`)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('package credits', () => {
  it('grant → redeem → restore, never below zero, one redeem per booking', async () => {
    const customer = await upsertCustomer(db, { email: 'member@example.com', firstName: 'Mem' });
    const plan = await db.query.packagePlans.findFirst({ where: eq(schema.packagePlans.name, '2 Sessions per Month') });
    // On a fresh database the plans have no eligible-service item yet; make Podcast Pro eligible.
    await db.insert(schema.packagePlanItems).values({ plan_id: plan.id, service_id: ids['Podcast Pro'], credits: 2 }).onConflictDoNothing();

    const pkg = await assignPackage({ customerId: customer.id, planId: plan.id, payment: { mode: 'offline_paid', method: 'cash' } }, actor);
    expect(pkg).toMatchObject({ total_credits: 2, remaining_credits: 2, status: 'active' });
    const purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, pkg.purchase_id!) });
    expect(purchase).toMatchObject({ type: 'package', status: 'paid', subtotal_cents: 36000 });

    // Sessions must fall inside the 30-day validity window.
    const soon = (n: number) => addDays(todayInTz(), n);
    const book = (date: string, serviceName = 'Podcast Pro') =>
      createManualBooking(
        { serviceId: ids[serviceName], date, startTime: '16:00', customer: { customerId: customer.id }, payment: { mode: 'package', customerPackageId: pkg.id } },
        actor
      );
    const s1 = await book(soon(3));
    await book(soon(4));
    await expect(book(soon(5))).rejects.toThrow(/No credits left|exhausted/);
    await expect(book(soon(6), 'Headshot Session')).rejects.toThrow(/does not cover|exhausted/);

    let row = await db.query.customerPackages.findFirst({ where: eq(schema.customerPackages.id, pkg.id) });
    expect(row).toMatchObject({ remaining_credits: 0, status: 'exhausted' });

    // Duplicate redemption for the same booking is impossible at the DB level.
    await expect(
      pg.query(
        `INSERT INTO package_credit_transactions (customer_package_id, booking_id, type, credits, balance_after) VALUES ($1, $2, 'redeem', -1, 0)`,
        [pkg.id, s1.booking.id]
      )
    ).rejects.toThrow(/package_credit_one_redeem_per_booking/);
    // And the balance can't go negative.
    await expect(pg.query(`UPDATE customer_packages SET remaining_credits = -1 WHERE id = $1`, [pkg.id])).rejects.toThrow(/customer_packages_credits_check/);

    const cancel = await cancelBooking(s1.booking.id, actor, { reason: 'Rescheduling later' });
    expect(cancel.ok && cancel.creditRestored.restored).toBe(true);
    row = await db.query.customerPackages.findFirst({ where: eq(schema.customerPackages.id, pkg.id) });
    expect(row).toMatchObject({ remaining_credits: 1, status: 'active' });
    const ledger = await pg.query<{ type: string; credits: number; balance_after: number }>(
      `SELECT type, credits, balance_after FROM package_credit_transactions WHERE customer_package_id = $1 ORDER BY created_at, balance_after DESC`,
      [pkg.id]
    );
    expect(ledger.rows.map((r) => r.type)).toEqual(['grant', 'redeem', 'redeem', 'restore']);

    await expect(adjustCredits(pkg.id, -5, 'Oops', actor)).rejects.toThrow(/Only 1 credits left/);
    await adjustCredits(pkg.id, 1, 'Goodwill', actor);
    row = await db.query.customerPackages.findFirst({ where: eq(schema.customerPackages.id, pkg.id) });
    expect(row).toMatchObject({ remaining_credits: 2, total_credits: 3 });
  });

  it('expires unused credits after the validity window', async () => {
    const customer = await upsertCustomer(db, { email: 'expiring@example.com', firstName: 'Ex' });
    const plan = await db.query.packagePlans.findFirst({ where: eq(schema.packagePlans.name, '4 Sessions per Month') });
    const pkg = await assignPackage({ customerId: customer.id, planId: plan.id, startsAt: new Date('2020-01-01T00:00:00Z'), payment: { mode: 'comp' } }, actor);
    await expireDuePackages();
    const row = await db.query.customerPackages.findFirst({ where: eq(schema.customerPackages.id, pkg.id) });
    expect(row).toMatchObject({ status: 'expired', remaining_credits: 0 });
    expect(await count('package_credit_transactions', `customer_package_id = '${pkg.id}' AND type = 'expire' AND credits = -4`)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('customers', () => {
  it('upserts by normalised email: one customer per person', async () => {
    const a = await upsertCustomer(db, { email: 'Jane.Doe@Example.com ', firstName: 'Jane' });
    const b = await upsertCustomer(db, { email: 'jane.doe@example.com', firstName: 'Janet', phone: '2125550100' }, { updateContact: true });
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ first_name: 'Janet', phone: '2125550100' });
    const [c1, c2] = await Promise.all([
      upsertCustomer(db, { email: 'race@example.com' }),
      upsertCustomer(db, { email: 'RACE@example.com' }),
    ]);
    expect(c1.id).toBe(c2.id);
  });

  it('merges a duplicate only with the exact confirmation, moving its records', async () => {
    // With the live-unique index a second live customer per email is impossible…
    await expect(pg.query(`INSERT INTO customers (email) VALUES ('Jane.DOE@example.com')`)).rejects.toThrow(/customers_normalized_email_live_unique/);
    // …but a database that already had duplicates when 0007 ran has no such
    // index (the migration skips it). Simulate that legacy state.
    await pg.query(`DROP INDEX customers_normalized_email_live_unique`);
    await pg.query(`INSERT INTO customers (email, first_name) VALUES ('Dup@Example.com', 'Dup'), ('dup@example.com', 'Dup')`);
    const rows = await pg.query<{ id: string; email: string }>(`SELECT id, email FROM customers WHERE normalized_email = 'dup@example.com' ORDER BY email DESC`);
    const [primary, duplicate] = rows.rows;
    await pg.query(
      `INSERT INTO customer_notes (customer_id, body) VALUES ($1, 'VIP')`,
      [duplicate.id]
    );
    const preview = await previewMerge(primary.id, duplicate.id);
    expect(preview?.emailsMatch).toBe(true);
    expect(preview?.moves.notes).toBe(1);
    expect(await mergeCustomers(primary.id, duplicate.id, 'MERGE', actor)).toMatchObject({ ok: false, status: 400 });
    const merged = await mergeCustomers(primary.id, duplicate.id, preview!.confirmationPhrase, actor);
    expect(merged.ok).toBe(true);
    expect(await count('customer_notes', `customer_id = '${primary.id}'`)).toBe(1);
    const dup = await db.query.customers.findFirst({ where: eq(schema.customers.id, duplicate.id) });
    expect(dup).toMatchObject({ status: 'merged', merged_into_id: primary.id });
    // New bookings for the merged address land on the surviving customer.
    const again = await upsertCustomer(db, { email: 'dup@example.com' });
    expect(again.id).toBe(primary.id);
    // Different people need the longer phrase.
    const other = await upsertCustomer(db, { email: 'someone-else@example.com' });
    const p2 = await previewMerge(primary.id, other.id);
    expect(p2?.confirmationPhrase).toMatch(/^MERGE DIFFERENT PEOPLE/);
  });
});

// ---------------------------------------------------------------------------

describe('staff sign-in, roles and permissions', () => {
  it('bootstraps an ADMIN_EMAILS owner once and only once', async () => {
    const [a, b] = await Promise.all([resolveAdminProfile('Owner@Zayro.Test'), resolveAdminProfile('owner@zayro.test')]);
    expect(a?.role.name).toBe('Owner');
    expect(b?.profile.id).toBe(a?.profile.id);
    expect(await count('admin_profiles', `normalized_email = 'owner@zayro.test'`)).toBe(1);
    expect(await resolveAdminProfile('random@example.com')).toBeNull();
  });

  it('a magic link works once', async () => {
    const token = createLoginToken('owner@zayro.test');
    expect(await consumeLoginToken(token)).toMatchObject({ ok: true });
    expect(await consumeLoginToken(token)).toMatchObject({ ok: false, reason: 'already_used' });
    expect(await count('audit_logs', `operation = 'auth.login'`)).toBeGreaterThanOrEqual(1);
  });

  it('checks permissions on the server and audits denials', async () => {
    const producer = await db.query.roles.findFirst({ where: eq(schema.roles.name, 'Producer') });
    await db.insert(schema.adminProfiles).values({ email: 'prod@zayro.test', normalized_email: 'prod@zayro.test', role_id: producer.id });
    h.sessionToken = createSessionToken('prod@zayro.test');
    const req = (method: string, headers: Record<string, string> = {}) =>
      new NextRequest('http://localhost/api/admin/x', { method, headers: { host: 'localhost', ...headers } });

    expect((await requirePermission(req('GET'), 'bookings.read')).ok).toBe(true);
    const denied = await requirePermission(req('POST'), 'bookings.refund');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(403);
    expect(await count('audit_logs', `operation = 'auth.permission_denied' AND actor_email = 'prod@zayro.test'`)).toBe(1);

    const csrf = await requirePermission(req('POST', { origin: 'https://evil.example' }), 'bookings.read');
    expect(csrf.ok).toBe(false);
    if (!csrf.ok) expect(csrf.response.status).toBe(403);

    await db.update(schema.adminProfiles).set({ status: 'disabled' }).where(eq(schema.adminProfiles.normalized_email, 'prod@zayro.test'));
    const disabled = await requirePermission(req('GET'), 'bookings.read');
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.response.status).toBe(401);

    h.sessionToken = null;
    const anon = await requirePermission(req('GET'), 'bookings.read');
    expect(anon.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('money and history', () => {
  it('purchase line items are immutable snapshots', async () => {
    const item = await pg.query<{ id: string }>(`SELECT id FROM purchase_items LIMIT 1`);
    await expect(pg.query(`UPDATE purchase_items SET unit_price_cents = 1 WHERE id = $1`, [item.rows[0].id])).rejects.toThrow(/immutable/);
    await expect(pg.query(`DELETE FROM purchase_items WHERE id = $1`, [item.rows[0].id])).rejects.toThrow(/immutable/);
  });

  it('free studio tour: confirmed without Stripe, $0 approved purchase, source studio_tour', async () => {
    const tour = ids['Free Studio Tour'];
    const holdRes = await holdRoute.POST(
      post('/api/booking/create-hold', { customer_email: 'visitor@example.com', service_id: tour, booking_date: '2030-02-27', start_time: '12:00', end_time: '12:30', duration_minutes: 30 })
    );
    const hold = await holdRes.json();
    const res = await freeRoute.POST(
      post('/api/booking/confirm-free', { holdId: hold.hold_id, firstName: 'Vi', lastName: 'Sitor', email: 'visitor@example.com', phone: '+1 212 555 0101' })
    );
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    const booking = await bookingByCode(body.bookingId);
    expect(booking).toMatchObject({ status: 'confirmed', source: 'studio_tour', total_amount: '0.00' });
    const purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, booking.purchase_id) });
    expect(purchase).toMatchObject({ type: 'studio_tour', status: 'approved', total_cents: 0 });
  });

  it('manual unpaid booking can be marked paid; completion needs a started session', async () => {
    const { booking } = await createManualBooking(
      { serviceId: ids['Podcast Pro'], date: '2030-03-01', startTime: '10:00', customer: { email: 'cash@example.com', firstName: 'Cash' }, payment: { mode: 'unpaid' } },
      actor
    );
    expect(booking.payment_status).toBe('pending');
    await markPurchasePaid(booking.purchase_id!, 'cash', actor);
    const paid = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    expect(paid.payment_status).toBe('succeeded');
    await expect(setBookingOutcome(booking.id, 'completed', actor)).rejects.toThrow(/not started/);
    await pg.query(`UPDATE bookings SET booking_date = '2020-01-06' WHERE id = $1`, [booking.id]);
    const done = await setBookingOutcome(booking.id, 'completed', actor);
    expect(done.status).toBe('completed');
    const customer = await db.query.customers.findFirst({ where: eq(schema.customers.id, booking.customer_id) });
    expect(customer).toMatchObject({ booking_count: 1, total_spent_cents: 21775 });
  });

  it('every CRM mutation above left an audit trail without secrets', async () => {
    const ops = await pg.query<{ operation: string }>(`SELECT DISTINCT operation FROM audit_logs ORDER BY 1`);
    const names = ops.rows.map((r) => r.operation);
    for (const op of ['booking.create_manual', 'booking.cancel', 'booking.reschedule', 'refund.request', 'package.assign', 'package.adjust', 'customer.merge', 'purchase.mark_paid', 'booking.mark_completed']) {
      expect(names).toContain(op);
    }
    const dump = await pg.query<{ t: string }>(`SELECT coalesce(string_agg(before_data::text || after_data::text || metadata::text, ' '), '') AS t FROM audit_logs`);
    expect(dump.rows[0].t).not.toMatch(/test-secret|sk_|whsec_/);
  });
});

