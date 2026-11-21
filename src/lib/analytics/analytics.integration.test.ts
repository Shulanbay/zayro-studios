/**
 * Marketing analytics against a real Postgres (PGlite with every migration):
 * collect endpoint, visitor/session logic, consent, attribution snapshots,
 * authoritative server conversions from the real checkout / free-confirm /
 * webhook / contact code, destination deliveries through a fake transport,
 * the dashboard numbers, the aggregate export and the Marketing Analyst
 * role. No vendor is ever contacted: the default transport refuses network
 * access under Vitest, and every test that delivers installs a fake.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { withPolicy } from '@/test/policy';

const h = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.NEXTAUTH_SECRET = 'test-secret';
  process.env.ADMIN_EMAILS = 'owner@zayro.test';
  process.env.ANALYTICS_ENCRYPTION_SECRET = 'integration-test-analytics-secret-0123456789abcdef';
  return { sessionToken: null as string | null, counter: 0, resendSend: null as any };
});

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/pgliteDb');
  const { db, pg } = await createTestDb();
  return { db, pg };
});
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (name: string) => (name === 'zayro_admin_session' && h.sessionToken ? { value: h.sessionToken } : undefined) }),
  headers: () => new Map(),
}));
vi.mock('stripe', () => ({
  default: class {
    checkout = {
      sessions: {
        create: async (params: any) => {
          const id = `cs_test_an${++h.counter}`;
          return { id, url: `https://checkout.stripe.test/${id}`, status: 'open', expires_at: params.expires_at, amount_total: params.line_items[0].price_data.unit_amount, currency: 'usd', metadata: params.metadata };
        },
        retrieve: async (id: string) => ({ id, status: 'open', payment_status: 'unpaid' }),
        expire: async (id: string) => ({ id, status: 'expired' }),
      },
    };
    refunds = { create: async () => ({}), list: async () => ({ data: [] }) };
    webhooks = { constructEvent: () => ({}) };
    events = { retrieve: async () => ({}) };
  },
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: (...args: any[]) => h.resendSend(...args) }; } }));

delete process.env.GOOGLE_CALENDAR_EMAIL;
delete process.env.RESEND_API_KEY;

const { db, pg } = (await import('@/lib/db')) as unknown as { db: any; pg: import('@electric-sql/pglite').PGlite };
const schema = await import('@/lib/db/schema');
const { seedCatalog } = await import('@/test/pgliteDb');
const { processStripeEvent } = await import('@/lib/crm/webhook');
const { createSessionToken } = await import('@/lib/adminAuth');
const { serializeConsent, CONSENT_VERSION } = await import('./consent');
const { resolveVisit } = await import('./server/store');
const { processDueDeliveries } = await import('./server/deliveries');
const { __setAnalyticsTestRuntime } = await import('./server/runtime');
const { eventIds } = await import('./server/hooks');
const { cleanupAnalytics } = await import('./server/retention');
const metrics = await import('./server/metrics');
const { moneyMetrics } = await import('@/lib/crm/metrics');
const collectRoute = await import('@/app/api/analytics/collect/route');
const consentRoute = await import('@/app/api/analytics/consent/route');
const holdRoute = await import('@/app/api/booking/create-hold/route');
const checkoutRoute = await import('@/app/api/payment/create-checkout-session/route');
const freeRoute = await import('@/app/api/booking/confirm-free/route');
const verifySessionRoute = await import('@/app/api/booking/verify-session/route');
const contactRoute = await import('@/app/api/contact/route');
const exportRoute = await import('@/app/api/admin/analytics/export/route');
const retryRoute = await import('@/app/api/admin/analytics/deliveries/route');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
let ids: Record<string, number>;
let ip = 0;
let consentSeq = 0;

function consentCookie(analytics: boolean, advertising: boolean) {
  const id = `consent${String(++consentSeq).padStart(4, '0')}abcdefghijklmn`;
  return `zayro_consent=${encodeURIComponent(serializeConsent({ version: CONSENT_VERSION, consentId: id, analytics, advertising, decidedAt: Math.floor(Date.now() / 1000) }))}`;
}

class Browser {
  jar = new Map<string, string>();
  ipAddr = `10.9.${Math.floor(++ip / 250)}.${ip % 250}`;
  constructor(analytics: boolean | null, advertising = false) {
    if (analytics !== null) {
      const [k, v] = consentCookie(analytics, advertising).split('=');
      this.jar.set(k, v);
    }
  }
  setConsent(analytics: boolean, advertising: boolean) {
    const [k, v] = consentCookie(analytics, advertising).split('=');
    this.jar.set(k, v);
  }
  cookieHeader() {
    return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  absorb(res: Response) {
    const set = (res.headers as any).getSetCookie?.() ?? [];
    for (const c of set as string[]) {
      const [pair, ...attrs] = c.split(';');
      const [k, v] = pair.split('=');
      if (attrs.some((a) => /max-age=0/i.test(a)) || v === '') this.jar.delete(k.trim());
      else this.jar.set(k.trim(), v);
    }
  }
  request(url: string, body: unknown, extra: Record<string, string> = {}) {
    return new NextRequest(`http://localhost${url}`, {
      method: 'POST',
      body: JSON.stringify(withPolicy(url, body)),
      headers: { 'Content-Type': 'application/json', 'user-agent': UA, 'x-forwarded-for': this.ipAddr, cookie: this.cookieHeader(), ...extra },
    });
  }
  async collect(events: any[], touch?: any, extra: Record<string, unknown> = {}) {
    const res = await collectRoute.POST(this.request('/api/analytics/collect', { events, ...(touch ? { touch } : {}), ...extra }));
    this.absorb(res);
    return res;
  }
}

const ev = (name: string, path = '/', properties: Record<string, unknown> = {}) => ({ name, eventId: crypto.randomUUID(), occurredAt: Date.now(), path, properties });

async function count(table: string, where = 'true'): Promise<number> {
  return (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`)).rows[0].n;
}

async function setupFor(category: string) {
  if (category !== 'podcast') return undefined;
  return (await pg.query<{ id: number }>("SELECT id FROM setups WHERE slug = 'sofa-lounge'")).rows[0]?.id;
}

let dateSeq = 0;
function nextDate() {
  const d = new Date(Date.UTC(2031, 0, 5 + dateSeq++));
  return d.toISOString().slice(0, 10);
}

async function bookPaid(browser: Browser, email = 'ada@example.com') {
  const service = await db.query.services.findFirst({ where: eq(schema.services.id, ids['Podcast Pro']) });
  const date = nextDate();
  const holdRes = await holdRoute.POST(
    browser.request('/api/booking/create-hold', { customer_email: email, service_id: service.id, booking_date: date, start_time: '10:00', end_time: '11:00', duration_minutes: 60, setup_id: await setupFor('podcast') })
  );
  const hold = await holdRes.json();
  expect(holdRes.status, JSON.stringify(hold)).toBe(200);
  const res = await checkoutRoute.POST(
    browser.request('/api/payment/create-checkout-session', {
      holdId: hold.hold_id,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email,
      phone: '+1 212 555 0100',
      notes: 'Private project notes',
      intake: { peopleRecording: 2, peopleOnCamera: 2, recordingType: 'Podcast', editing: 'no' },
    })
  );
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  const booking = await db.query.bookings.findFirst({ where: eq(schema.bookings.stripe_session_id, body.sessionId) });
  return { booking, body, holdId: hold.hold_id as string };
}

let evtSeq = 0;
function paidEvent(booking: { id: string; total_amount: string; stripe_session_id: string | null }, holdId: string, eventId = `evt_an_${++evtSeq}`): Stripe.Event {
  return {
    id: eventId,
    type: 'checkout.session.completed',
    livemode: false,
    data: { object: { id: booking.stripe_session_id, object: 'checkout.session', amount_total: Math.round(parseFloat(booking.total_amount) * 100), currency: 'usd', payment_status: 'paid', payment_intent: `pi_${booking.stripe_session_id}`, metadata: { bookingId: booking.id, holdId } } },
  } as unknown as Stripe.Event;
}

const VENDOR_ENV = {
  NEXT_PUBLIC_GA4_MEASUREMENT_ID: 'G-TEST123',
  GA4_API_SECRET: 'ga4-secret-value',
  NEXT_PUBLIC_META_PIXEL_ID: '1234567890',
  META_CONVERSIONS_API_TOKEN: 'meta-token-value',
  REDDIT_PIXEL_ID: 't2_pixel',
  REDDIT_CONVERSIONS_ACCESS_TOKEN: 'reddit-token-value',
  PINTEREST_AD_ACCOUNT_ID: '549755885175',
  PINTEREST_CONVERSIONS_ACCESS_TOKEN: 'pin-token-value',
  TIKTOK_PIXEL_CODE: 'CTEST123',
  TIKTOK_EVENTS_ACCESS_TOKEN: 'tiktok-token-value',
  TIKTOK_TEST_EVENT_CODE: 'TEST999',
};

let sent: { destination: string; url: string; body: any }[] = [];
let failNext: Set<string> = new Set();

function enableVendors() {
  Object.assign(process.env, VENDOR_ENV);
  __setAnalyticsTestRuntime({
    vendorsAllowed: true,
    transport: async (req) => {
      if (failNext.has(req.destination)) {
        failNext.delete(req.destination);
        throw new Error(`network down for access_token=${'x'.repeat(8)}`);
      }
      sent.push({ destination: req.destination, url: req.url, body: JSON.parse(req.body) });
      return { ok: true, status: 200, text: '{}' };
    },
  });
}
function disableVendors() {
  for (const k of Object.keys(VENDOR_ENV)) delete process.env[k];
  __setAnalyticsTestRuntime({ vendorsAllowed: null, transport: null });
}

beforeAll(async () => {
  ids = await seedCatalog(pg);
});
beforeEach(() => {
  sent = [];
  failNext = new Set();
});
afterEach(() => disableVendors());

// ---------------------------------------------------------------------------

describe('collect endpoint', () => {
  it('without a consent choice: stores cookieless events and sets no identifier cookie', async () => {
    const b = new Browser(null);
    const res = await b.collect([ev('page_view', '/pricing')]);
    expect(res.status).toBe(200);
    expect(b.jar.has('zayro_vid')).toBe(false);
    expect(b.jar.has('zayro_sid')).toBe(false);
    expect(await count('analytics_events', `page_path = '/pricing' AND visitor_id IS NULL AND session_id IS NULL`)).toBeGreaterThan(0);
  });

  it('with analytics consent: creates a pseudonymous visitor and session (hashed cookie values only)', async () => {
    const b = new Browser(true, false);
    const visitorsBefore = await count('analytics_visitors');
    await b.collect([ev('page_view', '/podcast-studio-nyc')], { utm: { utm_source: 'reddit', utm_medium: 'paid_social', utm_campaign: 'nyc_q4' }, clickIds: { rdt_cid: 'reddit-click-1' }, landingPath: '/podcast-studio-nyc', referrer: 'https://www.reddit.com/' });
    expect(b.jar.get('zayro_vid')).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    expect(b.jar.get('zayro_sid')).toBeTruthy();
    expect(await count('analytics_visitors')).toBe(visitorsBefore + 1);
    const s = (await pg.query<any>(`SELECT * FROM analytics_sessions ORDER BY created_at DESC LIMIT 1`)).rows[0];
    expect(s).toMatchObject({ session_source: 'reddit', session_medium: 'paid_social', channel: 'paid_social', platform: 'reddit', page_view_count: 1, consent_advertising: false });
    // Click IDs need Advertising consent.
    expect(s.click_ids_encrypted).toBeNull();
    expect(s.click_id_types).toBeNull();
    const raw = JSON.stringify((await pg.query(`SELECT * FROM analytics_visitors`)).rows) + JSON.stringify((await pg.query(`SELECT * FROM analytics_sessions`)).rows);
    expect(raw).not.toContain(b.jar.get('zayro_vid'));
    expect(raw).not.toContain('reddit-click-1');
  });

  it('with advertising consent: click IDs are stored encrypted, never in clear text', async () => {
    const b = new Browser(true, true);
    await b.collect([ev('page_view', '/')], { utm: { utm_source: 'tiktok', utm_medium: 'paid_social' }, clickIds: { ttclid: 'tiktok-click-xyz' }, landingPath: '/' });
    const s = (await pg.query<any>(`SELECT * FROM analytics_sessions ORDER BY created_at DESC LIMIT 1`)).rows[0];
    expect(s.click_id_types).toBe('ttclid');
    expect(s.click_ids_encrypted).toMatch(/^v1\./);
    expect(JSON.stringify(s)).not.toContain('tiktok-click-xyz');
  });

  it('Global Privacy Control (Sec-GPC: 1) overrides an "Accept all": analytics recorded, ad click IDs dropped', async () => {
    const b = new Browser(true, true);
    const res = await collectRoute.POST(
      b.request('/api/analytics/collect', { events: [ev('page_view', '/')], touch: { utm: { utm_source: 'facebook', utm_medium: 'paid_social' }, clickIds: { fbclid: 'fb-gpc-click' }, landingPath: '/' } }, { 'sec-gpc': '1' })
    );
    expect(res.status).toBe(200);
    const s = (await pg.query<any>(`SELECT * FROM analytics_sessions ORDER BY created_at DESC LIMIT 1`)).rows[0];
    expect(s.click_ids_encrypted).toBeNull();
    expect(s.click_id_types ?? '').toBe('');
    expect(JSON.stringify(s)).not.toContain('fb-gpc-click');
  });

  it('ignores duplicate event IDs and rejects forged purchases, unknown events and PII', async () => {
    const b = new Browser(true, false);
    const e = ev('booking_started', '/booking', { category: 'podcast' });
    await b.collect([e]);
    const res = await b.collect([e, ev('purchase', '/booking/success', { value: 99999 }), { ...ev('purchase_confirmed', '/booking/success'), properties: {} }, ev('nope'), ev('contact_started', '/contact', { topic: 'me@example.com' })]);
    const body = await res.json();
    expect(body.rejected).toEqual({ server_only_event: 2, unknown_event: 1, pii_detected: 1 });
    expect(await count('analytics_events', `external_event_id = '${e.eventId}'`)).toBe(1);
    expect(await count('analytics_events', `event_name IN ('purchase', 'purchase_confirmed') AND source = 'browser'`)).toBe(0);
  });

  it('enforces the body limit and the payload shape', async () => {
    const b = new Browser(true);
    const big = await collectRoute.POST(b.request('/api/analytics/collect', { events: [ev('page_view', `/${'x'.repeat(9000)}`)] }));
    expect(big.status).toBe(413);
    const bad = await collectRoute.POST(b.request('/api/analytics/collect', { events: [{ name: 'page_view' }] }));
    expect(bad.status).toBe(400);
  });

  it('excludes bots, automated browsers and signed-in admins', async () => {
    const before = await count('analytics_events');
    const b = new Browser(true);
    expect((await collectRoute.POST(b.request('/api/analytics/collect', { events: [ev('page_view')] }, { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' }))).status).toBe(204);
    expect((await collectRoute.POST(b.request('/api/analytics/collect', { events: [ev('page_view')] }, { 'user-agent': 'vercel-favicon/1.0 health check' }))).status).toBe(204);
    expect((await b.collect([ev('page_view')], undefined, { automated: true })).status).toBe(204);
    expect((await collectRoute.POST(b.request('/api/analytics/collect', { events: [ev('page_view')] }, { cookie: `${b.cookieHeader()}; zayro_admin_session=x` }))).status).toBe(204);
    expect(await count('analytics_events')).toBe(before);
  });

  it('a new session starts after 30 minutes of inactivity', async () => {
    const consent = { version: CONSENT_VERSION, consentId: 'sessiontestconsent0001', analytics: true, advertising: false, decidedAt: 1 };
    const t0 = new Date('2031-03-01T10:00:00Z');
    const v1 = (await resolveVisit({ consent, visitorCookie: null, sessionCookie: null, touch: null, vendorIds: {}, userAgent: UA, path: '/', now: t0 }))!;
    const vid = v1.setVisitorCookie!;
    const sid = v1.setSessionCookie!;
    // Activity every 29 minutes keeps the session.
    const v2 = (await resolveVisit({ consent, visitorCookie: vid, sessionCookie: sid, touch: null, vendorIds: {}, userAgent: UA, path: '/a', now: new Date(t0.getTime() + 29 * 60000) }))!;
    expect(v2.sessionId).toBe(v1.sessionId);
    const v3 = (await resolveVisit({ consent, visitorCookie: vid, sessionCookie: sid, touch: null, vendorIds: {}, userAgent: UA, path: '/b', now: new Date(t0.getTime() + 58 * 60000) }))!;
    expect(v3.sessionId).toBe(v1.sessionId);
    // 31 minutes of silence: new session, same visitor (returning).
    const v4 = (await resolveVisit({ consent, visitorCookie: vid, sessionCookie: sid, touch: null, vendorIds: {}, userAgent: UA, path: '/c', now: new Date(t0.getTime() + 89 * 60000) }))!;
    expect(v4.sessionId).not.toBe(v1.sessionId);
    expect(v4.visitorId).toBe(v1.visitorId);
    expect((await pg.query<any>(`SELECT is_returning FROM analytics_sessions WHERE id = '${v4.sessionId}'`)).rows[0].is_returning).toBe(true);
    // A new paid click inside an active session starts a new session too.
    const v5 = (await resolveVisit({ consent, visitorCookie: vid, sessionCookie: v4.setSessionCookie!, touch: { utm: { utm_source: 'pinterest', utm_medium: 'paid_social' }, clickIds: {}, landingPath: '/', referrerHost: null }, vendorIds: {}, userAgent: UA, path: '/', now: new Date(t0.getTime() + 90 * 60000) }))!;
    expect(v5.sessionId).not.toBe(v4.sessionId);
  });
});

describe('consent changes', () => {
  it('withdrawal deletes identifier cookies and stops future advertising deliveries', async () => {
    const b = new Browser(true, true);
    await b.collect([ev('page_view', '/')], { utm: { utm_source: 'facebook', utm_medium: 'paid_social' }, clickIds: { fbclid: 'fb-click-1' }, landingPath: '/' });
    await b.collect([ev('page_view', '/pricing')], undefined, { vendorIds: { fbp: 'fb.1.1.2', ga: 'GA1.1.333.444' } });
    expect(b.jar.has('zayro_vid')).toBe(true);
    enableVendors();
    failNext = new Set(['meta_capi', 'ga4', 'reddit_capi', 'pinterest_capi', 'tiktok_events_api']);
    const res = await contactRoute.POST(b.request('/api/contact', { name: 'Jane', email: 'jane@example.com', message: 'Hello' }));
    // Resend is not configured in tests → 503, no lead event. Configure a fake sender.
    expect(res.status).toBe(503);
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'studio@zayro.test';
    process.env.OWNER_EMAIL = 'owner@zayro.test';
    h.resendSend = vi.fn(async () => ({ error: null }));
    try {
      failNext = new Set(['meta_capi']);
      const ok = await contactRoute.POST(b.request('/api/contact', { name: 'Jane', email: 'jane@example.com', message: 'Hello' }));
      const body = await ok.json();
      expect(ok.status).toBe(200);
      expect(body.conversion).toMatchObject({ name: 'contact_submitted', valueCents: null });
      const evRow = (await pg.query<any>(`SELECT * FROM analytics_events WHERE external_event_id = '${body.conversion.eventId}'`)).rows[0];
      expect(evRow).toMatchObject({ event_name: 'contact_submitted', source: 'server', consent_advertising: true });
      expect(JSON.stringify(evRow)).not.toMatch(/jane|Hello/i);
      const failed = await count('analytics_deliveries', `external_event_id = '${body.conversion.eventId}' AND destination = 'meta_capi' AND status = 'failed'`);
      expect(failed).toBe(1);

      // Withdraw everything: cookies go, the failed Meta delivery will not be retried.
      b.setConsent(false, false);
      const w = await consentRoute.POST(b.request('/api/analytics/consent', { action: 'withdraw' }));
      b.absorb(w);
      expect(w.status).toBe(200);
      expect(b.jar.has('zayro_vid')).toBe(false);
      expect(await count('analytics_deliveries', `external_event_id = '${body.conversion.eventId}' AND destination = 'meta_capi' AND status = 'skipped' AND last_error_sanitized = 'consent_withdrawn'`)).toBe(1);
      expect(await count('analytics_consents', `action = 'withdraw' AND analytics = false AND advertising = false`)).toBeGreaterThan(0);
      sent = [];
      await pg.query(`UPDATE analytics_deliveries SET next_retry_at = now() - interval '1 minute'`);
      await processDueDeliveries({ limit: 200 });
      expect(sent.filter((s) => s.destination === 'meta_capi' && JSON.stringify(s.body).includes(body.conversion.eventId))).toHaveLength(0);
    } finally {
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FROM;
      delete process.env.OWNER_EMAIL;
    }
  });
});

describe('booking conversions', () => {
  it('checkout snapshots attribution; only the webhook creates the purchase; duplicates are ignored', async () => {
    const b = new Browser(true, true);
    // Paid Reddit visit, then a later direct visit in a new session.
    await b.collect([ev('page_view', '/podcast-studio-nyc')], { utm: { utm_source: 'reddit', utm_medium: 'paid_social', utm_campaign: 'nyc_podcast_studio_bookings_2026q4', utm_content: 'video_studio-tour_v1' }, clickIds: { rdt_cid: 'rdt-abc' }, landingPath: '/podcast-studio-nyc' });
    await pg.query(`UPDATE analytics_sessions SET last_seen_at = now() - interval '2 hours', started_at = now() - interval '2 hours' WHERE visitor_id = (SELECT visitor_id FROM analytics_sessions ORDER BY created_at DESC LIMIT 1)`);
    await b.collect([ev('page_view', '/'), ev('booking_started', '/booking', { category: 'podcast' })], { utm: {}, clickIds: {}, landingPath: '/', referrer: null }, { vendorIds: { ga: 'GA1.1.555.666', fbp: 'fb.1.1.1' } });

    enableVendors();
    const { booking, body, holdId } = await bookPaid(b);
    expect(body.conversion).toMatchObject({ name: 'checkout_created', eventId: eventIds.checkout(booking.id), currency: 'USD' });
    const att = (await pg.query<any>(`SELECT * FROM analytics_attributions WHERE booking_id = '${booking.id}'`)).rows[0];
    expect(att.last_non_direct_touch).toMatchObject({ source: 'reddit', medium: 'paid_social', campaign: 'nyc_podcast_studio_bookings_2026q4', platform: 'reddit' });
    expect(att.conversion_touch).toMatchObject({ channel: 'direct' });
    expect(att.first_touch).toMatchObject({ source: 'reddit' });
    expect(JSON.stringify(att)).not.toContain('rdt-abc');
    expect(await count('analytics_events', `event_name = 'checkout_created' AND booking_id = '${booking.id}'`)).toBe(1);
    expect(await count('analytics_events', `event_name = 'purchase_confirmed' AND booking_id = '${booking.id}'`)).toBe(0);

    // Not paid yet: the success page gets no conversion.
    const pending = await (await verifySessionRoute.POST(b.request('/api/booking/verify-session', { sessionId: booking.stripe_session_id }))).json();
    expect(pending.conversion).toBeUndefined();

    sent = [];
    const r1 = await processStripeEvent(paidEvent(booking, holdId));
    expect(r1.body.status).toBe('booking_confirmed');
    const r2 = await processStripeEvent(paidEvent(booking, holdId)); // Stripe resends a new event id
    expect(r2.body.status).toBe('already_processed');
    const r3 = await processStripeEvent(paidEvent(booking, holdId, 'evt_an_1_dup'));
    expect(r3.httpStatus).toBe(200);

    const purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, booking.purchase_id) });
    const purchaseEventId = eventIds.purchase(purchase.id);
    expect(await count('analytics_events', `event_name = 'purchase_confirmed'  AND booking_id = '${booking.id}'`)).toBe(1);
    const row = (await pg.query<any>(`SELECT * FROM analytics_events WHERE external_event_id = '${purchaseEventId}'`)).rows[0];
    expect(row).toMatchObject({ source: 'server', value_cents: purchase.total_cents, currency: 'USD' });
    expect(JSON.stringify(row)).not.toMatch(/ada@|lovelace|212 555|Private project|cs_test|pi_cs/i);

    // One delivery per destination, all with the same internal event ID.
    const purchaseSends = sent.filter((s) => JSON.stringify(s.body).includes(purchaseEventId));
    expect(purchaseSends.map((s) => s.destination).sort()).toEqual(['ga4', 'meta_capi', 'reddit_capi']);
    const reddit = purchaseSends.find((s) => s.destination === 'reddit_capi')!.body.data.events[0];
    expect(reddit).toMatchObject({ type: { tracking_type: 'Purchase' }, click_id: 'rdt-abc', metadata: { conversion_id: purchaseEventId, currency: 'USD', value: purchase.total_cents / 100 } });
    expect(purchaseSends.find((s) => s.destination === 'ga4')!.body.events[0].params.transaction_id).toBe(purchaseEventId);
    // Pinterest / TikTok have no match key for this visitor → recorded as skipped, not sent.
    expect(await count('analytics_deliveries', `external_event_id = '${purchaseEventId}' AND destination IN ('pinterest_capi', 'tiktok_events_api') AND status = 'skipped' AND last_error_sanitized = 'no_match_keys'`)).toBe(2);
    expect(sent.every((s) => !JSON.stringify(s.body).match(/ada@example|Lovelace|\+1 212/))).toBe(true);

    // The success page now carries the same ID for browser pixels.
    const confirmed = await (await verifySessionRoute.POST(b.request('/api/booking/verify-session', { sessionId: booking.stripe_session_id }))).json();
    expect(confirmed.conversion).toMatchObject({ name: 'purchase_confirmed', eventId: purchaseEventId, transactionId: purchaseEventId, valueCents: purchase.total_cents });

    // Browser pixel dispatch report → dedup pair recorded (one row per destination, idempotent).
    await b.collect([], undefined, { dispatch: { eventId: purchaseEventId, destinations: ['meta_pixel', 'reddit_pixel', 'meta_capi'] } });
    await b.collect([], undefined, { dispatch: { eventId: purchaseEventId, destinations: ['meta_pixel'] } });
    expect(await count('analytics_deliveries', `external_event_id = '${purchaseEventId}' AND channel = 'browser'`)).toBe(2);
    expect(await count('analytics_deliveries', `external_event_id = '${purchaseEventId}' AND destination = 'meta_capi'`)).toBe(1);
  });

  it('a failing destination never affects the booking, and retries reuse the same event ID', async () => {
    const b = new Browser(true, true);
    await b.collect([ev('page_view', '/')], { utm: { utm_source: 'tiktok', utm_medium: 'paid_social' }, clickIds: { ttclid: 'tt-retry' }, landingPath: '/' });
    enableVendors();
    failNext = new Set(['tiktok_events_api', 'ga4', 'meta_capi', 'reddit_capi', 'pinterest_capi']);
    const { booking, holdId } = await bookPaid(b);
    failNext = new Set(['tiktok_events_api']);
    const out = await processStripeEvent(paidEvent(booking, holdId));
    expect(out.httpStatus).toBe(200);
    const fresh = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    expect(fresh).toMatchObject({ status: 'confirmed', payment_status: 'succeeded' });
    const purchaseEventId = eventIds.purchase(fresh.purchase_id);
    const d = (await pg.query<any>(`SELECT * FROM analytics_deliveries WHERE external_event_id = '${purchaseEventId}' AND destination = 'tiktok_events_api'`)).rows[0];
    expect(d).toMatchObject({ status: 'failed', attempts: 1 });
    expect(d.last_error_sanitized).not.toContain('xxxxxxxx');
    sent = [];
    await pg.query(`UPDATE analytics_deliveries SET next_retry_at = now() - interval '1 minute' WHERE id = '${d.id}'`);
    await processDueDeliveries({ limit: 50 });
    const retried = sent.filter((s) => s.destination === 'tiktok_events_api');
    expect(retried).toHaveLength(1);
    expect(retried[0].body.data[0]).toMatchObject({ event: 'CompletePayment', event_id: purchaseEventId, user: { ttclid: 'tt-retry' } });
    expect(retried[0].body.test_event_code).toBe('TEST999');
    expect((await pg.query<any>(`SELECT status, attempts FROM analytics_deliveries WHERE id = '${d.id}'`)).rows[0]).toMatchObject({ status: 'delivered', attempts: 2 });
  });

  it('without consent the purchase is still counted internally but never sent to ad platforms', async () => {
    const b = new Browser(false, false);
    enableVendors();
    const { booking, holdId } = await bookPaid(b);
    await processStripeEvent(paidEvent(booking, holdId));
    const fresh = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    const id = eventIds.purchase(fresh.purchase_id);
    expect(await count('analytics_events', `external_event_id = '${id}'`)).toBe(1);
    expect(sent.filter((s) => JSON.stringify(s.body).includes(id))).toHaveLength(0);
    expect(await count('analytics_deliveries', `external_event_id = '${id}' AND status = 'skipped' AND last_error_sanitized = 'no_consent'`)).toBe(5);
    const att = (await pg.query<any>(`SELECT * FROM analytics_attributions WHERE booking_id = '${booking.id}'`)).rows[0];
    expect(att).toMatchObject({ visitor_id: null, consent_advertising: false, last_non_direct_touch: null });
  });

  it('free studio tour: one tour_confirmed event, with the same ID on the success page', async () => {
    const tour = (await pg.query<{ id: number }>(`SELECT id FROM services WHERE category = 'tour' AND is_active ORDER BY id LIMIT 1`)).rows[0];
    expect(tour).toBeTruthy();
    const service = await db.query.services.findFirst({ where: eq(schema.services.id, tour.id) });
    const b = new Browser(true, false);
    await b.collect([ev('tour_cta_clicked', '/', { placement: 'header' }), ev('tour_booking_started', '/booking')]);
    const date = nextDate();
    const end = `${String(10 + Math.floor(service.duration_minutes / 60)).padStart(2, '0')}:${String(service.duration_minutes % 60).padStart(2, '0')}`;
    const hold = await (await holdRoute.POST(b.request('/api/booking/create-hold', { customer_email: 'tour@example.com', service_id: tour.id, booking_date: date, start_time: '10:00', end_time: end, duration_minutes: service.duration_minutes }))).json();
    expect(hold.hold_id, JSON.stringify(hold)).toBeTruthy();
    const res = await freeRoute.POST(b.request('/api/booking/confirm-free', { holdId: hold.hold_id, firstName: 'Tess', lastName: 'Tour', email: 'tour@example.com', phone: '+1 212 555 0199', intake: {} }));
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.conversion).toMatchObject({ name: 'tour_confirmed', valueCents: 0 });
    const booking = await db.query.bookings.findFirst({ where: eq(schema.bookings.booking_id, body.bookingId) });
    expect(await count('analytics_events', `event_name = 'tour_confirmed' AND booking_id = '${booking.id}'`)).toBe(1);
    expect(body.conversion.eventId).toBe(eventIds.freeBooking(booking.id));
    // Retried confirm (same hold) never creates a second conversion.
    await freeRoute.POST(b.request('/api/booking/confirm-free', { holdId: hold.hold_id, firstName: 'Tess', lastName: 'Tour', email: 'tour@example.com', phone: '+1 212 555 0199', intake: {} }));
    expect(await count('analytics_events', `event_name = 'tour_confirmed' AND booking_id = '${booking.id}'`)).toBe(1);
  });

  it('refunds reduce net revenue but leave the acquisition snapshot untouched; extension revenue keeps the booking source', async () => {
    const b = new Browser(true, false);
    await b.collect([ev('page_view', '/')], { utm: { utm_source: 'pinterest', utm_medium: 'paid_social', utm_campaign: 'pins' }, clickIds: {}, landingPath: '/' });
    const { booking, holdId } = await bookPaid(b);
    await processStripeEvent(paidEvent(booking, holdId));
    const purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, booking.purchase_id) });
    const before = (await pg.query<any>(`SELECT last_non_direct_touch, first_touch, conversion_touch FROM analytics_attributions WHERE booking_id = '${booking.id}'`)).rows[0];

    // A succeeded refund (as the webhook records it) → one refund event, idempotent.
    const refund = await db.insert(schema.refunds).values({ purchase_id: purchase.id, booking_id: booking.id, amount_cents: 5000, status: 'succeeded', stripe_refund_id: `re_an_${booking.id.slice(0, 8)}`, source: 'stripe' }).returning();
    const { analyticsRefundsSucceeded, analyticsExtensionPurchased } = await import('./server/hooks');
    await analyticsRefundsSucceeded(purchase.id);
    await analyticsRefundsSucceeded(purchase.id);
    const refundEvent = (await pg.query<any>(`SELECT * FROM analytics_events WHERE external_event_id = '${eventIds.refund(refund[0].id)}'`)).rows;
    expect(refundEvent).toHaveLength(1);
    expect(refundEvent[0]).toMatchObject({ event_name: 'refund_succeeded', value_cents: 5000 });
    expect(refundEvent[0].properties.transaction_id).toBe(eventIds.purchase(purchase.id));
    const after = (await pg.query<any>(`SELECT last_non_direct_touch, first_touch, conversion_touch FROM analytics_attributions WHERE booking_id = '${booking.id}'`)).rows[0];
    expect(after).toEqual(before);

    // An extension purchase on the same booking.
    const ext = await db.insert(schema.purchases).values({ order_number: `EXT-${booking.booking_id}`, type: 'extension', status: 'paid', subtotal_cents: 20000, total_cents: 21775, tax_cents: 1775, purchased_at: new Date() }).returning();
    await db.insert(schema.bookingExtensions).values({ booking_id: booking.id, purchase_id: ext[0].id, added_minutes: 60, previous_end_time: '11:00', new_end_time: '12:00', previous_duration_minutes: 60, new_duration_minutes: 120, status: 'confirmed' });
    await analyticsExtensionPurchased(booking.id, ext[0].id);
    expect(await count('analytics_events', `event_name = 'extension_purchased' AND purchase_id = '${ext[0].id}'`)).toBe(1);

    const today = new Date().toISOString().slice(0, 10);
    const range = { from: '2020-01-01', to: '2035-12-31' };
    const platforms = await metrics.platformBreakdown(range, 'last_non_direct');
    const pin = platforms.find((p) => p.platform === 'pinterest')!;
    expect(pin.gross).toBeGreaterThanOrEqual(purchase.total_cents + 21775);
    expect(pin.refunds).toBeGreaterThanOrEqual(5000);
    expect(pin.net).toBe(pin.gross - pin.refunds);
    expect(today).toBeTruthy();
  });
});

describe('dashboard and export', () => {
  it('revenue totals match the CRM dashboard exactly', async () => {
    const range = { from: '2020-01-01', to: '2035-12-31' };
    const [o, money, platforms] = await Promise.all([metrics.overview(range), moneyMetrics(range), metrics.platformBreakdown(range, 'last_non_direct')]);
    expect(o.gross).toBe(money.gross);
    expect(o.refunds).toBe(money.refunds);
    expect(o.net).toBe(money.net);
    expect(platforms.reduce((a, p) => a + p.gross, 0)).toBe(money.gross);
    expect(platforms.reduce((a, p) => a + p.refunds, 0)).toBe(money.refunds);
    expect(o.paidBookings).toBeGreaterThan(0);
    expect(o.averageOrderValue).toBeGreaterThan(0);
    const [booking, tour, contact] = await metrics.funnels(range);
    expect(booking.find((s) => s.key === 'purchase')!.value).toBeGreaterThan(0);
    expect(tour.find((s) => s.key === 'tour_confirmed')!.value).toBeGreaterThan(0);
    expect(contact.find((s) => s.key === 'contact_submitted')!.value).toBeGreaterThan(0);
  });

  it('dashboard data never contains click IDs or customer data', async () => {
    const range = { from: '2020-01-01', to: '2035-12-31' };
    const all = await Promise.all([
      metrics.overview(range),
      metrics.timeSeries({ from: '2031-01-01', to: '2031-01-31' }),
      metrics.platformBreakdown(range, 'first'),
      metrics.campaignBreakdown(range, 'conversion'),
      metrics.segmentBreakdowns(range),
      metrics.deliveryHealth(range),
    ]);
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/rdt-abc|tt-retry|fb-click|tiktok-click|reddit-click|ada@|jane@|tour@|Lovelace|Private project|cs_test|pi_cs|ZAY-|v1\.[A-Za-z0-9_-]{10}/);
  });

  it('aggregate export: analytics.export only, no PII, formula-safe, audited', async () => {
    const analyst = await db.query.roles.findFirst({ where: eq(schema.roles.name, 'Marketing Analyst') });
    expect(analyst).toMatchObject({ is_system: true, permissions: ['analytics.read', 'analytics.export'] });
    await db.insert(schema.adminProfiles).values({ email: 'analyst@zayro.test', normalized_email: 'analyst@zayro.test', role_id: analyst.id });
    // A hostile campaign name.
    const b = new Browser(true);
    await b.collect([ev('page_view', '/')], { utm: { utm_source: '=cmd|calc', utm_medium: 'cpc', utm_campaign: '+sum(1)' }, clickIds: {}, landingPath: '/' });

    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const q0 = `from=${iso(new Date(Date.now() - 30 * 86400000))}&to=${iso(new Date(Date.now() + 2 * 86400000))}`;
    const get = (q = q0) => exportRoute.GET(new NextRequest(`http://localhost/api/admin/analytics/export?${q}`));
    h.sessionToken = createSessionToken('analyst@zayro.test');
    const res = await get();
    expect(res.status).toBe(200);
    const csv = await res.text();
    const header = csv.replace(/^﻿/, '').split('\r\n')[0];
    expect(header).toBe('Date (ET),Source,Medium,Campaign,Sessions,Visitors,Page views,Booking starts,Checkouts,Purchases,Gross revenue (USD),Refunds (USD),Net revenue (USD),Booking start rate (starts / sessions),Purchase rate (purchases / sessions)');
    expect(csv).toContain("'=cmd|calc");
    expect(csv).toContain("'+sum(1)");
    expect(csv).not.toMatch(/@|Lovelace|\+1 212|cs_test|pi_|ZAY-|rdt-abc|tt-retry|fb-click|10\.9\.|Mozilla/);
    expect(await count('audit_logs', `operation = 'analytics.export' AND actor_email = 'analyst@zayro.test'`)).toBe(1);

    const producer = await db.query.roles.findFirst({ where: eq(schema.roles.name, 'Producer') });
    await db.insert(schema.adminProfiles).values({ email: 'producer2@zayro.test', normalized_email: 'producer2@zayro.test', role_id: producer.id });
    h.sessionToken = createSessionToken('producer2@zayro.test');
    expect((await get()).status).toBe(403);
    h.sessionToken = null;
    expect((await get()).status).toBe(401);
  });
});

describe('Marketing Analyst is denied everything operational (direct URL / API access)', () => {
  it('server-side 403 on bookings, customers, purchases, prices, refunds, integrations, settings, team, audit and CSV exports', async () => {
    h.sessionToken = createSessionToken('analyst@zayro.test');
    const req = (method: string, path: string, body?: unknown) =>
      new NextRequest(`http://localhost${path}`, { method, headers: { host: 'localhost', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const anyId = '00000000-0000-4000-8000-000000000000';
    const calls: [string, () => Promise<Response>][] = [
      ['bookings POST', async () => (await import('@/app/api/admin/bookings/route')).POST(req('POST', '/api/admin/bookings', {}))],
      ['booking cancel', async () => (await import('@/app/api/admin/bookings/[id]/cancel/route')).POST(req('POST', `/api/admin/bookings/${anyId}/cancel`, {}), { params: { id: anyId } })],
      ['booking reschedule', async () => (await import('@/app/api/admin/bookings/[id]/reschedule/route')).POST(req('POST', `/api/admin/bookings/${anyId}/reschedule`, {}), { params: { id: anyId } })],
      ['customers search', async () => (await import('@/app/api/admin/customers/search/route')).GET(req('GET', '/api/admin/customers/search?q=a'))],
      ['customer update', async () => (await import('@/app/api/admin/customers/[id]/route')).PATCH(req('PATCH', `/api/admin/customers/${anyId}`, { firstName: 'x' }), { params: { id: anyId } })],
      ['refund', async () => (await import('@/app/api/admin/purchases/[id]/refund/route')).POST(req('POST', `/api/admin/purchases/${anyId}/refund`, {}), { params: { id: anyId } })],
      ['mark paid', async () => (await import('@/app/api/admin/purchases/[id]/mark-paid/route')).POST(req('POST', `/api/admin/purchases/${anyId}/mark-paid`, {}), { params: { id: anyId } })],
      ['services list', async () => (await import('@/app/api/admin/services/route')).GET(req('GET', '/api/admin/services'))],
      ['service price edit', async () => (await import('@/app/api/admin/services/route')).PATCH(req('PATCH', '/api/admin/services', { id: ids['Podcast Pro'], base_price: 1 }))],
      ['add-ons', async () => (await import('@/app/api/admin/addons/route')).GET(req('GET', '/api/admin/addons'))],
      ['availability edit', async () => (await import('@/app/api/admin/availability/route')).PATCH(req('PATCH', '/api/admin/availability', {}))],
      ['integrations', async () => (await import('@/app/api/admin/integrations/route')).GET(req('GET', '/api/admin/integrations'))],
      ['analytics delivery retry', async () => retryRoute.POST(req('POST', '/api/admin/analytics/deliveries', {}))],
      ['settings', async () => (await import('@/app/api/admin/settings/route')).PATCH(req('PATCH', '/api/admin/settings', { taxRate: 0 }))],
      ['team invite', async () => (await import('@/app/api/admin/team/route')).POST(req('POST', '/api/admin/team', { email: 'x@y.z', roleId: 1 }))],
      ['roles', async () => (await import('@/app/api/admin/roles/route')).POST(req('POST', '/api/admin/roles', { name: 'x', permissions: [] }))],
      ['sessions CSV', async () => (await import('@/app/api/admin/export/[kind]/route')).GET(req('GET', '/api/admin/export/sessions'), { params: { kind: 'sessions' } })],
      ['customers CSV', async () => (await import('@/app/api/admin/export/[kind]/route')).GET(req('GET', '/api/admin/export/customers'), { params: { kind: 'customers' } })],
      ['purchases CSV', async () => (await import('@/app/api/admin/export/[kind]/route')).GET(req('GET', '/api/admin/export/purchases'), { params: { kind: 'purchases' } })],
    ];
    for (const [label, call] of calls) {
      const res = await call();
      expect(res.status, label).toBe(403);
    }
    expect(await count('audit_logs', `operation = 'auth.permission_denied' AND actor_email = 'analyst@zayro.test'`)).toBeGreaterThanOrEqual(calls.length);
    h.sessionToken = null;
  });

  it('owner with integrations.retry can re-queue deliveries (audited)', async () => {
    h.sessionToken = createSessionToken('owner@zayro.test');
    const res = await retryRoute.POST(new NextRequest('http://localhost/api/admin/analytics/deliveries', { method: 'POST', headers: { host: 'localhost' } }));
    expect(res.status).toBe(200);
    expect(await count('audit_logs', `operation = 'analytics.retry_deliveries'`)).toBe(1);
    h.sessionToken = null;
  });
});

describe('vendor master switch (delivery queue)', () => {
  it('switch off: queued deliveries are left pending (never delivered or skipped) and no request is made; switching on sends each once, never re-sends delivered ones', async () => {
    const b = new Browser(true, true);
    await b.collect([ev('page_view', '/')], { utm: { utm_source: 'reddit', utm_medium: 'paid_social' }, clickIds: { rdt_cid: 'rdt-switch' }, landingPath: '/' });
    enableVendors();
    failNext = new Set(['ga4', 'meta_capi', 'reddit_capi', 'pinterest_capi', 'tiktok_events_api']); // queue them without delivering
    const { booking, holdId } = await bookPaid(b);
    failNext = new Set(['ga4', 'meta_capi', 'reddit_capi', 'pinterest_capi', 'tiktok_events_api']);
    await processStripeEvent(paidEvent(booking, holdId));
    const fresh = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    expect(fresh).toMatchObject({ status: 'confirmed', payment_status: 'succeeded' });
    const id = eventIds.purchase(fresh.purchase_id);
    await pg.query(`UPDATE analytics_deliveries SET status = 'pending', next_retry_at = now() - interval '1 minute' WHERE external_event_id = '${id}' AND status = 'failed'`);
    const before = (await pg.query<any>(`SELECT destination, status, attempts FROM analytics_deliveries WHERE external_event_id = '${id}' ORDER BY destination`)).rows;
    expect(before.find((r: any) => r.destination === 'reddit_capi')).toMatchObject({ status: 'pending' });

    // Switch off.
    __setAnalyticsTestRuntime({ vendorsAllowed: false });
    sent = [];
    expect(await processDueDeliveries({ limit: 200 })).toEqual({ delivered: 0, failed: 0, skipped: 0, dead: 0 });
    expect(sent).toHaveLength(0);
    expect((await pg.query<any>(`SELECT destination, status, attempts FROM analytics_deliveries WHERE external_event_id = '${id}' ORDER BY destination`)).rows).toEqual(before);

    // Switch on: pending ones go out once; a second run sends nothing more.
    __setAnalyticsTestRuntime({ vendorsAllowed: true });
    await processDueDeliveries({ limit: 200 });
    const reddit = sent.filter((s) => s.destination === 'reddit_capi' && JSON.stringify(s.body).includes(id));
    expect(reddit).toHaveLength(1);
    sent = [];
    await pg.query(`UPDATE analytics_deliveries SET next_retry_at = now() - interval '1 minute'`);
    await processDueDeliveries({ limit: 200 });
    expect(sent.filter((s) => JSON.stringify(s.body).includes(id))).toHaveLength(0);
    expect(await count('analytics_deliveries', `external_event_id = '${id}' AND destination = 'reddit_capi' AND status = 'delivered'`)).toBe(1);
  });

  it('switch off: bookings and the first-party record still work, nothing is queued for vendors', async () => {
    disableVendors();
    const b = new Browser(true, true);
    const { booking, holdId } = await bookPaid(b);
    await processStripeEvent(paidEvent(booking, holdId));
    const fresh = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, booking.id) });
    expect(fresh).toMatchObject({ status: 'confirmed', payment_status: 'succeeded' });
    const id = eventIds.purchase(fresh.purchase_id);
    expect(await count('analytics_events', `external_event_id = '${id}'`)).toBe(1);
    expect(await count('analytics_deliveries', `external_event_id = '${id}'`)).toBe(0);
  });
});

describe('retention', () => {
  it('deletes only old analytics rows, in batches, and never business records', async () => {
    const counts = async () => ({ bookings: await count('bookings'), purchases: await count('purchases'), refunds: await count('refunds'), attributions: await count('analytics_attributions') });
    const before = await counts();
    await pg.query(`INSERT INTO analytics_events (external_event_id, event_name, source, occurred_at, page_path) VALUES ('old-${Date.now()}', 'page_view', 'browser', now() - interval '14 months', '/')`);
    await pg.query(`UPDATE analytics_events SET occurred_at = now() - interval '14 months' WHERE event_name = 'purchase_confirmed'`);
    const result = await cleanupAnalytics();
    expect(result.events).toBeGreaterThanOrEqual(1);
    expect(await count('analytics_events', `occurred_at < now() - interval '13 months' AND booking_id IS NULL AND purchase_id IS NULL`)).toBe(0);
    // Conversion events tied to purchases are kept with the financial record.
    expect(await count('analytics_events', `event_name = 'purchase_confirmed'`)).toBeGreaterThan(0);
    expect(await counts()).toEqual(before);
    // Idempotent.
    expect((await cleanupAnalytics()).events).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('X Ads, abandoned checkouts and the KPI dashboard', () => {
  const X_ENV = {
    NEXT_PUBLIC_X_PIXEL_ID: 'o8z6j',
    X_EVENT_ID_PURCHASE: 'tw-o8z6j-o8z6k',
    X_EVENT_ID_CHECKOUT: 'tw-o8z6j-o8z6c',
    X_ADS_CONSUMER_KEY: 'x-consumer-key',
    X_ADS_CONSUMER_SECRET: 'x-consumer-secret-value',
    X_ADS_ACCESS_TOKEN: 'x-access-token-value',
    X_ADS_ACCESS_TOKEN_SECRET: 'x-access-secret-value',
  };
  afterEach(() => {
    for (const k of Object.keys(X_ENV)) delete process.env[k];
  });

  it('an X ad click (twclid) is attributed, and the paid booking reaches X once with conversion_id = the internal event ID', async () => {
    const b = new Browser(true, true);
    await b.collect([ev('page_view', '/podcast-studio-nyc')], { utm: { utm_source: 'twitter', utm_medium: 'paid_social', utm_campaign: 'x_podcast_q4' }, clickIds: { twclid: 'tw-click-1', gbraid: 'gb-1' }, landingPath: '/podcast-studio-nyc' });
    const session = (await pg.query<any>(`SELECT platform, session_source, click_id_types FROM analytics_sessions ORDER BY created_at DESC LIMIT 1`)).rows[0];
    expect(session).toMatchObject({ platform: 'x', session_source: 'x' });
    expect(session.click_id_types).toContain('twclid');

    enableVendors();
    Object.assign(process.env, X_ENV);
    const { booking, holdId } = await bookPaid(b);
    await processStripeEvent(paidEvent(booking, holdId));
    const purchase = await db.query.purchases.findFirst({ where: eq(schema.purchases.id, booking.purchase_id) });
    const purchaseEventId = eventIds.purchase(purchase.id);
    const xSends = sent.filter((s) => s.destination === 'x_capi');
    const xPurchase = xSends.find((s) => s.body.conversions[0].conversion_id === purchaseEventId)!;
    expect(xPurchase.url).toBe('https://ads-api.x.com/12/measurement/conversions/o8z6j');
    expect(xPurchase.body.conversions[0]).toMatchObject({ event_id: 'tw-o8z6j-o8z6k', identifiers: [{ twclid: 'tw-click-1' }], price_currency: 'USD', value: (purchase.total_cents / 100).toFixed(2) });
    expect(JSON.stringify(xSends)).not.toMatch(/ada@|lovelace|secret/i);
    expect(await count('analytics_deliveries', `external_event_id = '${purchaseEventId}' AND destination = 'x_capi'`)).toBe(1);
    // The checkout went to X too (its own event, its own ID).
    expect(xSends.some((s) => s.body.conversions[0].event_id === 'tw-o8z6j-o8z6c' && s.body.conversions[0].conversion_id !== purchaseEventId)).toBe(true);
  });

  it('an expired Checkout records one booking_abandoned (server-verified, never from a click)', async () => {
    const b = new Browser(true, false);
    await b.collect([ev('page_view', '/booking')]);
    const { booking, holdId } = await bookPaid(b, 'leaver@example.com');
    const expired = (id: string) =>
      ({ id, type: 'checkout.session.expired', livemode: false, data: { object: { id: booking.stripe_session_id, object: 'checkout.session', status: 'expired', metadata: { bookingId: booking.id, holdId } } } }) as unknown as Stripe.Event;
    expect((await processStripeEvent(expired('evt_exp_1'))).body.status).toBe('released');
    await processStripeEvent(expired('evt_exp_2'));
    expect(await count('analytics_events', `event_name = 'booking_abandoned' AND booking_id = '${booking.id}' AND source = 'server'`)).toBe(1);
    // The browser can't forge it.
    const res = await b.collect([ev('booking_abandoned', '/booking')]);
    expect(await count('analytics_events', `event_name = 'booking_abandoned' AND source = 'browser'`)).toBe(0);
    expect(res.status).toBeLessThan(500);
  });

  it('KPIs: platform filter, previous period, cancelled vs abandoned; the comparison table never invents ad spend', async () => {
    const { kpis, platformComparison, previousRange, change } = await import('./server/kpis');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const range = { from: today, to: today };
    const all = await kpis(range, 'last_non_direct');
    expect(all.paidBookings).toBeGreaterThanOrEqual(1);
    expect(all.abandonedBookings).toBeGreaterThanOrEqual(1);
    const xOnly = await kpis(range, 'last_non_direct', { platform: 'x' });
    expect(xOnly.paidBookings).toBe(1);
    expect(xOnly.visitors).toBe(1);
    expect(xOnly.gross).toBeGreaterThan(0);
    const none = await kpis(range, 'last_non_direct', { platform: 'instagram' });
    expect(none).toMatchObject({ paidBookings: 0, visitors: 0, gross: 0 });
    // Previous day: nothing yet → no relative change can be computed.
    const before = await kpis(previousRange(range), 'last_non_direct', { platform: 'x' });
    expect(before.paidBookings).toBe(0);
    expect(change(xOnly.paidBookings, before.paidBookings)).toBeNull();
    const rows = await platformComparison(range, 'last_non_direct');
    const x = rows.find((r) => r.platform === 'x' && r.campaign === 'x_podcast_q4')!;
    expect(x).toMatchObject({ clicks: 1, visits: 1, completed: 1, spend: null });
    expect(rows.every((r) => r.spend === null)).toBe(true);
  });
});

describe('analytics viewers (ANALYTICS_VIEWER_EMAILS)', () => {
  afterEach(() => {
    delete process.env.ANALYTICS_VIEWER_EMAILS;
    h.sessionToken = null;
  });

  it('get a Marketing Analyst profile on first sign-in: analytics only, audited, never duplicated', async () => {
    process.env.ANALYTICS_VIEWER_EMAILS = ' Viewer.One@Example.com ,viewer.two@example.com';
    const { canRequestLogin, resolveAdminProfile, requirePermission } = await import('@/lib/crm/auth');
    expect(await canRequestLogin('viewer.one@example.com')).toBe(true);
    expect(await canRequestLogin('someone.else@example.com')).toBe(false);
    const first = await resolveAdminProfile('VIEWER.ONE@example.com');
    expect(first?.role.name).toBe('Marketing Analyst');
    expect(first?.role.permissions).toEqual(['analytics.read', 'analytics.export']);
    await resolveAdminProfile('viewer.one@example.com');
    expect(await count('admin_profiles', `normalized_email = 'viewer.one@example.com'`)).toBe(1);
    expect(await count('audit_logs', `operation = 'team.invite' AND entity_id = '${first!.profile.id}'`)).toBe(1);

    // Signed in: analytics yes; settings, team, bookings, purchases no (server-side).
    h.sessionToken = createSessionToken('viewer.one@example.com');
    const req = (method = 'GET') => new NextRequest('http://localhost/api/admin/x', { method });
    expect((await requirePermission(req(), 'analytics.read')).ok).toBe(true);
    for (const p of ['settings.manage', 'team.manage', 'bookings.read', 'purchases.read', 'integrations.read', 'customers.read'] as const) {
      expect((await requirePermission(req(), p)).ok, p).toBe(false);
    }

    // An Owner can disable the profile; the env var never re-enables it.
    await pg.query(`UPDATE admin_profiles SET status = 'disabled' WHERE normalized_email = 'viewer.one@example.com'`);
    expect(await resolveAdminProfile('viewer.one@example.com')).toBeNull();
    expect(await canRequestLogin('viewer.one@example.com')).toBe(false);
  });
});
