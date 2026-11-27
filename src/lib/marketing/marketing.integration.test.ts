/**
 * Marketing hub against a real Postgres (PGlite with every migration): the
 * public lead form (consent, GPC, honeypot, attribution), contact form →
 * CRM lead, role permissions for leads / pages / tracking code / spend,
 * audit entries without code or PII, the tracking-code endpoint's gates,
 * ad spend upserts feeding the platform comparison, and lead exports.
 * Nothing is sent to any vendor.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

const h = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.NEXTAUTH_SECRET = 'test-secret';
  process.env.ADMIN_EMAILS = 'owner@zayro.test';
  process.env.ANALYTICS_ENCRYPTION_SECRET = 'integration-test-analytics-secret-0123456789abcdef';
  return { sessionToken: null as string | null, resendSend: vi.fn(async () => ({ error: null })) };
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
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));
vi.mock('resend', () => ({ Resend: class { emails = { send: (...args: unknown[]) => (h.resendSend as (...a: unknown[]) => unknown)(...args) }; } }));

delete process.env.RESEND_API_KEY;
delete process.env.MARKETING_CODE_ALLOW_NON_PRODUCTION;
delete process.env.ANALYTICS_ALLOW_NON_PRODUCTION;

const { db, pg } = (await import('@/lib/db')) as unknown as { db: any; pg: import('@electric-sql/pglite').PGlite };
const schema = await import('@/lib/db/schema');
const { seedCatalog } = await import('@/test/pgliteDb');
const { createSessionToken } = await import('@/lib/adminAuth');
const { serializeConsent, CONSENT_VERSION } = await import('@/lib/analytics/consent');
const { clickIdValues } = await import('./leads');
const { platformComparison } = await import('@/lib/analytics/server/kpis');
const leadRoute = await import('@/app/api/leads/route');
const contactRoute = await import('@/app/api/contact/route');
const tagsRoute = await import('@/app/api/marketing/tags/route');
const adminLeads = await import('@/app/api/admin/leads/route');
const adminLead = await import('@/app/api/admin/leads/[id]/route');
const leadExport = await import('@/app/api/admin/leads/export/route');
const adminPages = await import('@/app/api/admin/pages/route');
const adminPage = await import('@/app/api/admin/pages/[id]/route');
const settingsRoute = await import('@/app/api/admin/marketing/settings/route');
const spendRoute = await import('@/app/api/admin/ad-spend/route');
const utmRoute = await import('@/app/api/admin/utm-links/route');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
let ip = 0;
let seq = 0;

function consentCookie(analytics: boolean, advertising: boolean) {
  const id = `mkconsent${String(++seq).padStart(4, '0')}abcdefghijk`;
  return `zayro_consent=${encodeURIComponent(serializeConsent({ version: CONSENT_VERSION, consentId: id, analytics, advertising, decidedAt: Math.floor(Date.now() / 1000) }))}`;
}

function publicPost(url: string, body: unknown, opts: { consent?: [boolean, boolean]; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'user-agent': UA,
      'x-forwarded-for': `10.77.${Math.floor(++ip / 250)}.${ip % 250}`,
      ...(opts.consent ? { cookie: consentCookie(...opts.consent) } : {}),
      ...(opts.headers ?? {}),
    },
  });
}

const admin = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, headers: { host: 'localhost', 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

async function count(table: string, where = 'true'): Promise<number> {
  return (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`)).rows[0].n;
}

async function addStaff(email: string, role: string) {
  const r = await db.query.roles.findFirst({ where: eq(schema.roles.name, role) });
  expect(r, role).toBeTruthy();
  await db.insert(schema.adminProfiles).values({ email, normalized_email: email, role_id: r.id }).onConflictDoNothing();
}
const as = (email: string | null) => {
  h.sessionToken = email ? createSessionToken(email) : null;
};

const touch = (extra: Record<string, unknown> = {}) => ({
  pagePath: '/spring-promo',
  referrer: 'https://l.facebook.com/',
  utm: { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'Spring_Promo' },
  clickIds: { fbclid: 'IwAR0fbclickvalue1234567890', gclid: 'Cj0KCQgclickvalue12345' },
  ...extra,
});

beforeAll(async () => {
  await seedCatalog(pg);
  await addStaff('manager@zayro.test', 'Marketing Manager');
  await addStaff('analyst@zayro.test', 'Marketing Analyst');
  await addStaff('studio@zayro.test', 'Studio Manager');
});
afterEach(() => {
  as(null);
  delete process.env.MARKETING_CODE_ALLOW_NON_PRODUCTION;
});

describe('public lead form', () => {
  it('saves the lead with UTM; click IDs only with advertising consent, encrypted at rest', async () => {
    const res = await leadRoute.POST(publicPost('/api/leads', { name: 'Ada', phone: '+1 212 555 0100', email: 'ada@example.com', touch: touch() }, { consent: [true, true] }));
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body).not.toHaveProperty('leadId');
    const lead = await db.query.leads.findFirst({ where: eq(schema.leads.email, 'ada@example.com') });
    expect(lead).toMatchObject({ name: 'Ada', contact_method: 'form', status: 'new', utm_source: 'facebook', utm_campaign: 'spring_promo' });
    expect(lead.id).toBeGreaterThanOrEqual(1001);
    expect(lead.click_id_types?.split(',')).toEqual(expect.arrayContaining(['fbclid', 'gclid']));
    expect(lead.click_ids_encrypted).toBeTruthy();
    expect(lead.click_ids_encrypted).not.toContain('IwAR0fbclickvalue');
    expect(clickIdValues(lead)).toMatchObject({ fbclid: 'IwAR0fbclickvalue1234567890', gclid: 'Cj0KCQgclickvalue12345' });
    expect(await count('lead_activities', `lead_id = ${lead.id} AND type = 'created'`)).toBe(1);
  });

  it('no advertising consent, or a Global Privacy Control signal: no click IDs are kept', async () => {
    await leadRoute.POST(publicPost('/api/leads', { name: 'Bo', phone: '+1 212 555 0101', email: 'bo@example.com', touch: touch() }, { consent: [true, false] }));
    await leadRoute.POST(publicPost('/api/leads', { name: 'Cy', phone: '+1 212 555 0102', email: 'cy@example.com', touch: touch() }, { consent: [true, true], headers: { 'sec-gpc': '1' } }));
    for (const email of ['bo@example.com', 'cy@example.com']) {
      const lead = await db.query.leads.findFirst({ where: eq(schema.leads.email, email) });
      expect(lead, email).toMatchObject({ click_ids_encrypted: null, utm_campaign: 'spring_promo' });
      expect(lead.click_id_types ?? '').toBe('');
    }
  });

  it('rejects bots (honeypot) and bad input without saving anything', async () => {
    const before = await count('leads');
    expect((await leadRoute.POST(publicPost('/api/leads', { name: 'Bot', phone: '+1 212 555 0199', website: 'http://spam.test' }))).status).toBe(400);
    expect((await leadRoute.POST(publicPost('/api/leads', { name: 'Ann', phone: 'call me' }))).status).toBe(400);
    expect((await leadRoute.POST(publicPost('/api/leads', { name: '', phone: '+1 212 555 0100' }))).status).toBe(400);
    expect((await leadRoute.POST(publicPost('/api/leads', { name: 'Ann', phone: '+1 212 555 0100', email: 'not-an-email' }))).status).toBe(400);
    expect(await count('leads')).toBe(before);
  });

  it('only a published page counts as the landing page source', async () => {
    await leadRoute.POST(publicPost('/api/leads', { name: 'Di', phone: '+1 212 555 0103', email: 'di@example.com', touch: touch({ landingSlug: 'no-such-page' }) }));
    expect((await db.query.leads.findFirst({ where: eq(schema.leads.email, 'di@example.com') })).landing_page_slug).toBeNull();
  });

  it('the contact form also creates a CRM lead', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM = 'studio@zayro.test';
    process.env.OWNER_EMAIL = 'owner@zayro.test';
    try {
      const res = await contactRoute.POST(publicPost('/api/contact', { name: 'Eve', email: 'eve@example.com', message: 'Do you have parking?' }));
      expect(res.status).toBe(200);
      expect(await db.query.leads.findFirst({ where: eq(schema.leads.email, 'eve@example.com') })).toMatchObject({ contact_method: 'form', message: 'Do you have parking?' });
    } finally {
      delete process.env.RESEND_API_KEY;
    }
  });
});

describe('permissions', () => {
  it('Marketing Analyst (aggregates only) cannot read or change leads, pages, code or spend', async () => {
    as('analyst@zayro.test');
    const anyId = '00000000-0000-4000-8000-000000000000';
    const calls: [string, () => Promise<Response>][] = [
      ['add lead', () => adminLeads.POST(admin('POST', '/api/admin/leads', { name: 'x', contact_method: 'whatsapp' }))],
      ['edit lead', () => adminLead.PATCH(admin('PATCH', '/api/admin/leads/1001', { status: 'paid' }), { params: { id: '1001' } })],
      ['export leads', () => leadExport.GET(admin('GET', '/api/admin/leads/export'))],
      ['new page', () => adminPages.POST(admin('POST', '/api/admin/pages', { title: 'x' }))],
      ['edit page', () => adminPage.PATCH(admin('PATCH', `/api/admin/pages/${anyId}`, { title: 'x' }), { params: { id: anyId } })],
      ['tracking settings', () => settingsRoute.PATCH(admin('PATCH', '/api/admin/marketing/settings', { scripts_enabled: true }))],
      ['ad spend', () => spendRoute.POST(admin('POST', '/api/admin/ad-spend', { rows: [{ date: '2026-11-01', platform: 'meta', amount: 1 }] }))],
    ];
    for (const [label, call] of calls) expect((await call()).status, label).toBe(403);
    // The UTM builder is an aggregate tool analysts may use.
    expect((await utmRoute.POST(admin('POST', '/api/admin/utm-links', { name: 'Meta spring', url: 'https://zayro.studio/?utm_source=facebook&utm_campaign={{campaign.name}}', platform: 'meta' }))).status).toBe(200);
  });

  it('Studio Manager works leads but cannot edit pages or tracking code', async () => {
    as('studio@zayro.test');
    const res = await adminLeads.POST(admin('POST', '/api/admin/leads', { name: 'Walk-in', phone: '+1 212 555 0110', contact_method: 'whatsapp', utm_source: 'instagram' }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const patch = await adminLead.PATCH(admin('PATCH', `/api/admin/leads/${id}`, { status: 'paid', revenue: 350 }), { params: { id: String(id) } });
    expect(patch.status).toBe(200);
    expect(await db.query.leads.findFirst({ where: eq(schema.leads.id, id) })).toMatchObject({ status: 'paid', revenue_cents: 35000, contact_method: 'whatsapp' });
    expect(await count('lead_activities', `lead_id = ${id} AND type IN ('status', 'revenue')`)).toBe(2);
    expect((await adminPages.POST(admin('POST', '/api/admin/pages', { title: 'Nope' }))).status).toBe(403);
    expect((await settingsRoute.PATCH(admin('PATCH', '/api/admin/marketing/settings', { scripts_enabled: true }))).status).toBe(403);
    // Lead audit entries never carry contact details.
    const audit = (await pg.query<{ t: string }>(`SELECT coalesce(before_data::text, '') || coalesce(after_data::text, '') || coalesce(metadata::text, '') AS t FROM audit_logs WHERE entity_type = 'lead'`)).rows.map((r) => r.t).join(' ');
    expect(audit).not.toMatch(/555 0110|Walk-in/);
  });
});

describe('landing pages and tracking code', () => {
  let pageId = '';

  it('Marketing Manager builds, validates and publishes a page; code changes are audited as fingerprints only', async () => {
    as('manager@zayro.test');
    expect((await adminPages.POST(admin('POST', '/api/admin/pages', { title: 'Booking', slug: 'booking' }))).status).toBe(400);
    const created = await adminPages.POST(admin('POST', '/api/admin/pages', { title: 'Spring promo', slug: 'spring-promo', template: 'promo-ads' }));
    expect(created.status).toBe(200);
    pageId = (await created.json()).id;
    expect((await adminPages.POST(admin('POST', '/api/admin/pages', { title: 'Again', slug: 'spring-promo' }))).status).toBe(409);

    const page = await db.query.landingPages.findFirst({ where: eq(schema.landingPages.id, pageId) });
    const blocks = page.content_blocks as any[];
    const bad = structuredClone(blocks);
    bad[0].primary = { label: 'Click', href: 'javascript:alert(1)' };
    const rejected = await adminPage.PATCH(admin('PATCH', `/api/admin/pages/${pageId}`, { content_blocks: bad }), { params: { id: pageId } });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).path?.[0]).toBe('content_blocks');

    expect((await adminPage.PATCH(admin('PATCH', `/api/admin/pages/${pageId}`, { head_scripts: '<script>unclosed' }), { params: { id: pageId } })).status).toBe(400);
    const code = `<script>fbq('init', '123456789012345');</script>`;
    const ok = await adminPage.PATCH(admin('PATCH', `/api/admin/pages/${pageId}`, { head_scripts: code, scripts_consent: 'advertising', is_published: true }), { params: { id: pageId } });
    expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(200);
    expect(await db.query.landingPages.findFirst({ where: eq(schema.landingPages.id, pageId) })).toMatchObject({ is_published: true, head_scripts: code });
    const audit = (await pg.query<{ t: string }>(`SELECT after_data::text AS t FROM audit_logs WHERE entity_type = 'landing_page' AND operation = 'page.publish'`)).rows[0]?.t ?? '';
    expect(audit).toMatch(/chars · [0-9a-f]{12}/);
    expect(audit).not.toContain('fbq');

    // Published pages can't be deleted.
    expect((await adminPage.DELETE(admin('DELETE', `/api/admin/pages/${pageId}`), { params: { id: pageId } })).status).toBeGreaterThanOrEqual(400);
  });

  it('a role with pages.manage but without marketing.scripts edits content, never code', async () => {
    const [role] = await db.insert(schema.roles).values({ name: 'Page Editor', description: 'test', is_system: false, permissions: ['pages.manage'] }).returning();
    await db.insert(schema.adminProfiles).values({ email: 'editor@zayro.test', normalized_email: 'editor@zayro.test', role_id: role.id });
    as('editor@zayro.test');
    expect((await adminPage.PATCH(admin('PATCH', `/api/admin/pages/${pageId}`, { title: 'Spring promo 2' }), { params: { id: pageId } })).status).toBe(200);
    expect((await adminPage.PATCH(admin('PATCH', `/api/admin/pages/${pageId}`, { body_scripts: '<script>1</script>' }), { params: { id: pageId } })).status).toBe(403);
  });

  it('the public tags endpoint is off until the master switch is on, in an allowed environment, and never on booking pages', async () => {
    const tags = async (path: string) => (await tagsRoute.GET(new NextRequest(`http://localhost/api/marketing/tags?path=${encodeURIComponent(path)}`))).json();
    expect(await tags('/spring-promo')).toEqual({ enabled: false });

    as('manager@zayro.test');
    const saved = await settingsRoute.PATCH(admin('PATCH', '/api/admin/marketing/settings', { scripts_enabled: true, global_head_scripts: `<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST1234"></script>`, global_scripts_consent: 'analytics' }));
    expect(saved.status).toBe(200);
    expect(await tags('/spring-promo')).toEqual({ enabled: false }); // not production

    process.env.MARKETING_CODE_ALLOW_NON_PRODUCTION = '1';
    const onPage = await tags('/spring-promo');
    expect(onPage).toMatchObject({ enabled: true, global: { consent: 'analytics' }, page: { consent: 'advertising' } });
    expect(onPage.page.head).toContain('fbq');
    const elsewhere = await tags('/pricing');
    expect(elsewhere.enabled).toBe(true);
    expect(elsewhere.page).toBeNull(); // page code stays on its own page
    for (const p of ['/booking', '/booking/success', '/packages/buy', '/admin']) expect(await tags(p), p).toEqual({ enabled: false });

    // Turning the switch off stops everything at once.
    await settingsRoute.PATCH(admin('PATCH', '/api/admin/marketing/settings', { scripts_enabled: false }));
    expect(await tags('/spring-promo')).toEqual({ enabled: false });
    const audit = (await pg.query<{ t: string }>(`SELECT coalesce(before_data::text, '') || coalesce(after_data::text, '') AS t FROM audit_logs WHERE entity_type = 'marketing_settings'`)).rows.map((r) => r.t).join(' ');
    expect(audit).not.toContain('googletagmanager');
  });

  it('validates messenger settings', async () => {
    as('manager@zayro.test');
    expect((await settingsRoute.PATCH(admin('PATCH', '/api/admin/marketing/settings', { whatsapp_number: 'abc' }))).status).toBe(400);
    expect((await settingsRoute.PATCH(admin('PATCH', '/api/admin/marketing/settings', { whatsapp_number: '+1 212 555 0100', telegram_username: '@zayro_studios' }))).status).toBe(200);
    expect(await db.query.marketingSettings.findFirst()).toMatchObject({ whatsapp_number: '+1 212 555 0100', telegram_username: 'zayro_studios' });
  });
});

describe('ad spend and exports', () => {
  it('spend rows upsert (last duplicate wins) and feed the platform comparison; nothing without entries', async () => {
    // Reports group by studio (New York) days.
    const { todayInTz } = await import('@/lib/crm/time');
    const today = todayInTz();
    const range = { from: today, to: today };
    const before = await platformComparison(range, 'last_non_direct');
    expect(before.every((r) => r.spend === null)).toBe(true);

    as('manager@zayro.test');
    expect((await spendRoute.POST(admin('POST', '/api/admin/ad-spend', { rows: [{ date: '2026-02-30', platform: 'meta', amount: 1 }] }))).status).toBe(400);
    const res = await spendRoute.POST(
      admin('POST', '/api/admin/ad-spend', {
        rows: [
          { date: today, platform: 'meta', campaign: 'Spring_Promo', amount: 40, clicks: 100 },
          { date: today, platform: 'meta', campaign: 'spring_promo', amount: 50, clicks: 120, impressions: 9000 },
        ],
      })
    );
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await count('ad_spend')).toBe(1);
    const rows = await platformComparison(range, 'last_non_direct');
    const meta = rows.find((r) => r.campaign === 'spring_promo' && r.spend !== null);
    expect(meta).toMatchObject({ spend: 5000, adClicks: 120, impressions: 9000 });
    expect(meta!.leads).toBeGreaterThanOrEqual(1);
  });

  it('lead CSV needs leads.read; the Google offline-conversion file has click IDs and values but no contact details', async () => {
    const ada = await db.query.leads.findFirst({ where: eq(schema.leads.email, 'ada@example.com') });
    as('manager@zayro.test');
    await adminLead.PATCH(admin('PATCH', `/api/admin/leads/${ada.id}`, { status: 'paid', revenue: 500 }), { params: { id: String(ada.id) } });
    const csv = await (await leadExport.GET(admin('GET', '/api/admin/leads/export'))).text();
    expect(csv).toContain('ada@example.com');
    const offline = await (await leadExport.GET(admin('GET', '/api/admin/leads/export?format=google_offline'))).text();
    expect(offline).toMatch(/^Parameters:TimeZone=America\/New_York/);
    expect(offline).toContain('Cj0KCQgclickvalue12345');
    expect(offline).toContain('500.00');
    expect(offline).not.toMatch(/@|Ada|555/);
    expect(await count('audit_logs', `operation IN ('lead.export', 'lead.export_offline_conversions')`)).toBe(2);
  });
});
