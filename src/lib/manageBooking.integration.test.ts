/**
 * Customer self-service (Manage Booking) against a real Postgres (PGlite,
 * every migration) and a fake Stripe that keeps Checkout and refund state.
 * Google is not configured and Resend is off, so Calendar/Sheets/email
 * attempts are logged as failed/skipped — exactly the "integration failure"
 * path: the booking and money must stay correct and retryable.
 * No live Stripe, no real email, no real Calendar or Sheets.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { withPolicy } from '@/test/policy';

const h = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.NEXTAUTH_SECRET = 'test-secret';
  return {
    sessions: new Map<string, any>(),
    refunds: [] as { params: any; key: string | undefined }[],
    failRefunds: false,
    refundStatus: 'pending' as string,
    counter: 0,
  };
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
          const id = `cs_test_mb${++h.counter}`;
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
    refunds = {
      create: async (params: any, opts?: { idempotencyKey?: string }) => {
        if (h.failRefunds) throw new Error('Your card was declined for refunds (test)');
        // Stripe idempotency: the same key returns the same refund.
        const existing = h.refunds.find((r) => r.key && r.key === opts?.idempotencyKey);
        h.refunds.push({ params, key: opts?.idempotencyKey });
        const n = existing ? h.refunds.indexOf(existing) : h.refunds.length - 1;
        return { id: `re_test_${n}`, object: 'refund', status: h.refundStatus, amount: params.amount, payment_intent: params.payment_intent, metadata: params.metadata, failure_reason: null };
      },
      list: async () => ({ data: [] }),
    };
    webhooks = { constructEvent: () => ({}) };
    events = { retrieve: async () => ({}) };
  },
}));

delete process.env.RESEND_API_KEY;
delete process.env.GOOGLE_CALENDAR_EMAIL;

const { db, pg } = (await import('@/lib/db')) as unknown as { db: any; pg: import('@electric-sql/pglite').PGlite };
const schema = await import('@/lib/db/schema');
const { seedCatalog } = await import('@/test/pgliteDb');
const { processStripeEvent } = await import('@/lib/crm/webhook');
const MB = await import('./manageBooking');
const T = await import('./manageToken');
const { wallTimeToUtc } = await import('./crm/time');
const { getPublicSetups } = await import('./setupCatalog');
const { listSetupsForCategory } = await import('./bookingQuote');
const holdRoute = await import('@/app/api/booking/create-hold/route');
const checkoutRoute = await import('@/app/api/payment/create-checkout-session/route');
const viewRoute = await import('@/app/api/booking/manage/view/route');

let ids: Record<string, number>;
let ip = 0;

function post(url: string, body: unknown, policy = true) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(policy ? withPolicy(url, body) : body),
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.9.${Math.floor(++ip / 250)}.${ip % 250}` },
  });
}

async function count(table: string, where = 'true'): Promise<number> {
  return (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`)).rows[0].n;
}

function endOf(start: string, minutes: number) {
  const total = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function addonId(slug: string): Promise<number> {
  return (await pg.query<{ id: number }>('SELECT id FROM service_addons WHERE slug = $1', [slug])).rows[0].id;
}

function paidEvent(sessionId: string, type: Stripe.Event['type'] = 'checkout.session.completed'): Stripe.Event {
  const s = h.sessions.get(sessionId);
  s.status = 'complete';
  s.payment_status = 'paid';
  s.payment_intent = `pi_${sessionId}`;
  return { id: `evt_${sessionId}_${type}`, type, livemode: false, data: { object: { ...s } } } as unknown as Stripe.Event;
}

function expiredEvent(sessionId: string): Stripe.Event {
  const s = h.sessions.get(sessionId);
  s.status = 'expired';
  return { id: `evt_${sessionId}_expired`, type: 'checkout.session.expired', livemode: false, data: { object: { ...s } } } as unknown as Stripe.Event;
}

/** A real paid booking: hold → Checkout → webhook. Returns the booking and its Manage Booking token. */
async function paidBooking(date: string, start: string, opts: { hours?: number; addons?: { id: number; quantity: number }[]; service?: string; email?: string } = {}) {
  const service = ids[opts.service ?? 'Podcast Pro'];
  const hours = opts.hours ?? 1;
  const email = opts.email ?? `c${++ip}@example.com`;
  const setupId = (await pg.query<{ id: number }>("SELECT id FROM setups WHERE slug = 'sofa-lounge'")).rows[0].id;
  const hold = await holdRoute.POST(
    post('/api/booking/create-hold', {
      customer_email: email,
      service_id: service,
      booking_date: date,
      start_time: start,
      end_time: endOf(start, hours * 60),
      duration_minutes: hours * 60,
      hours,
      setup_id: setupId,
      addons: opts.addons ?? [],
    })
  );
  const holdBody = await hold.json();
  expect(hold.status, JSON.stringify(holdBody)).toBe(200);
  const res = await checkoutRoute.POST(
    post('/api/payment/create-checkout-session', {
      holdId: holdBody.hold_id,
      firstName: 'Test',
      lastName: 'Customer',
      email,
      phone: '+1 212 555 0100',
      intake: { peopleRecording: 2, recordingType: 'Podcast', editing: 'no', guests: [{ email: 'guest@example.com', name: 'Guest' }] },
    })
  );
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  const out = await processStripeEvent(paidEvent(body.sessionId));
  expect(out.httpStatus).toBe(200);
  const booking = await db.query.bookings.findFirst({ where: eq(schema.bookings.stripe_session_id, body.sessionId) });
  expect(booking.status).toBe('confirmed');
  const token = await T.ensureManageToken(booking.id);
  return { booking, token: token!, email };
}

