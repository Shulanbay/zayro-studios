/**
 * Browser tracker with a minimal fake DOM: consent gating of tags and
 * pixels, Consent Mode updates, page-view counting, conversion mirroring
 * with the server's event ID, and excluded routes. No network: fetch is a
 * recording stub and vendor scripts are only "appended" to a fake head.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CONSENT_VERSION, serializeConsent } from './consent';
import type { PublicAnalyticsConfig } from './server/config';

const base: PublicAnalyticsConfig = {
  vendorsEnabled: true,
  gtmId: 'GTM-TEST',
  ga4Id: 'G-TEST',
  ga4ServerSide: false,
  googleAds: { id: 'AW-1', labels: { booking: 'book' } },
  metaPixelId: '111',
  redditPixelId: 't2_x',
  pinterestTagId: '222',
  tiktokPixelId: 'CTT',
};

let scripts: string[];
let posts: any[];

function installDom(path: string, consent: { analytics: boolean; advertising: boolean } | null, search = '') {
  scripts = [];
  posts = [];
  const cookie = consent ? `zayro_consent=${encodeURIComponent(serializeConsent({ version: CONSENT_VERSION, consentId: 'trackertestconsent000001', decidedAt: 1, ...consent }))}` : '';
  const store = new Map<string, string>();
  const g = globalThis as any;
  g.window = g;
  g.location = { pathname: path, href: `https://zayro.studio${path}${search}`, hostname: 'zayro.studio', origin: 'https://zayro.studio', protocol: 'https:' };
  g.history = { state: null, replaceState: vi.fn() };
  g.document = {
    cookie,
    referrer: '',
    title: 'ZAYRO',
    visibilityState: 'visible',
    head: { appendChild: (s: any) => scripts.push(s.src) },
    getElementById: () => null,
    createElement: () => ({}),
    addEventListener: () => undefined,
  };
  g.addEventListener = () => undefined;
  g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
  Object.defineProperty(g, 'navigator', { value: { webdriver: false }, configurable: true });
  g.fetch = vi.fn(async (_url: string, init: any) => {
    posts.push(JSON.parse(init.body));
    return { ok: true };
  });
  delete g.dataLayer;
  delete g.gtag;
  delete g.fbq;
  delete g.rdt;
  delete g.pintrk;
  delete g.ttq;
}

async function fresh() {
  vi.resetModules();
  return import('./browser/tracker');
}

const conversion = (over: Record<string, unknown> = {}) => ({
  name: 'purchase_confirmed' as const,
  eventId: '6f1c2a3b-1111-5222-8333-444455556666',
  transactionId: '6f1c2a3b-1111-5222-8333-444455556666',
  valueCents: 21775,
  taxCents: 1775,
  currency: 'USD' as const,
  items: [{ id: 'service_102', name: 'Podcast Pro', category: 'podcast', quantity: 1, priceCents: 20000 }],
  ga4ServerSide: false,
  ...over,
});

describe('browser tracker', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('loads no pixel and pushes nothing to vendors before consent; Consent Mode stays denied', async () => {
    installDom('/', null);
    const t = await fresh();
    t.initAnalytics(base);
    t.trackEvent('page_view');
    t.trackConversion(conversion());
    expect(scripts).toEqual([]);
    expect((globalThis as any).fbq).toBeUndefined();
    expect(((globalThis as any).dataLayer ?? []).filter((e: any) => e.event)).toEqual([]);
  });

  it('analytics-only consent: GA4 events via dataLayer, no advertising pixel', async () => {
    installDom('/pricing', { analytics: true, advertising: false });
    const t = await fresh();
    t.initAnalytics(base);
    t.trackEvent('page_view');
    t.trackEvent('pricing_viewed');
    const dl = (globalThis as any).dataLayer.filter((e: any) => e.event);
    expect(dl.map((e: any) => e.event)).toEqual(['page_view', 'view_item_list']);
    expect(scripts.some((s) => /fbevents|redditstatic|pinimg|tiktok/.test(s))).toBe(false);
  });

  it('advertising consent loads each configured pixel once and mirrors conversions with the server event ID, once per tab', async () => {
    installDom('/booking/success', { analytics: true, advertising: true });
    const t = await fresh();
    t.initAnalytics(base);
    t.setConsent(t.readStoredConsent());
    expect(scripts.filter((s) => s.includes('fbevents'))).toHaveLength(1);
    expect(scripts.some((s) => s.includes('redditstatic'))).toBe(true);
    expect(scripts.some((s) => s.includes('pinimg'))).toBe(true);
    expect(scripts.some((s) => s.includes('analytics.tiktok.com'))).toBe(true);
    const g = globalThis as any;
    const fbq = vi.fn();
    const rdt = vi.fn();
    const pintrk = vi.fn();
    const ttq = { track: vi.fn(), page: vi.fn() };
    g.fbq = fbq;
    g.rdt = rdt;
    g.pintrk = pintrk;
    g.ttq = ttq;
    t.trackConversion(conversion());
    t.trackConversion(conversion()); // refresh / second poll: ignored
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq).toHaveBeenCalledWith('track', 'Purchase', expect.objectContaining({ value: 217.75, currency: 'USD' }), { eventID: conversion().eventId });
    expect(rdt).toHaveBeenCalledWith('track', 'Purchase', expect.objectContaining({ conversionId: conversion().eventId, value: 217.75, currency: 'USD' }));
    expect(pintrk).toHaveBeenCalledWith('track', 'checkout', expect.objectContaining({ event_id: conversion().eventId, value: 217.75 }));
    expect(ttq.track).toHaveBeenCalledWith('CompletePayment', expect.objectContaining({ value: 217.75 }), { event_id: conversion().eventId });
    const purchase = g.dataLayer.find((e: any) => e.event === 'purchase');
    expect(purchase).toMatchObject({ transaction_id: conversion().eventId, value: 217.75, tax: 17.75, currency: 'USD', affiliation: 'ZAYRO Studios' });
    // With GTM, Google Ads conversions belong to GTM: the site doesn't fire them itself.
    expect(g.dataLayer.some((e: any) => e[0] === 'event' && e[1] === 'conversion')).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    const dispatch = posts.find((p) => p.dispatch)?.dispatch;
    expect(dispatch).toEqual({ eventId: conversion().eventId, destinations: ['meta_pixel', 'reddit_pixel', 'pinterest_tag', 'tiktok_pixel'] });
    expect(JSON.stringify(posts)).not.toMatch(/@|Lovelace|session_id|cs_/);
  });

  it('with GA4 server-side the browser never sends a second GA4 purchase', async () => {
    installDom('/booking/success', { analytics: true, advertising: false });
    const t = await fresh();
    t.initAnalytics({ ...base, ga4ServerSide: true });
    t.trackConversion(conversion({ ga4ServerSide: true }));
    const names = (globalThis as any).dataLayer.filter((e: any) => e.event).map((e: any) => e.event);
    expect(names).toEqual(['zayro_conversion']);
  });

  it('vendors disabled (preview / local / missing config): nothing loads even with consent', async () => {
    installDom('/', { analytics: true, advertising: true });
    const t = await fresh();
    t.initAnalytics({ ...base, vendorsEnabled: false, gtmId: null, ga4Id: null });
    t.setConsent(t.readStoredConsent());
    t.trackEvent('page_view');
    t.trackConversion(conversion());
    expect(scripts).toEqual([]);
    expect(((globalThis as any).dataLayer ?? []).filter((e: any) => e.event)).toEqual([]);
  });

  it('never tracks Manage Booking or admin pages', async () => {
    for (const path of ['/booking/manage', '/admin/analytics']) {
      installDom(path, { analytics: true, advertising: true });
      const t = await fresh();
      t.initAnalytics(base);
      t.setConsent(t.readStoredConsent());
      t.trackEvent('page_view');
      t.flush(true);
      expect(scripts).toEqual([]);
      expect(posts).toEqual([]);
    }
  });

  it('holds first-party events until the visitor chooses; click IDs leave only with advertising consent', async () => {
    installDom('/', null, '?utm_source=reddit&utm_medium=paid_social&rdt_cid=click-1');
    const t = await fresh();
    t.initAnalytics({ ...base, vendorsEnabled: false });
    t.trackEvent('page_view');
    t.flush(false);
    expect(posts).toEqual([]);
    (globalThis as any).document.cookie = `zayro_consent=${encodeURIComponent(serializeConsent({ version: CONSENT_VERSION, consentId: 'trackertestconsent000002', decidedAt: 1, analytics: true, advertising: false }))}`;
    t.setConsent(t.readStoredConsent());
    expect(posts).toHaveLength(1);
    expect(posts[0].touch).toMatchObject({ utm: { utm_source: 'reddit', utm_medium: 'paid_social' }, clickIds: {} });
    expect(posts[0].events[0].name).toBe('page_view');
  });
});
