/**
 * Pre-preview hardening: fail-closed camera configuration, the dedicated
 * Manage Booking secret, "Request a new link", and Sheets totals after
 * extra time. Same harness as manageBooking.integration.test.ts, plus a fake
 * Resend so email outcomes (sent / failed / retried) can be asserted.
 *
 * Customer self-service (Manage Booking) against a real Postgres (PGlite,
 * every migration) and a fake Stripe that keeps Checkout and refund state.
 * Google is not configured and Resend is off, so Calendar/Sheets/email
 * attempts are logged as failed/skipped — exactly the "integration failure"
 * path: the booking and money must stay correct and retryable.
 * No live Stripe, no real email, no real Calendar or Sheets.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
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
    mails: [] as { to: string; subject: string; html: string; text: string }[],
    failMail: false,
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

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (msg: any) => {
        if (h.failMail) return { data: null, error: { message: 'fake resend outage' } };
        h.mails.push({ to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
        return { data: { id: `em_${h.mails.length}` }, error: null };
      },
    };
  },
}));

process.env.RESEND_API_KEY = 're_test_fake_key';
process.env.EMAIL_FROM = 'bookings@example.test';
delete process.env.GOOGLE_CALENDAR_EMAIL;

const { db, pg } = (await import('@/lib/db')) as unknown as { db: any; pg: import('@electric-sql/pglite').PGlite };
const schema = await import('@/lib/db/schema');
const { seedCatalog } = await import('@/test/pgliteDb');
const { processStripeEvent } = await import('@/lib/crm/webhook');
const MB = await import('./manageBooking');
const T = await import('./manageToken');
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


// ---------------------------------------------------------------------------

const { requestManageLink, REQUEST_LINK_RESPONSE } = await import('./manageLinkRequest');
const linkRoute = await import('@/app/api/booking/manage/request-link/route');
const { sheetExtrasFor } = await import('./integrationSync');
const { retryEmail } = await import('./email');
const { buildPaidBookingRow, syncBookingToSheet, PAID_BOOKINGS_HEADERS, PAID_BOOKINGS_EXTENSION_HEADERS } = await import('./googleSheets');
const { FakeSheets, setGoogleEnv, clearGoogleEnv } = await import('@/test/fakeGoogle');

let ipSeq = 0;
const nextIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

describe('camera configuration fails closed', () => {
  async function camHold(service: string, cameras: number, date: string) {
    const camera = await addonId('additional-camera');
    const res = await holdRoute.POST(
      post('/api/booking/create-hold', {
        customer_email: `cfg${++ip}@example.com`,
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
  const addonsList = async (name: string) => {
    const route = await import('@/app/api/booking/addons/route');
    return (await (await route.GET(new NextRequest(`http://localhost/api/booking/addons?service_id=${ids[name]}`))).json()) as any[];
  };

  it('correct configuration: Single 1 (+2), Pro 3 (none), Full 3 (none)', async () => {
    expect((await addonsList('Single Podcaster')).find((a) => a.name === 'Additional Camera')?.max_quantity).toBe(2);
    expect((await addonsList('Podcast Pro')).some((a) => a.name === 'Additional Camera')).toBe(false);
    expect((await addonsList('Full Podcast Package')).some((a) => a.name === 'Additional Camera')).toBe(false);
    expect((await camHold('Single Podcaster', 2, '2032-01-05')).status).toBe(200);
    expect((await camHold('Podcast Pro', 1, '2032-01-06')).status).toBe(400);
    expect((await camHold('Full Podcast Package', 1, '2032-01-07')).status).toBe(400);
  });

  for (const [label, metadata] of [
    ['missing', {}],
    ['null', { includedCameras: null }],
    ['a string', { includedCameras: '1' }],
    ['zero', { includedCameras: 0 }],
    ['negative', { includedCameras: -2 }],
    ['above the maximum', { includedCameras: 4 }],
  ] as const) {
    it(`includedCameras ${label}: hidden from the list and refused by the API (direct request), warning logged without PII`, async () => {
      await pg.query(`UPDATE services SET metadata = $1::jsonb WHERE name = 'Single Podcaster'`, [JSON.stringify(metadata)]);
      try {
        expect((await addonsList('Single Podcaster')).some((a) => a.name === 'Additional Camera')).toBe(false);
        const r = await camHold('Single Podcaster', 1, '2032-01-08');
        expect(r.status).toBe(400);
        expect(r.body.error).toMatch(/temporarily unavailable/);
        const warn = (await pg.query<{ m: string }>(`SELECT error_message m FROM integration_logs WHERE integration_type = 'admin' AND booking_id IS NULL AND error_message LIKE 'Configuration:%Single Podcaster%' ORDER BY created_at DESC LIMIT 1`)).rows[0];
        expect(warn?.m).toMatch(/includedCameras/);
        expect(warn?.m).not.toMatch(/@/);
      } finally {
        await pg.query(`UPDATE services SET metadata = '{"includedCameras": 1}' WHERE name = 'Single Podcaster'`);
      }
    });
  }

  it('extension of an existing booking with extra cameras is not sold online while the configuration is invalid (no undercharge)', async () => {
    const camera = await addonId('additional-camera');
    const { booking } = await paidBooking('2032-01-12', '11:00', { service: 'Single Podcaster', addons: [{ id: camera, quantity: 2 }] });
    const before = (await pg.query(`SELECT * FROM purchase_items WHERE purchase_id = '${booking.purchase_id}' ORDER BY id`)).rows;
    let view = await MB.buildManageView(await fresh(booking.id));
    expect(view.extension.options[0].subtotalCents).toBe(17000 + 2 * 3000);
    await pg.query(`UPDATE services SET metadata = '{}' WHERE name = 'Single Podcaster'`);
    try {
      view = await MB.buildManageView(await fresh(booking.id));
      expect(view.can.extend).toBe(false);
      expect(view.reasons.extend).toMatch(/contact the studio/);
      const token = await T.ensureManageToken(booking.id);
      await expect(MB.startExtension(token, 1, 'http://localhost')).rejects.toMatchObject({ code: 'not_available' });
    } finally {
      await pg.query(`UPDATE services SET metadata = '{"includedCameras": 1}' WHERE name = 'Single Podcaster'`);
    }
    // The purchase snapshot never changed.
    expect((await pg.query(`SELECT * FROM purchase_items WHERE purchase_id = '${booking.purchase_id}' ORDER BY id`)).rows).toEqual(before);
  });
});

describe('BOOKING_MANAGE_SECRET', () => {
  const KEY = process.env.BOOKING_MANAGE_SECRET!;
  afterEach(() => {
    process.env.BOOKING_MANAGE_SECRET = KEY;
    process.env.NEXTAUTH_SECRET = 'test-secret';
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  });

  it('missing or too short: token operations fail closed and the API answers 503 without details', async () => {
    const { booking, token } = await paidBooking('2032-02-02', '10:00');
    for (const value of [undefined, '', 'short']) {
      if (value === undefined) delete process.env.BOOKING_MANAGE_SECRET;
      else process.env.BOOKING_MANAGE_SECRET = value;
      expect(T.isManageSecretConfigured()).toBe(false);
      await expect(T.bookingForToken(token)).rejects.toBeInstanceOf(T.ManageLinkConfigError);
      await expect(T.ensureManageToken(booking.id)).rejects.toBeInstanceOf(T.ManageLinkConfigError);
      await expect(T.rotateManageToken(booking.id)).rejects.toBeInstanceOf(T.ManageLinkConfigError);
      const res = await viewRoute.POST(post('/api/booking/manage/view', { token }));
      expect(res.status).toBe(503);
      const text = JSON.stringify(await res.json());
      expect(text).not.toMatch(/BOOKING_MANAGE_SECRET|secret/i);
    }
  });

  it('valid secret works; a different secret invalidates links; NEXTAUTH_SECRET and STRIPE_SECRET_KEY rotation change nothing', async () => {
    const { booking, token } = await paidBooking('2032-02-03', '10:00');
    expect((await T.bookingForToken(token))?.id).toBe(booking.id);
    process.env.NEXTAUTH_SECRET = 'rotated-admin-secret';
    process.env.STRIPE_SECRET_KEY = 'sk_test_rotated';
    expect((await T.bookingForToken(token))?.id).toBe(booking.id);
    expect(await T.ensureManageToken(booking.id)).toBe(token);
    process.env.BOOKING_MANAGE_SECRET = 'a-completely-different-32-byte-secret-value!!';
    expect(await T.bookingForToken(token)).toBeNull();
  });

  it('lookup by hash, revoke and rotate; the secret never appears in the database or responses', async () => {
    const { booking, token } = await paidBooking('2032-02-04', '10:00');
    const row = await fresh(booking.id);
    expect(row.manage_token_hash).toBe(T.hashManageToken(token));
    const dump = JSON.stringify((await pg.query(`SELECT * FROM bookings WHERE id = '${booking.id}'`)).rows) + JSON.stringify((await pg.query('SELECT * FROM audit_logs')).rows) + JSON.stringify((await pg.query('SELECT * FROM integration_logs')).rows);
    expect(dump).not.toContain(KEY);
    expect(dump).not.toContain(token);
    const next = await T.rotateManageToken(booking.id);
    expect(await T.bookingForToken(token)).toBeNull();
    expect((await T.bookingForToken(next))?.id).toBe(booking.id);
    await T.revokeManageToken(booking.id);
    expect(await T.bookingForToken(next)).toBeNull();
    expect(await T.bookingForToken('not-a-token')).toBeNull();
  });
});

describe('Request a new link', () => {
  // Only the requested-link emails (bookings in these tests also get their normal confirmation emails).
  const linkMails = () => h.mails.filter((m) => m.subject === 'Your ZAYRO Studios booking link');
  beforeEach(() => {
    h.mails = [];
    h.failMail = false;
  });

  it('matching reference + email (any case): link emailed only to the booking email; earlier link stops working', async () => {
    const { booking, token, email } = await paidBooking('2032-03-01', '10:00');
    const out = await requestManageLink({ reference: ` ${booking.booking_id.toLowerCase()} `, email: email.toUpperCase() }, nextIp());
    expect(out).toBe('sent');
    expect(linkMails()).toHaveLength(1);
    expect(linkMails()[0].to).toBe(booking.customer_email);
    expect(await T.bookingForToken(token)).toBeNull();
    const link = /booking\/manage#t=([A-Za-z0-9_-]{43})/.exec(linkMails()[0].text)?.[1];
    expect((await T.bookingForToken(link))?.id).toBe(booking.id);
    expect(linkMails()[0].html).toContain('Manage Your Booking');
  });

  it('the public route always returns the same answer and never the token', async () => {
    const { booking, email } = await paidBooking('2032-03-02', '10:00');
    const answers: string[] = [];
    for (const body of [
      { reference: booking.booking_id, email },
      { reference: booking.booking_id, email: 'someone-else@example.com' },
      { reference: 'ZAY-NOTAREALREF1', email },
      { reference: 'garbage', email: 'not-an-email' },
      { reference: booking.booking_id, email: 'guest@example.com' },
    ]) {
      const res = await linkRoute.POST(new NextRequest('http://localhost/api/booking/manage/request-link', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() } }));
      expect(res.status).toBe(200);
      answers.push(await res.text());
    }
    expect(new Set(answers).size).toBe(1);
    expect(JSON.parse(answers[0]).message).toBe(REQUEST_LINK_RESPONSE);
    expect(answers[0]).not.toMatch(/#t=|token/i);
    // Only the first (matching) request sent anything, and only to the booking owner.
    expect(linkMails().map((m) => m.to)).toEqual([booking.customer_email]);
  });

  it('wrong email, unknown reference and a guest email send nothing', async () => {
    const { booking } = await paidBooking('2032-03-03', '10:00');
    expect(await requestManageLink({ reference: booking.booking_id, email: 'wrong@example.com' }, nextIp())).toBe('no_match');
    expect(await requestManageLink({ reference: 'ZAY-UNKNOWN00001', email: booking.customer_email }, nextIp())).toBe('no_match');
    expect(await requestManageLink({ reference: booking.booking_id, email: 'guest@example.com' }, nextIp())).toBe('no_match');
    expect(linkMails()).toHaveLength(0);
  });

  it('repeated requests within the cooldown send one email', async () => {
    const { booking, email } = await paidBooking('2032-03-04', '10:00');
    expect(await requestManageLink({ reference: booking.booking_id, email }, nextIp())).toBe('sent');
    expect(await requestManageLink({ reference: booking.booking_id, email }, nextIp())).toBe('cooldown');
    expect(await requestManageLink({ reference: booking.booking_id, email }, nextIp())).toBe('cooldown');
    expect(linkMails()).toHaveLength(1);
  });

  it('rate limited per IP and per booking reference', async () => {
    const ipAddr = nextIp();
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await requestManageLink({ reference: `ZAY-RATELIMIT${String(i).padStart(3, '0')}`, email: 'x@example.com' }, ipAddr));
    expect(results.slice(0, 5).every((r) => r === 'no_match')).toBe(true);
    expect(results.slice(5)).toEqual(['rate_limited', 'rate_limited']);
    const perRef = [];
    for (let i = 0; i < 7; i++) perRef.push(await requestManageLink({ reference: 'ZAY-SAMEREF00001', email: 'x@example.com' }, nextIp()));
    expect(perRef.slice(5)).toEqual(['rate_limited', 'rate_limited']);
  });

  it('an old booking without a link gets one; a staff-revoked link is not re-issued; unpaid checkouts get nothing', async () => {
    const old = await paidBooking('2032-03-05', '10:00');
    await pg.query(`UPDATE bookings SET manage_token_hash = NULL, manage_token_nonce = NULL WHERE id = '${old.booking.id}'`);
    expect(await requestManageLink({ reference: old.booking.booking_id, email: old.email }, nextIp())).toBe('sent');
    expect((await fresh(old.booking.id)).manage_token_nonce).toBeTruthy();

    const revoked = await paidBooking('2032-03-06', '10:00');
    await T.revokeManageToken(revoked.booking.id);
    expect(await requestManageLink({ reference: revoked.booking.booking_id, email: revoked.email }, nextIp())).toBe('not_eligible');

    await pg.query(`UPDATE bookings SET status = 'payment_pending' WHERE id = '${old.booking.id}'`);
    await pg.query(`DELETE FROM email_logs WHERE booking_id = '${old.booking.id}' AND template = 'manage_link'`);
    expect(await requestManageLink({ reference: old.booking.booking_id, email: old.email }, nextIp())).toBe('not_eligible');
    await pg.query(`UPDATE bookings SET status = 'confirmed' WHERE id = '${old.booking.id}'`);
    expect(linkMails()).toHaveLength(1);
  });

  it('an email failure is logged and retryable (and the retry carries a working link)', async () => {
    const { booking, email } = await paidBooking('2032-03-08', '10:00');
    h.failMail = true;
    expect(await requestManageLink({ reference: booking.booking_id, email }, nextIp())).toBe('failed');
    const log = (await pg.query<{ id: string; status: string }>(`SELECT id, status FROM email_logs WHERE booking_id = '${booking.id}' AND template = 'manage_link'`)).rows[0];
    expect(log.status).toBe('failed');
    h.failMail = false;
    const retried = await retryEmail(log.id);
    expect(retried.sent).toBe(true);
    const link = /booking\/manage#t=([A-Za-z0-9_-]{43})/.exec(linkMails()[0].text)?.[1];
    expect((await T.bookingForToken(link))?.id).toBe(booking.id);
  });
});

describe('Google Sheets totals after extra time', () => {
  async function extend(token: string, hours: number) {
    await MB.startExtension(token, hours, 'http://localhost');
    const ext = (await pg.query<{ stripe_checkout_session_id: string; purchase_id: string; id: string }>(`SELECT * FROM booking_extensions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    return ext;
  }

  it('no extension; one; two; pending and failed ones excluded; refunds net out; repeated sync stable', async () => {
    const { booking, token } = await paidBooking('2032-04-05', '10:00');
    expect(await sheetExtrasFor(await fresh(booking.id))).toEqual({ extensionNetCents: 0, totalPaidNetCents: 21775 });

    const e1 = await extend(token, 1);
    // Pending (not paid yet): not counted.
    expect(await sheetExtrasFor(await fresh(booking.id))).toEqual({ extensionNetCents: 0, totalPaidNetCents: 21775 });
    await processStripeEvent(paidEvent(e1.stripe_checkout_session_id));
    expect(await sheetExtrasFor(await fresh(booking.id))).toEqual({ extensionNetCents: 21775, totalPaidNetCents: 43550 });

    const e2 = await extend(token, 1);
    await processStripeEvent(paidEvent(e2.stripe_checkout_session_id));
    expect(await sheetExtrasFor(await fresh(booking.id))).toEqual({ extensionNetCents: 43550, totalPaidNetCents: 65325 });

    const e3 = await extend(token, 1);
    h.sessions.get(e3.stripe_checkout_session_id).status = 'expired';
    await processStripeEvent({ id: `evt_${e3.id}_failed`, type: 'checkout.session.async_payment_failed', livemode: false, data: { object: { ...h.sessions.get(e3.stripe_checkout_session_id) } } } as unknown as Stripe.Event);
    expect(await sheetExtrasFor(await fresh(booking.id))).toEqual({ extensionNetCents: 43550, totalPaidNetCents: 65325 });

    // A refunded extension (succeeded refund) no longer counts.
    await pg.query(`INSERT INTO refunds (purchase_id, booking_id, amount_cents, status, source) VALUES ('${e2.purchase_id}', '${booking.id}', 21775, 'succeeded', 'admin')`);
    const { recomputeRefundState } = await import('./crm/purchases');
    await recomputeRefundState(db, e2.purchase_id);
    const after = await sheetExtrasFor(await fresh(booking.id));
    expect(after).toEqual({ extensionNetCents: 21775, totalPaidNetCents: 43550 });
    // Re-computing (a repeated sync) never adds anything twice.
    expect(await sheetExtrasFor(await fresh(booking.id))).toEqual(after);
  });

  it('old sheet layout (20 columns) keeps working; new layout writes U–X; repeated sync updates in place', async () => {
    setGoogleEnv();
    try {
      const b = await (async () => {
        const { booking, token } = await paidBooking('2032-04-06', '10:00');
        const e = await extend(token, 1);
        await processStripeEvent(paidEvent(e.stripe_checkout_session_id));
        return fresh(booking.id);
      })();
      const service = await db.query.services.findFirst({ where: eq(schema.services.id, b.service_id) });
      const extras = await sheetExtrasFor(b);

      const v1 = new FakeSheets();
      const r1 = await syncBookingToSheet(b, service, null, { sheets: v1 as any, extras });
      expect(r1.status).toBe('appended');
      expect(v1.dataRows('Paid Bookings')[0]).toHaveLength(PAID_BOOKINGS_HEADERS.length);
      expect(v1.calls.filter((c) => c.method !== 'get').every((c) => !/![A-Z]+\d+:[U-Z]/.test(c.range))).toBe(true);

      const v2 = new FakeSheets({ paidHeaders: [...PAID_BOOKINGS_HEADERS, ...PAID_BOOKINGS_EXTENSION_HEADERS] });
      const first = await syncBookingToSheet(b, service, null, { sheets: v2 as any, extras });
      const again = await syncBookingToSheet({ ...b, google_sheets_row_id: first.rowId }, service, null, { sheets: v2 as any, extras });
      expect(again.status).toBe('updated');
      const rows = v2.dataRows('Paid Bookings');
      expect(rows).toHaveLength(1);
      expect(rows[0].slice(-4)).toEqual([217.75, 435.5, 120, '12:00']);
      // Column O "Total" keeps the original booking total.
      expect(rows[0][14]).toBe(217.75);
      // Unknown amounts are left empty, never guessed.
      expect(buildPaidBookingRow(b, service, null, { extras: null }).slice(-4, -2)).toEqual(['', '']);
    } finally {
      clearGoogleEnv();
    }
  });
});