/** A clock ten days before `date`: inside the public booking horizon, outside the 24-hour window. */
function soonBefore(date: string): Date {
  return new Date(wallTimeToUtc(date, '09:00').getTime() - 10 * 86400e3);
}

async function fresh(id: string) {
  return db.query.bookings.findFirst({ where: eq(schema.bookings.id, id) });
}

beforeAll(async () => {
  ids = await seedCatalog(pg);
});

beforeEach(() => {
  h.failRefunds = false;
  h.refundStatus = 'pending';
});

// ---------------------------------------------------------------------------

describe('setup catalog', () => {
  it('the homepage shows exactly the booking catalog, with stable slugs and deep links', async () => {
    const booking = await listSetupsForCategory('podcast');
    const home = await getPublicSetups('podcast');
    expect(home.map((s) => s.slug)).toEqual(booking.map((s) => s.slug));
    expect(home.map((s) => s.name)).toEqual(['Sofa Lounge', 'Conversation Corner', 'Conference Table Setup', 'Bookshelf Setup']);
    expect(home.map((s) => s.capacity)).toEqual(booking.map((s) => s.capacity));
    for (const s of home) {
      expect(s.bookingHref).toBe(`/booking?category=podcast&setup=${s.slug}`);
      expect(s.image).toMatch(/^\/setups\/.+\.webp$/);
    }
    // Retired setups never show.
    expect(home.map((s) => s.slug)).not.toContain('cream-lounge');
  });

  it('an inactive setup disappears from the homepage and the booking choice', async () => {
    await pg.query("UPDATE setups SET active = false WHERE slug = 'bookshelf'");
    expect((await getPublicSetups('podcast')).map((s) => s.slug)).not.toContain('bookshelf');
    expect((await listSetupsForCategory('podcast')).map((s) => s.slug)).not.toContain('bookshelf');
    await pg.query("UPDATE setups SET active = true WHERE slug = 'bookshelf'");
  });

  it('the setups API returns slugs so the booking flow can preselect by slug', async () => {
    const route = await import('@/app/api/booking/setups/route');
    const res = await route.GET(new NextRequest(`http://localhost/api/booking/setups?service_id=${ids['Podcast Pro']}`));
    const list = await res.json();
    expect(list.map((s: any) => s.slug)).toContain('conversation-corner');
  });
});

