import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import type Stripe from 'stripe';

const h = vi.hoisted(() => ({ sessions: new Map<string, any>(), creates: 0 }));
vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/pgliteDb');
  return createTestDb();
});
vi.mock('stripe', () => ({ default: class {
  checkout = { sessions: {
    create: async (p: any) => {
      const id = `cs_test_pkg${++h.creates}`;
      const session = { id, created: Math.floor(Date.now() / 1000), status: 'open', payment_status: 'unpaid', currency: 'usd', amount_total: p.line_items[0].price_data.unit_amount, metadata: p.metadata, url: `https://checkout.stripe.test/${id}`, payment_intent: `pi_${id}` };
      h.sessions.set(id, session); return session;
    },
    retrieve: async (id: string) => h.sessions.get(id),
    expire: async (id: string) => { const s = h.sessions.get(id); s.status = 'expired'; return s; },
  } };
  paymentIntents = { retrieve: async () => ({ created: Math.floor(Date.now() / 1000), latest_charge: { created: Math.floor(Date.now() / 1000) } }) };
} }));
vi.mock('@/lib/postConfirmation', () => ({ runPostConfirmationSideEffects: vi.fn(async () => ({})) }));
vi.mock('@/lib/crm/emailLog', () => ({ sendLoggedEmail: vi.fn(async () => ({ sent: true, status: 'sent' })) }));
process.env.STRIPE_SECRET_KEY = 'sk_test_package';
process.env.NEXTAUTH_SECRET = 'package-access-test-key';
const { db, pg } = await import('@/lib/db') as any;
const S = await import('@/lib/db/schema');
const P = await import('./publicPackages');
const { seedCatalog } = await import('@/test/pgliteDb');
const { todayInTz, addDays } = await import('@/lib/crm/time');
const { packageAccessToken, purchaseIdFromToken, PACKAGE_COOKIE } = await import('./packageAccess');
const { processStripeEvent } = await import('@/lib/crm/webhook');
const accessRoute = await import('@/app/api/packages/access/route');
const statusRoute = await import('@/app/api/packages/status/route');
const bookRoute = await import('@/app/api/packages/book/route');
const { cancelBooking } = await import('@/lib/cancelBooking');
let ids: Record<string, number>;
let n = 0;
let packageId: number;
let setupId: number;
beforeAll(async () => {
  ids = await seedCatalog(pg);
  await pg.query("UPDATE services SET package_base_service_id = $1 WHERE package_type = 'studio_recording'", [ids['Podcast Pro']]);
  await pg.query("UPDATE services SET package_base_service_id = $1 WHERE package_type = 'full_production'", [ids['Full Podcast Package']]);
  packageId = ids['2 Sessions per Month'];
  setupId = (await pg.query("SELECT id FROM setups WHERE slug = 'sofa-lounge'")).rows[0].id;
});
function post(url: string, body: unknown, cookie?: string) {
  return new NextRequest(`https://zayro.studio${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie: `${PACKAGE_COOKIE}=${cookie}` } : {}) }, body: JSON.stringify(body) });
}
async function start() {
  const input = { requestId: crypto.randomUUID(), serviceId: packageId, firstName: 'Ada', lastName: 'Test', email: `pkg${++n}@example.com`, phone: '+12125550100' };
  const result = await P.startPackageCheckout(input, 'https://zayro.studio');
  const session = h.sessions.get(result.sessionId);
  return { input, result, session, date: addDays(todayInTz(), n + 1) };
}
async function paid() {
  const state = await start();
  state.session.status = 'complete'; state.session.payment_status = 'paid';
  const result = await P.fulfillPackageSession(state.session);
  return { ...state, ...result };
}
async function hold(state: Awaited<ReturnType<typeof paid>>, start = '10:00', extra: Record<string, unknown> = {}) {
  const endHour = Number(start.slice(0, 2)) + 1;
  const [row] = await db.insert(S.temporaryHolds).values({
    service_id: ids['Podcast Pro'], booking_date: state.date, start_time: start,
    end_time: `${String(endHour).padStart(2, '0')}:00`, duration_minutes: 60, customer_email: state.input.email,
    hold_expires_at: new Date(Date.now() + 900000), status: 'active', selection: { units: 1, addons: [], setupId }, ...extra,
  }).returning();
  return row.id;
}
const intake = { peopleRecording: 2, recordingType: 'Podcast', editing: 'no' };

describe('public monthly package payment and scheduling', () => {
  it('reuses checkout on retries and snapshots the server price', async () => {
    const state = await start(); const count = h.creates;
    const again = await P.startPackageCheckout(state.input, 'https://zayro.studio');
    expect(again.sessionId).toBe(state.result.sessionId); expect(h.creates).toBe(count);
    const purchase = await db.query.purchases.findFirst({ where: eq(S.purchases.id, state.session.metadata.packagePurchaseId) });
    expect(purchase.subtotal_cents).toBe(36000); expect(purchase.total_cents).toBe(state.session.amount_total);
    expect(await db.query.customerPackages.findFirst({ where: eq(S.customerPackages.purchase_id, purchase.id) })).toBeUndefined();
    await expect(P.startPackageCheckout({ ...state.input, email: 'intruder@example.com' }, 'https://zayro.studio')).rejects.toThrow('restart');
  });
  it('grants no credit for unpaid or mismatched payment', async () => {
    const state = await start();
    await expect(P.fulfillPackageSession(state.session)).rejects.toThrow('processing');
    state.session.status = 'complete'; state.session.payment_status = 'paid'; state.session.amount_total = 1;
    await expect(P.fulfillPackageSession(state.session)).rejects.toThrow('review');
    const purchase = await db.query.purchases.findFirst({ where: eq(S.purchases.id, state.session.metadata.packagePurchaseId) });
    expect(purchase.needs_refund_review).toBe(true);
    expect(await db.query.customerPackages.findFirst({ where: eq(S.customerPackages.purchase_id, purchase.id) })).toBeUndefined();
  });
  it('duplicate webhook and return-page activation grant only one package', async () => {
    const state = await start(); state.session.status = 'complete'; state.session.payment_status = 'paid';
    const event = { id: 'evt_pkg_duplicate', type: 'checkout.session.completed', data: { object: state.session } } as Stripe.Event;
    expect((await processStripeEvent(event)).httpStatus).toBe(200);
    expect((await processStripeEvent(event)).body.duplicate).toBe(true);
    const again = await P.fulfillPackageSession(state.session);
    const rows = await db.query.customerPackages.findMany({ where: eq(S.customerPackages.purchase_id, again.purchaseId) });
    expect(rows).toHaveLength(1); expect(rows[0].remaining_credits).toBe(2);
    expect(await db.query.packageCreditTransactions.findMany({ where: eq(S.packageCreditTransactions.customer_package_id, rows[0].id) })).toHaveLength(1);
  });
  it('expiry does not activate a package', async () => {
    const state = await start();
    await P.expirePackageCheckout(state.session, 'cancelled');
    const purchase = await db.query.purchases.findFirst({ where: eq(S.purchases.id, state.session.metadata.packagePurchaseId) });
    expect(purchase.status).toBe('cancelled');
    expect(await db.query.customerPackages.findFirst({ where: eq(S.customerPackages.purchase_id, purchase.id) })).toBeUndefined();
  });
  it('sets private access only after verified payment; forged tokens and missing cookies are rejected', async () => {
    const state = await paid();
    const token = packageAccessToken(state.purchaseId);
    expect(purchaseIdFromToken(token)).toBe(state.purchaseId);
    expect(purchaseIdFromToken(`${state.purchaseId}.${'0'.repeat(64)}`)).toBeNull();
    expect((await accessRoute.POST(post('/api/packages/access', { token }))).headers.get('set-cookie')).toContain('HttpOnly');
    const access = await accessRoute.POST(post('/api/packages/access', { sessionId: state.session.id }));
    expect(access.status).toBe(200);
    expect((await statusRoute.GET(new NextRequest('https://zayro.studio/api/packages/status'))).status).toBe(403);
    expect((await bookRoute.POST(post('/api/packages/book', { holdId: crypto.randomUUID(), intake }))).status).toBe(403);
  });
  it('books separately without charging again and handles duplicate confirmation', async () => {
    const state = await paid(); const holdId = await hold(state);
    const first = await P.bookPackageSession(state.purchaseId, { holdId, intake });
    const again = await P.bookPackageSession(state.purchaseId, { holdId, intake });
    expect(again.bookingId).toBe(first.bookingId);
    const dashboard = await P.packageDashboard(state.purchaseId);
    expect(dashboard.remaining).toBe(1); expect(dashboard.sessions).toHaveLength(1);
    const row = await db.query.bookings.findFirst({ where: eq(S.bookings.booking_id, first.bookingId) });
    expect(row.source).toBe('package'); expect(row.total_amount).toBe('0.00'); expect(row.purchase_id).toBeNull();
    await cancelBooking(row.id, { email: 'staff@test.com' }, { reason: 'Customer changed date' });
    expect((await P.packageDashboard(state.purchaseId)).remaining).toBe(2);
  });
  it('two concurrent requests for the final credit yield only one confirmed booking', async () => {
    const state = await paid();
    await P.bookPackageSession(state.purchaseId, { holdId: await hold(state, '09:00'), intake });
    const a = await hold(state, '12:00'); const b = await hold(state, '15:00');
    const results = await Promise.allSettled([P.bookPackageSession(state.purchaseId, { holdId: a, intake }), P.bookPackageSession(state.purchaseId, { holdId: b, intake })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const dash = await P.packageDashboard(state.purchaseId);
    expect(dash.remaining).toBe(0); expect(dash.canBook).toBe(false); expect(dash.sessions).toHaveLength(2);
  });
  it('rejects other customers, wrong services, extras, invalid headcount and expiry', async () => {
    const state = await paid();
    await expect(P.bookPackageSession(state.purchaseId, { holdId: await hold(state, '09:00', { customer_email: 'other@example.com' }), intake })).rejects.toThrow('different customer');
    await expect(P.bookPackageSession(state.purchaseId, { holdId: await hold(state, '10:00', { service_id: ids['Full Podcast Package'] }), intake })).rejects.toThrow('standard session');
    await expect(P.bookPackageSession(state.purchaseId, { holdId: await hold(state, '11:00', { selection: { units: 1, addons: [{ id: 1, quantity: 1 }], setupId } }), intake })).rejects.toThrow('add-ons');
    await expect(P.bookPackageSession(state.purchaseId, { holdId: await hold(state, '12:00'), intake: { ...intake, peopleRecording: 7 } })).rejects.toThrow('up to 6');
    await db.update(S.customerPackages).set({ starts_at: new Date(Date.now() - 86400000), expires_at: new Date(Date.now() - 1000) }).where(eq(S.customerPackages.id, state.packageId));
    await expect(P.bookPackageSession(state.purchaseId, { holdId: await hold(state, '13:00'), intake })).rejects.toThrow('validity');
    expect((await P.packageDashboard(state.purchaseId)).remaining).toBe(2);
  });
  it('refund or review state blocks further credit use', async () => {
    const state = await paid(); const holdId = await hold(state);
    await db.update(S.purchases).set({ status: 'refunded', refunded_cents: state.session.amount_total }).where(eq(S.purchases.id, state.purchaseId));
    await expect(P.bookPackageSession(state.purchaseId, { holdId, intake })).rejects.toThrow('not available');
    const credits = await db.query.packageCreditTransactions.findMany({ where: and(eq(S.packageCreditTransactions.customer_package_id, state.packageId), eq(S.packageCreditTransactions.type, 'redeem')) });
    expect(credits).toHaveLength(0);
  });
});
