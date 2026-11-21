/**
 * Admin language end to end against a real Postgres (PGlite with every
 * migration): saving the choice, keeping it across sign-ins, the Marketing
 * Analyst default, the sign-in page cookie, localised CSV headers, and the
 * real Analytics dashboard rendered in all three languages (no raw keys,
 * filters kept in every link).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement, type ReactNode } from 'react';

const h = vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret';
  process.env.ADMIN_EMAILS = 'owner@zayro.test';
  process.env.ANALYTICS_VIEWER_EMAILS = 'analyst.ru@zayro.test';
  return { sessionToken: null as string | null, localeCookie: null as string | null, acceptLanguage: null as string | null };
});

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/pgliteDb');
  const { db, pg } = await createTestDb();
  return { db, pg };
});
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) =>
      name === 'zayro_admin_session' && h.sessionToken ? { value: h.sessionToken } : name === 'zayro_admin_locale' && h.localeCookie ? { value: h.localeCookie } : undefined,
  }),
  headers: () => new Map(h.acceptLanguage ? [['accept-language', h.acceptLanguage]] : []),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/admin/analytics',
  useSearchParams: () => new URLSearchParams(),
}));

const { pg } = (await import('@/lib/db')) as unknown as { pg: import('@electric-sql/pglite').PGlite };
const { seedCatalog } = await import('@/test/pgliteDb');
const { createSessionToken, createLoginToken } = await import('@/lib/adminAuth');
const { getAdminContext } = await import('@/lib/crm/auth');
const { consumeLoginToken } = await import('@/lib/crm/login');
const { adminLocaleFor, getAdminI18n } = await import('./server');
const localeRoute = await import('@/app/api/admin/locale/route');
const exportRoute = await import('@/app/api/admin/analytics/export/route');
const { default: AnalyticsPage } = await import('@/app/admin/(crm)/analytics/page');
const { I18nProvider } = await import('@/components/crm/i18n');

function post(locale: unknown, headers: Record<string, string> = {}) {
  return localeRoute.POST(
    new NextRequest('http://localhost/api/admin/locale', {
      method: 'POST',
      body: JSON.stringify({ locale }),
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
    })
  );
}

async function profileLocale(email: string) {
  return (await pg.query<{ locale: string | null }>(`SELECT locale FROM admin_profiles WHERE normalized_email = $1`, [email])).rows[0]?.locale ?? null;
}

beforeAll(async () => {
  await seedCatalog(pg);
  // Owner profile via ADMIN_EMAILS, analyst via ANALYTICS_VIEWER_EMAILS (both on first resolve).
  h.sessionToken = createSessionToken('owner@zayro.test');
  await getAdminContext();
  h.sessionToken = createSessionToken('analyst.ru@zayro.test');
  await getAdminContext();
  h.sessionToken = null;
});

beforeEach(() => {
  h.sessionToken = null;
  h.localeCookie = null;
  h.acceptLanguage = null;
});

describe('choosing the admin language', () => {
  it('Marketing Analyst sees Russian by default; Owner sees English', async () => {
    h.sessionToken = createSessionToken('analyst.ru@zayro.test');
    const analyst = await getAdminContext();
    expect(analyst?.roleName).toBe('Marketing Analyst');
    expect(analyst?.locale).toBeNull();
    expect(adminLocaleFor(analyst)).toBe('ru');
    expect(getAdminI18n(analyst).t('common.nav.analytics')).toBe('Аналитика');

    h.sessionToken = createSessionToken('owner@zayro.test');
    expect(adminLocaleFor(await getAdminContext())).toBe('en');
  });

  it('is saved in the profile and kept after signing out and in again (any device)', async () => {
    h.sessionToken = createSessionToken('analyst.ru@zayro.test');
    const res = await post('kk');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: 'kk', saved: 'profile' });
    expect(res.headers.get('set-cookie')).toMatch(/zayro_admin_locale=kk;.*Path=\/.*SameSite=lax/i);
    expect(await profileLocale('analyst.ru@zayro.test')).toBe('kk');

    // "Reload": a new request with the same session → still Kazakh.
    expect(adminLocaleFor(await getAdminContext())).toBe('kk');

    // Sign out (session gone, cookie cleared — e.g. another browser), sign in again with a fresh session.
    h.sessionToken = null;
    h.localeCookie = null;
    h.sessionToken = createSessionToken('analyst.ru@zayro.test');
    const again = await getAdminContext();
    expect(again?.locale).toBe('kk');
    expect(adminLocaleFor(again)).toBe('kk');
    expect(getAdminI18n(again).t('common.nav.analytics')).toBe('Аналитика');
    expect(getAdminI18n(again).t('common.shell.signOut')).toBe('Шығу');

    // Switch to English and back to Russian.
    await post('en');
    expect(adminLocaleFor(await getAdminContext())).toBe('en');
    await post('ru');
    expect(await profileLocale('analyst.ru@zayro.test')).toBe('ru');
  });

  it('rejects unknown languages and cross-site requests', async () => {
    h.sessionToken = createSessionToken('owner@zayro.test');
    expect((await post('de')).status).toBe(400);
    expect((await post('<script>')).status).toBe(400);
    expect((await post('ru', { origin: 'https://evil.example' })).status).toBe(403);
    expect(await profileLocale('owner@zayro.test')).toBeNull();
  });

  it('before sign-in: only a cookie is set; the sign-in page follows cookie → browser language → English', async () => {
    const res = await post('kk');
    expect(await res.json()).toEqual({ locale: 'kk', saved: 'cookie' });
    h.localeCookie = 'kk';
    expect(adminLocaleFor(null)).toBe('kk');
    h.localeCookie = null;
    h.acceptLanguage = 'ru-RU,ru;q=0.9,en;q=0.5';
    expect(adminLocaleFor(null)).toBe('ru');
    h.acceptLanguage = 'de-DE';
    expect(adminLocaleFor(null)).toBe('en');
  });

  it('a language picked on the sign-in page becomes the profile’s at sign-in (unless one is saved)', async () => {
    await pg.query(`INSERT INTO admin_profiles (email, normalized_email, role_id, status, created_by) SELECT 'new.analyst@zayro.test', 'new.analyst@zayro.test', id, 'active', 'test' FROM roles WHERE name = 'Marketing Analyst'`);
    const result = await consumeLoginToken(createLoginToken('new.analyst@zayro.test'), 'en');
    expect(result.ok).toBe(true);
    expect(await profileLocale('new.analyst@zayro.test')).toBe('en');
    // A saved choice is never overwritten by the sign-in page cookie.
    await consumeLoginToken(createLoginToken('new.analyst@zayro.test'), 'kk');
    expect(await profileLocale('new.analyst@zayro.test')).toBe('en');
    // Garbage is ignored.
    await pg.query(`UPDATE admin_profiles SET locale = NULL WHERE normalized_email = 'new.analyst@zayro.test'`);
    await consumeLoginToken(createLoginToken('new.analyst@zayro.test'), 'xx');
    expect(await profileLocale('new.analyst@zayro.test')).toBeNull();
  });

  it('the database refuses an unsupported value', async () => {
    await expect(pg.query(`UPDATE admin_profiles SET locale = 'fr' WHERE normalized_email = 'owner@zayro.test'`)).rejects.toThrow();
  });
});

describe('localised output', () => {
  it('analytics CSV headers follow the language; values stay machine-readable', async () => {
    await pg.query(`UPDATE admin_profiles SET locale = NULL WHERE normalized_email = 'analyst.ru@zayro.test'`);
    h.sessionToken = createSessionToken('analyst.ru@zayro.test');
    const ru = await (await exportRoute.GET(new NextRequest('http://localhost/api/admin/analytics/export?from=2026-01-01&to=2026-01-31'))).text();
    expect(ru.split('\n')[0]).toContain('Дата (ET)');
    expect(ru.split('\n')[0]).toContain('Валовая выручка (USD)');
    await post('kk');
    const kk = await (await exportRoute.GET(new NextRequest('http://localhost/api/admin/analytics/export?from=2026-01-01&to=2026-01-31'))).text();
    expect(kk.split('\n')[0]).toContain('Күні (ET)');
    await post('en');
    const en = await (await exportRoute.GET(new NextRequest('http://localhost/api/admin/analytics/export?from=2026-01-01&to=2026-01-31'))).text();
    expect(en.split('\n')[0]).toContain('Gross revenue (USD)');
  });

  it.each([
    ['ru', ['Маркетинговая аналитика', 'Уникальные посетители', 'Рекламная платформа', 'Интеграция расходов на рекламу не настроена', 'Последние 30 дней']],
    ['kk', ['Маркетингтік аналитика', 'Бірегей келушілер', 'Жарнама платформасы', 'Жарнама шығындарының интеграциясы бапталмаған', 'Соңғы 30 күн']],
    ['en', ['Marketing analytics', 'Unique visitors', 'Ad platform', 'Ad cost integration not configured', 'Last 30 days']],
  ] as const)('the Analytics dashboard renders fully in %s, with no raw keys, and keeps filters when changing the period', async (locale, expected) => {
    await pg.query(`UPDATE admin_profiles SET locale = $1 WHERE normalized_email = 'analyst.ru@zayro.test'`, [locale]);
    h.sessionToken = createSessionToken('analyst.ru@zayro.test');
    const searchParams = { range: '30d', platform: 'reddit', campaign: 'nyc_test', model: 'first' };
    const page = await AnalyticsPage({ searchParams });
    const html = renderToStaticMarkup(createElement(I18nProvider as (p: { locale: typeof locale; children?: ReactNode }) => ReactElement, { locale }, page));
    for (const text of expected) expect(html).toContain(text);
    // No untranslated key such as "analytics.kpi.visitors" anywhere in the markup.
    expect(html.match(/\b(?:common|analytics|values|sessions|customers|purchases|packages|services|availability|team|system|integrations|calendar|dashboard|login)\.[a-z][A-Za-z0-9_]*\.[A-Za-z0-9_.]+/g) ?? []).toEqual([]);
    // Every period preset link keeps the selected platform, campaign and attribution model.
    const links = [...html.matchAll(/href="\?range=([a-z0-9]+)&amp;([^"]+)"/g)].map((m) => m[2]);
    const presetLinks = links.filter((rest) => rest.includes('platform='));
    expect(presetLinks.length).toBe(6);
    for (const rest of presetLinks) {
      expect(rest).toContain('model=first');
      expect(rest).toContain('platform=reddit');
      expect(rest).toContain('campaign=nyc_test');
    }
    // …and the one "Clear filters" link keeps the period and model but drops the filters.
    expect(links.filter((rest) => !rest.includes('platform='))).toEqual(['model=first']);
    // The filter form keeps the chosen values selected.
    expect(html).toMatch(/<option value="reddit" selected="">/);
    // Money is always USD.
    expect(html).toContain('$');
  });
});