describe('camera limit (server-side)', () => {
  async function tryHold(service: string, cameras: number, date: string) {
    const camera = await addonId('additional-camera');
    const res = await holdRoute.POST(
      post('/api/booking/create-hold', {
        customer_email: `cam${++ip}@example.com`,
        service_id: ids[service],
        booking_date: date,
        start_time: '10:00',
        end_time: '11:00',
        duration_minutes: 60,
        setup_id: (await pg.query<{ id: number }>("SELECT id FROM setups WHERE slug = 'bookshelf'")).rows[0].id,
        addons: [{ id: camera, quantity: cameras }],
      })
    );
    return { status: res.status, body: await res.json() };
  }

  it('Single Podcaster may add up to 2 cameras; Podcast Pro and Full Podcast Package none', async () => {
    // Test seed services get the same metadata 0017 sets on the real ones.
    await pg.query(`UPDATE services SET metadata = metadata || '{"includedCameras": 1}' WHERE name = 'Single Podcaster'`);
    await pg.query(`UPDATE services SET metadata = metadata || '{"includedCameras": 3}' WHERE name IN ('Podcast Pro', 'Full Podcast Package')`);
    expect((await tryHold('Single Podcaster', 2, '2031-07-07')).status).toBe(200);
    const three = await tryHold('Single Podcaster', 3, '2031-07-08');
    expect(three.status).toBe(400);
    expect(three.body.error).toMatch(/at most 2/);
    for (const name of ['Podcast Pro', 'Full Podcast Package']) {
      const r = await tryHold(name, 1, '2031-07-09');
      expect(r.status, name).toBe(400);
      expect(r.body.error).toMatch(/maximum number of cameras/);
    }
    const addonsRoute = await import('@/app/api/booking/addons/route');
    const list = async (name: string) => (await (await addonsRoute.GET(new NextRequest(`http://localhost/api/booking/addons?service_id=${ids[name]}`))).json()) as any[];
    expect((await list('Single Podcaster')).find((a) => a.name === 'Additional Camera')?.max_quantity).toBe(2);
    expect((await list('Podcast Pro')).some((a) => a.name === 'Additional Camera')).toBe(false);
    expect((await list('Full Podcast Package')).some((a) => a.name === 'Additional Camera')).toBe(false);
  });

  it('an old Podcast Pro booking with an extra camera keeps its snapshot; extra time does not charge the camera again', async () => {
    const camera = await addonId('additional-camera');
    // Simulate a booking sold before the 3-camera rule (Pro was then allowed an extra camera).
    await pg.query(`UPDATE services SET metadata = metadata || '{"includedCameras": 1}' WHERE name = 'Podcast Pro'`);
    const { booking } = await paidBooking('2031-07-14', '11:00', { addons: [{ id: camera, quantity: 1 }] });
    await pg.query(`UPDATE services SET metadata = metadata || '{"includedCameras": 3}' WHERE name = 'Podcast Pro'`);
    const items = (await pg.query<{ item_type: string; quantity: number }>(`SELECT item_type, quantity FROM purchase_items WHERE purchase_id = '${booking.purchase_id}'`)).rows;
    expect(items.some((i) => i.item_type === 'addon')).toBe(true);
    const view = await MB.buildManageView(await fresh(booking.id));
    expect(view.extension.options[0].subtotalCents).toBe(20000);
  });
});

describe('policy acknowledgment', () => {
  it('payment cannot start until the customer agrees to the policies; the booking stores the version', async () => {
    const date = '2031-01-06';
    const email = 'policy@example.com';
    const hold = await (await holdRoute.POST(
      post('/api/booking/create-hold', {
        customer_email: email,
        service_id: ids['Single Podcaster'],
        booking_date: date,
        start_time: '10:00',
        end_time: '11:00',
        duration_minutes: 60,
        setup_id: (await pg.query<{ id: number }>("SELECT id FROM setups WHERE slug = 'bookshelf'")).rows[0].id,
      })
    )).json();
    const body = { holdId: hold.hold_id, firstName: 'P', lastName: 'Q', email, phone: '+1 212 555 0100', intake: { peopleRecording: 1, recordingType: 'Podcast', editing: 'no' } };
    const refused = await checkoutRoute.POST(post('/api/payment/create-checkout-session', body, false));
    expect(refused.status).toBe(400);
    expect((await refused.json()).code).toBe('policy_required');
    const ok = await checkoutRoute.POST(post('/api/payment/create-checkout-session', { ...body, policyAccepted: true }));
    expect(ok.status).toBe(200);
    const b = await db.query.bookings.findFirst({ where: eq(schema.bookings.customer_email, email) });
    expect(b.policy_version).toBeTruthy();
    expect(b.policy_accepted_at).toBeTruthy();
  });
});

describe('Manage Booking token', () => {
  it('opens only its own booking; unknown, malformed and revoked links get the same answer', async () => {
    const { booking, token } = await paidBooking('2031-02-03', '10:00');
    const ok = await viewRoute.POST(post('/api/booking/manage/view', { token }));
    expect(ok.status).toBe(200);
    const view = (await ok.json()).booking;
    expect(view.reference).toBe(booking.booking_id);
    expect(view.setup).toBe('Sofa Lounge');
    expect(view.can).toMatchObject({ cancel: true, reschedule: true });
    expect(JSON.stringify(view)).not.toContain(token);

    const answers = [];
    for (const t of ['x'.repeat(43), 'not a token', booking.id, booking.booking_id, null]) {
      const res = await viewRoute.POST(post('/api/booking/manage/view', { token: t }));
      answers.push([res.status, (await res.json()).error]);
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0][0]).toBe(404);

    await T.revokeManageToken(booking.id);
    const revoked = await viewRoute.POST(post('/api/booking/manage/view', { token }));
    expect([revoked.status, (await revoked.json()).error]).toEqual(answers[0]);

    // Rotation issues a new link; the old one stays dead.
    const next = await T.rotateManageToken(booking.id);
    expect(next).not.toBe(token);
    expect((await viewRoute.POST(post('/api/booking/manage/view', { token: next }))).status).toBe(200);
    expect((await viewRoute.POST(post('/api/booking/manage/view', { token }))).status).toBe(404);
  });

  it('stores only a hash and a nonce; the same link is re-derived for a retried email', async () => {
    const { booking, token } = await paidBooking('2031-02-04', '10:00');
    const row = await fresh(booking.id);
    expect(row.manage_token_hash).toBe(T.hashManageToken(token));
    expect(row.manage_token_hash).not.toContain(token);
    expect(row.manage_token_nonce).not.toBe(token);
    expect(await T.ensureManageToken(booking.id)).toBe(token);
    expect(T.manageUrl(token)).toBe(`https://zayro.studio/booking/manage#t=${token}`);
  });

  it('an old booking without a token has no management access until one is issued', async () => {
    const { booking } = await paidBooking('2031-02-05', '10:00');
    await pg.query('UPDATE bookings SET manage_token_hash = NULL, manage_token_nonce = NULL WHERE id = $1', [booking.id]);
    expect(await T.bookingForToken(T.deriveManageToken(booking.id, 'guess'))).toBeNull();
    const issued = await T.ensureManageToken(booking.id);
    expect((await T.bookingForToken(issued))?.id).toBe(booking.id);
  });

  it('the confirmation email carries the manage link for the customer only, never for guests', async () => {
    const { booking } = await paidBooking('2031-02-06', '10:00');
    const logs = (await pg.query<{ template: string; recipient_type: string }>('SELECT template, recipient_type FROM email_logs WHERE booking_id = $1', [booking.id])).rows;
    expect(logs.some((l) => l.template === 'booking_confirmation' && l.recipient_type === 'customer')).toBe(true);
    expect(logs.some((l) => l.template === 'guest_invite' && l.recipient_type === 'guest')).toBe(true);
    const T2 = await import('./crm/emailTemplates');
    const guest = T2.guestInvite({ hostName: 'Host', serviceName: 'Podcast Pro', date: '2031-02-06', startTime: '10:00', endTime: '11:00', address: 'x', contactEmail: 'y', isTour: false });
    expect(guest.html).not.toContain('/booking/manage');
  });
});

describe('cancellation and refund', () => {
  it('24 hours or more ahead: cancels, refunds the full amount once, frees the slot', async () => {
    const { booking, token } = await paidBooking('2031-03-03', '10:00');
    const before = h.refunds.length;
    const result = await MB.cancelByCustomer(token);
    expect(result.cancelled).toBe(true);
    const b = await fresh(booking.id);
    expect(b.status).toBe('cancelled');
    expect(b.needs_refund_review).toBe(false);
    const refunds = await db.query.refunds.findMany({ where: eq(schema.refunds.booking_id, booking.id) });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ source: 'customer', status: 'pending', amount_cents: 21775 });
    expect(h.refunds.length - before).toBe(1);
    expect(h.refunds[h.refunds.length - 1].params.reason).toBe('requested_by_customer');
    expect(h.refunds[h.refunds.length - 1].key).toBe(`zayro-refund-${refunds[0].id}`);

    // Double click / refresh / retry: nothing new.
    await MB.cancelByCustomer(token);
    await Promise.all([MB.cancelByCustomer(token), MB.cancelByCustomer(token)]);
    expect(await count('refunds', `booking_id = '${booking.id}'`)).toBe(1);
    expect(h.refunds.length - before).toBe(1);

    // "Refund requested", never "refund completed", while pending.
    const mail = (await pg.query<{ dedupe_key: string }>(`SELECT dedupe_key FROM email_logs WHERE refund_id = '${refunds[0].id}'`)).rows.map((r) => r.dedupe_key);
    expect(mail).toEqual([`refund:${refunds[0].id}:pending`]);
    expect(await count('audit_logs', `operation = 'booking.cancel_by_customer' AND entity_id = '${booking.id}'`)).toBeGreaterThan(0);

    // The webhook later says it succeeded (twice): one row, purchase refunded, one "issued" email.
    const refundObj = { id: 're_test_x1', object: 'refund', status: 'succeeded', amount: 21775, payment_intent: b.stripe_payment_id, metadata: { refundId: refunds[0].id }, failure_reason: null };
    const ev = { id: 'evt_refund_upd_1', type: 'refund.updated', livemode: false, data: { object: refundObj } } as unknown as Stripe.Event;
    expect((await processStripeEvent(ev)).httpStatus).toBe(200);
    expect((await processStripeEvent(ev)).body).toMatchObject({ duplicate: true });
    expect((await processStripeEvent({ ...ev, id: 'evt_refund_upd_2' } as Stripe.Event)).httpStatus).toBe(200);
    expect(await count('refunds', `booking_id = '${booking.id}'`)).toBe(1);
    const p = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, b.purchase_id) });
    expect(p).toMatchObject({ status: 'refunded', refunded_cents: 21775 });
    expect(await count('email_logs', `dedupe_key = 'refund:${refunds[0].id}:succeeded'`)).toBe(1);

    // The time is free again.
    const { isSlotActuallyAvailable } = await import('./availability');
    expect(await isSlotActuallyAvailable('2031-03-03', '10:00', '11:00', 60)).toBe(true);
  });

  it('inside 24 hours: refused on the server, booking untouched', async () => {
    const { booking, token } = await paidBooking('2031-03-04', '14:00');
    const start = wallTimeToUtc('2031-03-04', '14:00');
    await expect(MB.cancelByCustomer(token, new Date(start.getTime() - 23 * 3600e3))).rejects.toMatchObject({ code: 'not_eligible' });
    expect((await fresh(booking.id)).status).toBe('confirmed');
    expect(await count('refunds', `booking_id = '${booking.id}'`)).toBe(0);
  });

  it('a failed Stripe refund keeps the cancellation, flags it for staff and says so', async () => {
    const { booking, token } = await paidBooking('2031-03-05', '10:00');
    h.failRefunds = true;
    await MB.cancelByCustomer(token);
    const b = await fresh(booking.id);
    expect(b.status).toBe('cancelled');
    expect(b.needs_refund_review).toBe(true);
    const refund = await db.query.refunds.findFirst({ where: eq(schema.refunds.booking_id, booking.id) });
    expect(refund.status).toBe('failed');
    const view = await MB.buildManageView(b);
    expect(view.refund?.label).toMatch(/not completed/);
  });
});

describe('policy boundaries (pure)', () => {
  it('Friday 2:00 PM ET: Thursday 2:00 PM is the last moment', async () => {
    const { canChangeBooking } = await import('./policies');
    const start = wallTimeToUtc('2031-03-14', '14:00'); // a Friday
    expect(canChangeBooking(start, wallTimeToUtc('2031-03-13', '14:00'))).toBe(true);
    expect(canChangeBooking(start, new Date(wallTimeToUtc('2031-03-13', '14:00').getTime() + 1000))).toBe(false);
    expect(canChangeBooking(start, wallTimeToUtc('2031-03-13', '13:59'))).toBe(true);
  });

  it('counts 24 real hours across a DST change', async () => {
    const { changeDeadline } = await import('./policies');
    // DST starts Sun Mar 9 2031 at 2:00 AM ET. A 10:00 AM EDT session on Mar 9
    // closes at 9:00 AM EST on Mar 8 (24 real hours), not 10:00.
    const deadline = changeDeadline(wallTimeToUtc('2031-03-09', '10:00'));
    expect(deadline.toISOString()).toBe(wallTimeToUtc('2031-03-08', '09:00').toISOString());
  });
});

describe('reschedule', () => {
  it('moves the booking keeping service, length, setup, extras and payment', async () => {
    const mic = await addonId('additional-microphone');
    const { booking, token } = await paidBooking('2031-04-07', '10:00', { hours: 2, addons: [{ id: mic, quantity: 1 }] });
    const moved = await MB.rescheduleByCustomer(token, { date: '2031-04-08', startTime: '15:00' }, soonBefore('2031-04-08'));
    expect(moved).toEqual({ date: '2031-04-08', startTime: '15:00', endTime: '17:00' });
    const b = await fresh(booking.id);
    expect(b).toMatchObject({ service_id: booking.service_id, duration_minutes: 120, setup_id: booking.setup_id, total_amount: booking.total_amount, purchase_id: booking.purchase_id, booking_id: booking.booking_id });
    expect(await count('email_logs', `booking_id = '${booking.id}' AND template = 'reschedule'`)).toBe(1);
    expect(await count('email_logs', `booking_id = '${booking.id}' AND template = 'guest_schedule_update'`)).toBe(1);
    // Moving back later sends a new email (versioned dedupe key).
    await MB.rescheduleByCustomer(token, { date: '2031-04-07', startTime: '10:00' }, soonBefore('2031-04-07'));
    expect(await count('email_logs', `booking_id = '${booking.id}' AND template = 'reschedule'`)).toBe(2);
    expect(await count('bookings', `booking_id = '${booking.booking_id}'`)).toBe(1);
  });

  it('inside 24 hours: refused', async () => {
    const { booking, token } = await paidBooking('2031-04-09', '10:00');
    const now = new Date(wallTimeToUtc('2031-04-09', '10:00').getTime() - 3600e3);
    await expect(MB.rescheduleByCustomer(token, { date: '2031-04-10', startTime: '10:00' }, now)).rejects.toMatchObject({ code: 'not_eligible' });
    expect((await fresh(booking.id)).booking_date).toContain('2031-04-09');
  });

  it('a taken time is refused and the original booking is kept', async () => {
    const { booking, token } = await paidBooking('2031-04-14', '10:00');
    await paidBooking('2031-04-15', '12:00');
    await expect(MB.rescheduleByCustomer(token, { date: '2031-04-15', startTime: '12:00' }, soonBefore('2031-04-15'))).rejects.toMatchObject({ message: MB.SLOT_TAKEN_MESSAGE });
    const b = await fresh(booking.id);
    expect(b.status).toBe('confirmed');
    expect(b.start_time).toBe('10:00');
  });

  it('two customers moving into the same time at once: exactly one wins', async () => {
    const a = await paidBooking('2031-04-21', '09:00');
    const b = await paidBooking('2031-04-21', '11:00');
    const results = await Promise.allSettled([
      MB.rescheduleByCustomer(a.token, { date: '2031-04-22', startTime: '14:00' }, soonBefore('2031-04-22')),
      MB.rescheduleByCustomer(b.token, { date: '2031-04-22', startTime: '14:00' }, soonBefore('2031-04-22')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await count('bookings', `booking_date = '2031-04-22' AND start_time = '14:00' AND status = 'confirmed'`)).toBe(1);
  });
});

describe('add more time', () => {
  it('prices one more hour: package hour + hourly extras; per-session extras are not charged again', async () => {
    const mic = await addonId('additional-microphone');
    const editing = await addonId('full-podcast-editing');
    const micPrice = (await pg.query<{ p: number }>(`SELECT price_cents p FROM service_addons WHERE id = ${mic}`)).rows[0].p;
    const { booking, token } = await paidBooking('2031-05-05', '11:00', { hours: 1, addons: [{ id: mic, quantity: 2 }, { id: editing, quantity: 1 }] });
    const view = await MB.buildManageView(await fresh(booking.id));
    expect(view.can.extend).toBe(true);
    const one = view.extension.options[0];
    expect(one).toMatchObject({ hours: 1, newEndTime: '13:00', subtotalCents: 20000 + 2 * micPrice });
    expect(one.taxCents).toBe(Math.round(one.subtotalCents * 0.08875));
    expect(one.lines.map((l: any) => l.name).join()).not.toMatch(/Editing/);
    const two = view.extension.options[1];
    expect(two.subtotalCents).toBe(2 * (20000 + 2 * micPrice));
    expect(token).toBeTruthy();
  });

  it('is unavailable when the next booking starts right after, and never overlaps it', async () => {
    const { booking } = await paidBooking('2031-05-06', '11:00');
    await paidBooking('2031-05-06', '12:00');
    const view = await MB.buildManageView(await fresh(booking.id));
    expect(view.can.extend).toBe(false);
    expect(view.reasons.extend).toMatch(/already booked/);
  });

  it('stops at an active hold, at blocked time and at closing time', async () => {
    const { booking } = await paidBooking('2031-05-07', '11:00');
    await holdRoute.POST(
      post('/api/booking/create-hold', { customer_email: 'other@example.com', service_id: ids['Single Podcaster'], booking_date: '2031-05-07', start_time: '13:00', end_time: '14:00', duration_minutes: 60, setup_id: booking.setup_id })
    );
    let view = await MB.buildManageView(await fresh(booking.id));
    expect(view.extension.options.map((o: any) => o.hours)).toEqual([1]);

    const late = await paidBooking('2031-05-08', '21:00');
    view = await MB.buildManageView(await fresh(late.booking.id));
    expect(view.can.extend).toBe(false);
    expect(view.reasons.extend).toMatch(/closes/);

    const blocked = await paidBooking('2031-05-09', '11:00');
    await pg.query(`INSERT INTO blocked_times (start_datetime, end_datetime, reason) VALUES ($1, $2, 'maintenance')`, [
      wallTimeToUtc('2031-05-09', '12:30').toISOString(),
      wallTimeToUtc('2031-05-09', '14:00').toISOString(),
    ]);
    view = await MB.buildManageView(await fresh(blocked.booking.id));
    expect(view.can.extend).toBe(false);
  });

  it('paid extension: held while paying, applied once by the webhook, synced, emailed', async () => {
    const { booking, token } = await paidBooking('2031-05-12', '11:00');
    const { checkoutUrl } = await MB.startExtension(token, 1, 'http://localhost');
    // Same request again (double click): same Checkout page, one extension.
    expect((await MB.startExtension(token, 1, 'http://localhost')).checkoutUrl).toBe(checkoutUrl);
    expect(await count('booking_extensions', `booking_id = '${booking.id}'`)).toBe(1);
    const ext = await db.query.bookingExtensions.findFirst({ where: eq(schema.bookingExtensions.booking_id, booking.id) });
    // The booking itself is unchanged until payment.
    expect((await fresh(booking.id)).end_time).toBe('12:00');
    // Nobody else can take 12:00–13:00 meanwhile.
    const { isSlotActuallyAvailable } = await import('./availability');
    expect(await isSlotActuallyAvailable('2031-05-12', '12:00', '13:00', 60)).toBe(false);

    const ev = paidEvent(ext.stripe_checkout_session_id);
    expect((await processStripeEvent(ev)).body).toMatchObject({ status: 'extension_applied' });
    expect((await processStripeEvent({ ...ev, id: `${ev.id}_again` } as Stripe.Event)).body).toMatchObject({ status: 'already_processed' });
    expect((await processStripeEvent(paidEvent(ext.stripe_checkout_session_id, 'checkout.session.async_payment_succeeded'))).body).toMatchObject({ status: 'already_processed' });

    const b = await fresh(booking.id);
    expect(b).toMatchObject({ end_time: '13:00', duration_minutes: 120, status: 'confirmed', total_amount: booking.total_amount });
    const purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, ext.purchase_id) });
    expect(purchase).toMatchObject({ type: 'extension', status: 'paid', total_cents: 21775 });
    expect(await count('purchase_items', `purchase_id = '${ext.purchase_id}'`)).toBe(1);
    expect(await count('email_logs', `dedupe_key = 'extension:${ext.id}'`)).toBe(1);
    // Google isn't configured here: the sync is logged as failed (retryable) without touching the booking or money.
    expect(await count('integration_logs', `booking_id = '${booking.id}' AND integration_type = 'google_calendar' AND status = 'failed'`)).toBeGreaterThan(0);

    // A cancellation now refunds the booking and the extension.
    await MB.cancelByCustomer(token);
    const refunds = await db.query.refunds.findMany({ where: eq(schema.refunds.booking_id, booking.id) });
    expect(refunds.map((r: any) => r.amount_cents).sort()).toEqual([21775, 21775]);
  });

  it('an expired or failed extension payment changes nothing and frees the time', async () => {
    const { booking, token } = await paidBooking('2031-05-13', '11:00');
    await MB.startExtension(token, 2, 'http://localhost');
    const ext = await db.query.bookingExtensions.findFirst({ where: eq(schema.bookingExtensions.booking_id, booking.id) });
    expect((await processStripeEvent(expiredEvent(ext.stripe_checkout_session_id))).body).toMatchObject({ status: 'extension_released' });
    expect((await fresh(booking.id)).end_time).toBe('12:00');
    const after = await db.query.bookingExtensions.findFirst({ where: eq(schema.bookingExtensions.id, ext.id) });
    expect(after.status).toBe('cancelled');
    const { isSlotActuallyAvailable } = await import('./availability');
    expect(await isSlotActuallyAvailable('2031-05-13', '12:00', '13:00', 60)).toBe(true);
  });

  it('a payment for time someone else took is recorded and flagged, never overlapping', async () => {
    const { booking, token } = await paidBooking('2031-05-14', '11:00');
    await MB.startExtension(token, 1, 'http://localhost');
    const ext = await db.query.bookingExtensions.findFirst({ where: eq(schema.bookingExtensions.booking_id, booking.id) });
    // Staff force a booking into 12:00 (the hold expired in the meantime).
    await pg.query(`UPDATE temporary_holds SET hold_expires_at = now() - interval '1 minute' WHERE id = '${ext.hold_id}'`);
    await paidBooking('2031-05-14', '12:00');
    expect((await processStripeEvent(paidEvent(ext.stripe_checkout_session_id))).body).toMatchObject({ status: 'extension_needs_review' });
    expect((await fresh(booking.id)).end_time).toBe('12:00');
    const p = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, ext.purchase_id) });
    expect(p).toMatchObject({ status: 'paid', needs_refund_review: true });
  });
});

describe('audit regressions', () => {
  it('cancelling a booking with an unpaid extra-time Checkout expires it and frees the held time', async () => {
    const { booking, token } = await paidBooking('2031-08-04', '11:00');
    await MB.startExtension(token, 1, 'http://localhost');
    const ext = await db.query.bookingExtensions.findFirst({ where: eq(schema.bookingExtensions.booking_id, booking.id) });
    await MB.cancelByCustomer(token);
    expect(h.sessions.get(ext.stripe_checkout_session_id).status).toBe('expired');
    expect((await db.query.bookingExtensions.findFirst({ where: eq(schema.bookingExtensions.id, ext.id) })).status).toBe('cancelled');
    expect((await db.query.temporaryHolds.findFirst({ where: eq(schema.temporaryHolds.id, ext.hold_id) })).status).toBe('cancelled');
    const { isSlotActuallyAvailable } = await import('./availability');
    expect(await isSlotActuallyAvailable('2031-08-04', '12:00', '13:00', 60)).toBe(true);
  });

  it('extra time paid for the old date is never applied after a reschedule (same end time, other day)', async () => {
    const { booking, token } = await paidBooking('2031-08-05', '11:00');
    await MB.startExtension(token, 1, 'http://localhost');
    const ext = await db.query.bookingExtensions.findFirst({ where: eq(schema.bookingExtensions.booking_id, booking.id) });
    const session = h.sessions.get(ext.stripe_checkout_session_id);
    // Simulate the customer paying in another tab while the booking is moved (the session can't be expired any more).
    session.status = 'complete';
    await MB.rescheduleByCustomer(token, { date: '2031-08-06', startTime: '11:00' }, soonBefore('2031-08-06'));
    expect((await db.query.bookingExtensions.findFirst({ where: eq(schema.bookingExtensions.id, ext.id) })).status).toBe('pending');
    const out = await processStripeEvent(paidEvent(ext.stripe_checkout_session_id));
    expect(out.body).toMatchObject({ status: 'extension_needs_review' });
    const b = await fresh(booking.id);
    expect(b).toMatchObject({ start_time: '11:00', end_time: '12:00', duration_minutes: 60 });
    expect(b.booking_date).toContain('2031-08-06');
    const p = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, ext.purchase_id) });
    expect(p).toMatchObject({ status: 'paid', needs_refund_review: true });
  });

  it('rescheduling releases an unpaid extension hold on the old date', async () => {
    const { booking, token } = await paidBooking('2031-08-11', '11:00');
    await MB.startExtension(token, 2, 'http://localhost');
    const ext = await db.query.bookingExtensions.findFirst({ where: eq(schema.bookingExtensions.booking_id, booking.id) });
    await MB.rescheduleByCustomer(token, { date: '2031-08-12', startTime: '09:00' }, soonBefore('2031-08-12'));
    expect((await db.query.bookingExtensions.findFirst({ where: eq(schema.bookingExtensions.id, ext.id) })).status).toBe('cancelled');
    const { isSlotActuallyAvailable } = await import('./availability');
    expect(await isSlotActuallyAvailable('2031-08-11', '12:00', '13:00', 60)).toBe(true);
  });

  it('a Checkout Stripe cannot report on is not abandoned (no second payable session)', async () => {
    const { booking, token } = await paidBooking('2031-08-13', '11:00');
    await MB.startExtension(token, 1, 'http://localhost');
    const ext = await db.query.bookingExtensions.findFirst({ where: eq(schema.bookingExtensions.booking_id, booking.id) });
    const saved = h.sessions.get(ext.stripe_checkout_session_id);
    h.sessions.delete(ext.stripe_checkout_session_id);
    await expect(MB.startExtension(token, 2, 'http://localhost')).rejects.toMatchObject({ status: 503 });
    h.sessions.set(ext.stripe_checkout_session_id, saved);
    expect(await count('booking_extensions', `booking_id = '${booking.id}'`)).toBe(1);
    expect((await db.query.bookingExtensions.findFirst({ where: eq(schema.bookingExtensions.id, ext.id) })).status).toBe('pending');
  });

  it('customer reschedule cannot go past the public booking horizon', async () => {
    const { token } = await paidBooking('2031-08-18', '11:00');
    const now = wallTimeToUtc('2031-08-01', '09:00');
    await expect(MB.rescheduleByCustomer(token, { date: '2031-12-30', startTime: '11:00' }, now)).rejects.toMatchObject({ code: 'not_eligible' });
  });

  it('Additional Camera fails closed when the camera configuration is missing or invalid', async () => {
    // Owner decision: never guess. Invalid → no Additional Camera at all.
    const { addonAvailability } = await import('./bookingOptions');
    const camera = { slug: 'additional-camera', max_quantity: 3 };
    const cases: [unknown, number, boolean][] = [
      [{}, 0, true], // missing
      [{ includedCameras: null }, 0, true],
      [{ includedCameras: '3' }, 0, true], // string
      [{ includedCameras: 0 }, 0, true],
      [{ includedCameras: -1 }, 0, true],
      [{ includedCameras: 4 }, 0, true], // above the studio maximum
      [{ includedCameras: 1.5 }, 0, true],
      [null, 0, true],
      [{ includedCameras: 1 }, 2, false], // Single Podcaster
      [{ includedCameras: 3 }, 0, false], // Podcast Pro / Full Podcast Package
    ];
    for (const [metadata, limit, configError] of cases) {
      const r = addonAvailability({ metadata }, camera);
      expect([JSON.stringify(metadata), r.limit, !!r.configError]).toEqual([JSON.stringify(metadata), limit, configError]);
    }
    // Other add-ons are never affected by the camera configuration.
    expect(addonAvailability({ metadata: {} }, { slug: 'additional-microphone', max_quantity: 4 })).toEqual({ limit: 4, configError: null });
  });
});
