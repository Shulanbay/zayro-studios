/**
 * Pure analytics logic: consent, validation, attribution, event identity,
 * destination payloads (fake configuration, no network), permissions and
 * the client-bundle secret boundary.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  allows,
  applyGpc,
  gpcFromHeaders,
  choiceFor,
  consentModeSignals,
  CONSENT_VERSION,
  currentConsent,
  DEFAULT_CONSENT_MODE,
  parseConsent,
  readConsentFromCookieHeader,
  serializeConsent,
  type ConsentState,
} from './consent';
import {
  attributeTouches,
  captureFromUrl,
  classifyTouch,
  cleanClickId,
  CLICK_ID_MAX_LENGTH,
  deviceCategory,
  isBotUserAgent,
  isTrackablePath,
  referrerHost,
  sanitizePageUrl,
  sanitizePath,
  stripClickIds,
  type TouchRecord,
} from './attribution';
import { cleanDispatchDestinations, cleanTouch, collectBodySchema, validateEvent } from './validation';
import { BROWSER_EVENTS, DESTINATION_CONSENT, DESTINATIONS, PLATFORM_EVENTS, SERVER_EVENTS } from './catalog';
import { deterministicEventId, decryptJson, encryptJson } from './server/crypto';
import { SERVER_ADAPTERS, sanitizeError, type DeliveryContext, oauth1Header } from './server/destinations';
import { destinationStatus, publicAnalyticsConfig, serverDestinationActive } from './server/config';
import { nextRetryDelayMinutes } from './server/deliveries';
import { hasPermission, SYSTEM_ROLE_PERMISSIONS, ALL_PERMISSIONS } from '@/lib/crm/permissions';
import { NAV_ITEMS } from '@/lib/crm/nav';
import { __setAnalyticsTestRuntime } from './server/runtime';

const consent = (analytics: boolean, advertising: boolean): ConsentState => ({ version: CONSENT_VERSION, consentId: 'abcdefghijklmnopqrstuv', analytics, advertising, decidedAt: 1_800_000_000 });

describe('consent', () => {
  it('defaults to everything denied before a choice', () => {
    expect(DEFAULT_CONSENT_MODE).toEqual({ analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    expect(consentModeSignals(null)).toEqual(DEFAULT_CONSENT_MODE);
    expect(allows(null, 'analytics')).toBe(false);
    expect(allows(null, 'advertising')).toBe(false);
  });

  it('accept analytics only', () => {
    const c = consent(true, false);
    expect(consentModeSignals(c)).toEqual({ analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    expect(allows(c, 'advertising')).toBe(false);
  });

  it('accept advertising (accept all)', () => {
    expect(choiceFor('accept_all')).toEqual({ analytics: true, advertising: true });
    expect(consentModeSignals(consent(true, true))).toEqual({ analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
  });

  it('reject non-essential and withdraw deny everything', () => {
    expect(choiceFor('reject_all')).toEqual({ analytics: false, advertising: false });
    expect(choiceFor('withdraw')).toEqual({ analytics: false, advertising: false });
    expect(choiceFor('custom', { analytics: false, advertising: true })).toEqual({ analytics: false, advertising: true });
  });

  it('round-trips the cookie and ignores tampered or outdated values (consent update)', () => {
    const c = consent(true, false);
    const raw = encodeURIComponent(serializeConsent(c));
    expect(parseConsent(raw)).toEqual(c);
    expect(readConsentFromCookieHeader(`a=1; zayro_consent=${raw}; b=2`)).toEqual(c);
    const updated = { ...c, advertising: true, decidedAt: c.decidedAt + 60 };
    expect(currentConsent(serializeConsent(updated))?.advertising).toBe(true);
    expect(currentConsent(serializeConsent({ ...c, version: '2000-01' }))).toBeNull();
    expect(parseConsent('v1~2026-11~short~a1~d1~1')).toBeNull();
    expect(parseConsent('v1~2026-11~abcdefghijklmnopqrstuv~a2~d1~1')).toBeNull();
    expect(parseConsent('<script>')).toBeNull();
  });

  it('Global Privacy Control keeps advertising denied but leaves analytics to the visitor', () => {
    const c: ConsentState = { version: CONSENT_VERSION, consentId: 'abcdefghijklmnopqrstuv', analytics: true, advertising: true, decidedAt: 1_800_000_000 };
    expect(applyGpc(c, true)).toEqual({ ...c, advertising: false });
    expect(applyGpc(c, false)).toBe(c);
    expect(applyGpc(null, true)).toBeNull();
    expect(consentModeSignals(applyGpc(c, true))).toMatchObject({ analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    expect(gpcFromHeaders(new Headers({ 'Sec-GPC': '1' }))).toBe(true);
    expect(gpcFromHeaders(new Headers({ 'Sec-GPC': '0' }))).toBe(false);
    expect(gpcFromHeaders(new Headers())).toBe(false);
  });
});

describe('event validation', () => {
  const now = Date.now();
  const ev = (name: string, extra: Record<string, unknown> = {}) => ({ name, eventId: '0b2c6a8e-6f0e-4b8a-9a52-2d0b0d7e5f11', occurredAt: now, path: '/booking', ...extra });

  it('accepts a known browser event with allowed properties', () => {
    const v = validateEvent(ev('service_selected', { properties: { service_id: 102, category: 'podcast', service_name: 'Podcast Pro' } }), now);
    expect(v.ok).toBe(true);
  });

  it('rejects unknown events and forged authoritative conversions', () => {
    expect(validateEvent(ev('made_up'), now)).toEqual({ ok: false, reason: 'unknown_event' });
    for (const name of ['purchase', 'purchase_confirmed', 'refund', 'refund_succeeded', 'booking_confirmed', 'booking_extended', 'extension_purchased', 'checkout_created', 'tour_confirmed', 'contact_submitted']) {
      expect(validateEvent(ev(name, { properties: { value: 99999 } }), now)).toEqual({ ok: false, reason: 'server_only_event' });
    }
  });

  it('rejects unknown properties (no forged revenue) and PII', () => {
    expect(validateEvent(ev('page_view', { properties: { value: 500, currency: 'USD' } }), now)).toEqual({ ok: false, reason: 'invalid_properties' });
    expect(validateEvent(ev('contact_started', { properties: { topic: 'jane@example.com' } }), now)).toEqual({ ok: false, reason: 'pii_detected' });
    expect(validateEvent(ev('contact_started', { properties: { topic: '+1 (212) 555-0100' } }), now)).toEqual({ ok: false, reason: 'pii_detected' });
  });

  it('enforces timestamp tolerance and trackable paths', () => {
    expect(validateEvent(ev('page_view', { occurredAt: now - 3 * 86400000 }), now)).toEqual({ ok: false, reason: 'timestamp_out_of_range' });
    expect(validateEvent(ev('page_view', { occurredAt: now + 3600000 }), now)).toEqual({ ok: false, reason: 'timestamp_out_of_range' });
    for (const path of ['/admin', '/admin/analytics', '/api/contact', '/booking/manage', '/booking/manage/x']) {
      expect(validateEvent(ev('page_view', { path }), now)).toEqual({ ok: false, reason: 'path_not_allowed' });
    }
  });

  it('bounds the payload shape', () => {
    expect(collectBodySchema.safeParse({ events: Array.from({ length: 21 }, () => ev('page_view')) }).success).toBe(false);
    expect(collectBodySchema.safeParse({ events: [], extra: 1 }).success).toBe(false);
    expect(collectBodySchema.safeParse({ events: [ev('page_view')] }).success).toBe(true);
    expect(cleanDispatchDestinations(['meta_pixel', 'meta_capi', 'ga4', 'evil', 'meta_pixel'])).toEqual(['meta_pixel']);
  });
});

describe('UTM, click IDs and URL sanitisation', () => {
  it('captures UTM parameters and every platform click ID', () => {
    const t = captureFromUrl(
      'https://zayro.studio/podcast-studio-nyc?utm_source=Reddit&utm_medium=paid_social&utm_campaign=nyc_podcast_studio_bookings_2026q4&utm_content=video_studio-tour_v1&utm_term=creators&rdt_cid=abc.123_x&epik=dj0yJnU9&ttclid=E.C.P.xyz&gclid=Cj0KCQ&fbclid=IwAR0',
      'https://www.reddit.com/r/podcasting/comments/secret?user=me',
      'zayro.studio'
    );
    expect(t.utm).toEqual({ utm_source: 'reddit', utm_medium: 'paid_social', utm_campaign: 'nyc_podcast_studio_bookings_2026q4', utm_content: 'video_studio-tour_v1', utm_term: 'creators' });
    expect(t.clickIds).toEqual({ rdt_cid: 'abc.123_x', epik: 'dj0yJnU9', ttclid: 'E.C.P.xyz', gclid: 'Cj0KCQ', fbclid: 'IwAR0' });
    expect(t.referrerHost).toBe('reddit.com');
    expect(t.landingPath).toBe('/podcast-studio-nyc');
  });

  it('sanitises click IDs: strict characters and maximum length', () => {
    expect(cleanClickId('rdt_cid', '<script>alert(1)</script>')).toBeNull();
    expect(cleanClickId('epik', 'a b')).toBeNull();
    expect(cleanClickId('ttclid', 'x'.repeat(CLICK_ID_MAX_LENGTH.ttclid))).toHaveLength(CLICK_ID_MAX_LENGTH.ttclid);
    expect(cleanClickId('ttclid', 'x'.repeat(CLICK_ID_MAX_LENGTH.ttclid + 1))).toBeNull();
    expect(cleanClickId('gclid', '')).toBeNull();
  });

  it('drops UTM values that carry PII', () => {
    const t = captureFromUrl('https://zayro.studio/?utm_source=newsletter&utm_term=jane%40example.com&utm_content=2125550100x', null, 'zayro.studio');
    expect(t.utm.utm_term).toBeUndefined();
  });

  it('strips sensitive query data from page URLs, paths and referrers', () => {
    expect(sanitizePageUrl('https://zayro.studio/booking/success?session_id=cs_live_abc&utm_source=google&email=a@b.co#t=token')).toBe('https://zayro.studio/booking/success?utm_source=google');
    expect(sanitizePageUrl('https://zayro.studio/booking/manage#t=secret')).toBeNull();
    expect(sanitizePageUrl('https://zayro.studio/pricing?gclid=abc&token=1&service=2')).toBe('https://zayro.studio/pricing?service=2');
    expect(sanitizePath('/booking?booking_id=ZAY-1#x')).toBe('/booking');
    expect(referrerHost('https://mail.google.com/mail/u/0/#inbox/secret')).toBe('mail.google.com');
    expect(referrerHost('https://zayro.studio/pricing', 'zayro.studio')).toBeNull();
    expect(stripClickIds('https://zayro.studio/?utm_source=tiktok&ttclid=abc&gclid=x')).toBe('/?utm_source=tiktok');
    expect(stripClickIds('https://zayro.studio/?utm_source=tiktok')).toBeNull();
  });

  it('never tracks admin, API or Manage Booking routes', () => {
    for (const p of ['/admin', '/admin/sessions', '/api/payment/webhook', '/api/analytics/collect', '/booking/manage']) expect(isTrackablePath(p)).toBe(false);
    for (const p of ['/', '/pricing', '/booking', '/booking/success', '/contact']) expect(isTrackablePath(p)).toBe(true);
  });

  it('recognises bots and device categories without storing the User-Agent', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBotUserAgent('vercel-screenshot/1.0')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0 Safari/537.36')).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(isBotUserAgent(iphone)).toBe(false);
    expect(deviceCategory(iphone)).toBe('mobile');
    expect(deviceCategory('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet');
    expect(deviceCategory('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('desktop');
  });
});

describe('channel classification', () => {
  const c = (utm: Record<string, string>, clickIdTypes: any[] = [], host: string | null = null) => classifyTouch({ utm, clickIdTypes, referrerHost: host });

  it('normalises paid social per platform and keeps it apart from organic social', () => {
    for (const [source, platform] of [['reddit', 'reddit'], ['pinterest', 'pinterest'], ['tiktok', 'tiktok'], ['facebook', 'meta'], ['fb', 'meta'], ['instagram', 'instagram'], ['ig', 'instagram']]) {
      const t = c({ utm_source: source, utm_medium: 'paid_social', utm_campaign: 'x' });
      expect(t).toMatchObject({ medium: 'paid_social', channel: 'paid_social', platform });
    }
    expect(c({}, [], 'reddit.com')).toMatchObject({ source: 'reddit', channel: 'organic_social', platform: 'organic' });
    expect(c({ utm_source: 'instagram', utm_medium: 'social' })).toMatchObject({ channel: 'organic_social', platform: 'organic' });
  });

  it('treats a platform click ID as paid even without UTM tags', () => {
    expect(c({}, ['gclid'])).toMatchObject({ source: 'google', medium: 'cpc', channel: 'paid_search', platform: 'google' });
    expect(c({}, ['rdt_cid'])).toMatchObject({ source: 'reddit', channel: 'paid_social', platform: 'reddit' });
    expect(c({}, ['epik'])).toMatchObject({ source: 'pinterest', channel: 'paid_social', platform: 'pinterest' });
    expect(c({}, ['ttclid'])).toMatchObject({ source: 'tiktok', channel: 'paid_social', platform: 'tiktok' });
    // fbclid is also added to organic shares: organic unless the medium says paid.
    expect(c({}, ['fbclid'])).toMatchObject({ source: 'facebook', channel: 'organic_social' });
  });

  it('classifies search, referral and direct', () => {
    expect(c({}, [], 'google.com')).toMatchObject({ channel: 'organic_search', platform: 'organic' });
    expect(c({}, [], 'nymag.com')).toMatchObject({ source: 'nymag.com', channel: 'referral', platform: 'referral' });
    expect(c({})).toMatchObject({ source: '(direct)', channel: 'direct', platform: 'direct' });
  });
});

describe('attribution models', () => {
  const t = (at: string, channel: string, source: string): TouchRecord => ({ at, source, medium: channel === 'direct' ? '(none)' : 'paid_social', campaign: null, content: null, term: null, channel, platform: source, landingPath: '/', clickIdTypes: [] });
  const now = new Date('2026-11-10T12:00:00Z');

  it('first touch, last non-direct and conversion touch', () => {
    const sessions = [t('2026-10-01T10:00:00Z', 'organic_search', 'google'), t('2026-11-01T10:00:00Z', 'paid_social', 'reddit'), t('2026-11-09T10:00:00Z', 'direct', 'direct')];
    const r = attributeTouches(sessions, sessions[2], now);
    expect(r.firstTouch.source).toBe('google');
    expect(r.lastNonDirect.source).toBe('reddit');
    expect(r.conversionTouch.channel).toBe('direct');
  });

  it('a direct visit never overwrites a recent paid-social touch', () => {
    const sessions = [t('2026-11-05T10:00:00Z', 'paid_social', 'tiktok'), t('2026-11-08T10:00:00Z', 'direct', 'direct'), t('2026-11-10T09:00:00Z', 'direct', 'direct')];
    expect(attributeTouches(sessions, sessions[2], now).lastNonDirect.source).toBe('tiktok');
  });

  it('touches outside the attribution window no longer count', () => {
    const sessions = [t('2026-06-01T10:00:00Z', 'paid_social', 'pinterest'), t('2026-11-10T09:00:00Z', 'direct', 'direct')];
    const r = attributeTouches(sessions, sessions[1], now, 90);
    expect(r.lastNonDirect.channel).toBe('direct');
    expect(r.firstTouch.source).toBe('pinterest');
    expect(attributeTouches(sessions, sessions[1], now, 365).lastNonDirect.source).toBe('pinterest');
  });
});

describe('event identity', () => {
  it('one stable ID per real-world action, different per kind', () => {
    const purchase = deterministicEventId('purchase_confirmed', 'p-1');
    expect(deterministicEventId('purchase_confirmed', 'p-1')).toBe(purchase);
    expect(purchase).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const ids = new Set(['checkout_created', 'purchase_confirmed', 'refund_succeeded', 'contact_submitted', 'free_booking_confirmed'].map((k) => deterministicEventId(k, 'p-1')));
    expect(ids.size).toBe(5);
    expect(collectBodySchema.shape.dispatch.unwrap().shape.eventId.safeParse(purchase).success).toBe(true);
  });

  it('retry delays back off and never change the ID', () => {
    expect([1, 2, 3, 4, 5, 6].map(nextRetryDelayMinutes)).toEqual([1, 5, 30, 120, 720, 720]);
  });
});

describe('click ID protection at rest', () => {
  const saved = process.env.ANALYTICS_ENCRYPTION_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANALYTICS_ENCRYPTION_SECRET;
    else process.env.ANALYTICS_ENCRYPTION_SECRET = saved;
  });

  it('encrypts with AES-GCM and stores nothing without a key', () => {
    process.env.ANALYTICS_ENCRYPTION_SECRET = 'unit-test-analytics-encryption-secret-0123456789';
    const enc = encryptJson({ ttclid: 'secret-click' })!;
    expect(enc).not.toContain('secret-click');
    expect(decryptJson(enc)).toEqual({ ttclid: 'secret-click' });
    expect(decryptJson(`${enc.slice(0, -2)}xx`)).toEqual({});
    delete process.env.ANALYTICS_ENCRYPTION_SECRET;
    expect(encryptJson({ ttclid: 'x' })).toBeNull();
  });
});

describe('destination adapters (fake configuration, no network)', () => {
  const env = {
    NEXT_PUBLIC_GA4_MEASUREMENT_ID: 'G-TEST123',
    GA4_API_SECRET: 'ga4-secret-value',
    NEXT_PUBLIC_META_PIXEL_ID: '1234567890',
    META_CONVERSIONS_API_TOKEN: 'meta-token-value',
    META_TEST_EVENT_CODE: 'TEST123',
    REDDIT_PIXEL_ID: 't2_pixel',
    REDDIT_CONVERSIONS_ACCESS_TOKEN: 'reddit-token-value',
    REDDIT_TEST_MODE: '1',
    PINTEREST_AD_ACCOUNT_ID: '549755885175',
    PINTEREST_CONVERSIONS_ACCESS_TOKEN: 'pin-token-value',
    PINTEREST_TEST_MODE: 'true',
    TIKTOK_PIXEL_CODE: 'CTEST123',
    TIKTOK_EVENTS_ACCESS_TOKEN: 'tiktok-token-value',
    TIKTOK_TEST_EVENT_CODE: 'TEST999',
    NEXT_PUBLIC_X_PIXEL_ID: 'o8z6j',
    X_EVENT_ID_PURCHASE: 'tw-o8z6j-o8z6k',
    X_ADS_CONSUMER_KEY: 'x-consumer-key',
    X_ADS_CONSUMER_SECRET: 'x-consumer-secret-value',
    X_ADS_ACCESS_TOKEN: 'x-access-token-value',
    X_ADS_ACCESS_TOKEN_SECRET: 'x-access-secret-value',
  };
  beforeEach(() => {
    Object.assign(process.env, env);
  });
  afterEach(() => {
    for (const k of Object.keys(env)) delete process.env[k];
    __setAnalyticsTestRuntime({ vendorsAllowed: null });
  });

  const ctx = (over: Partial<DeliveryContext> = {}): DeliveryContext => ({
    destination: 'meta_capi',
    eventId: deterministicEventId('purchase_confirmed', 'purchase-uuid'),
    name: 'purchase_confirmed',
    occurredAt: new Date('2026-11-10T15:00:00Z'),
    valueCents: 21775,
    taxCents: 1775,
    currency: 'USD',
    items: [{ id: 'service_102', name: 'Podcast Pro', category: 'podcast', quantity: 1, priceCents: 20000 }],
    transactionId: deterministicEventId('purchase_confirmed', 'purchase-uuid'),
    pageUrl: 'https://zayro.studio/booking/success',
    clickIds: { fbclid: 'IwAR0', rdt_cid: 'rdt-click', epik: 'epik-click', ttclid: 'tt-click', twclid: 'tw-click' },
    vendorIds: { fbp: 'fb.1.1700000000000.123', ttp: 'ttp-id', rdt: 'rdt-uuid', ga: 'GA1.1.111.222' },
    clickAt: new Date('2026-11-09T15:00:00Z'),
    ...over,
  });

  it('every server platform receives the same internal event ID and the authoritative value', () => {
    const id = ctx().eventId;
    const bodies: Record<string, any> = {};
    for (const [dest, adapter] of Object.entries(SERVER_ADAPTERS)) {
      const built = adapter!(ctx({ destination: dest as any }));
      expect('request' in built, dest).toBe(true);
      if ('request' in built) bodies[dest] = JSON.parse(built.request.body);
    }
    expect(bodies.meta_capi.data[0]).toMatchObject({ event_name: 'Purchase', event_id: id, action_source: 'website', custom_data: { value: 217.75, currency: 'USD' } });
    expect(bodies.reddit_capi.data.events[0]).toMatchObject({ action_source: 'WEBSITE', type: { tracking_type: 'Purchase' }, click_id: 'rdt-click', metadata: { conversion_id: id, value: 217.75, currency: 'USD' } });
    expect(bodies.pinterest_capi.data[0]).toMatchObject({ event_name: 'checkout', event_id: id, action_source: 'web', user_data: { click_id: 'epik-click' }, custom_data: { currency: 'USD', value: '217.75' } });
    expect(bodies.tiktok_events_api.data[0]).toMatchObject({ event: 'CompletePayment', event_id: id, user: { ttclid: 'tt-click' }, properties: { value: 217.75, currency: 'USD' } });
    expect(bodies.ga4.events[0]).toMatchObject({ name: 'purchase', params: { transaction_id: id, value: 217.75, tax: 17.75, currency: 'USD', affiliation: 'ZAYRO Studios' } });
    expect(bodies.ga4.client_id).toBe('111.222');
    expect(bodies.x_capi.conversions[0]).toMatchObject({ event_id: 'tw-o8z6j-o8z6k', identifiers: [{ twclid: 'tw-click' }], conversion_id: id, value: '217.75', price_currency: 'USD', number_items: 1 });
  });

  it('X Conversion API is signed with OAuth 1.0a and never leaks the secrets', () => {
    const built = SERVER_ADAPTERS.x_capi!(ctx({ destination: 'x_capi' as any }));
    expect('request' in built).toBe(true);
    if (!('request' in built)) return;
    expect(built.request.url).toBe('https://ads-api.x.com/12/measurement/conversions/o8z6j');
    const auth = built.request.headers.Authorization;
    expect(auth).toMatch(/^OAuth oauth_consumer_key="x-consumer-key", oauth_nonce="[0-9a-f]{32}", oauth_signature_method="HMAC-SHA1", oauth_timestamp="\d+", oauth_token="x-access-token-value", oauth_version="1.0", oauth_signature="[^"]+"$/);
    expect(auth).not.toContain('x-consumer-secret-value');
    expect(auth).not.toContain('x-access-secret-value');
    expect(built.request.body).not.toContain('secret');
    // Deterministic signature for fixed nonce / time (RFC 5849 HMAC-SHA1 over the sorted oauth_* parameters).
    const fixed = oauth1Header('https://ads-api.x.com/12/measurement/conversions/o8z6j', serverCredentialsForTest(), 'abc', '1700000000');
    expect(fixed).toBe(oauth1Header('https://ads-api.x.com/12/measurement/conversions/o8z6j', serverCredentialsForTest(), 'abc', '1700000000'));
    expect(sanitizeError(`401 ${auth}`)).toBe('401 OAuth [redacted]');
    // Without the X click ID there is no match key: skipped, never sent.
    expect(SERVER_ADAPTERS.x_capi!(ctx({ destination: 'x_capi' as any, clickIds: {} }))).toEqual({ skip: 'no_match_keys' });
  });

  it('uses test modes and never puts customer PII in a payload', () => {
    const all = Object.entries(SERVER_ADAPTERS).map(([dest, a]) => a!(ctx({ destination: dest as any })));
    const text = all.map((b) => ('request' in b ? b.request.body : '')).join('\n');
    expect(text).not.toMatch(/@example|lovelace|212 ?555|"notes"|cs_test|pi_test|ZAY-|customer_email|"em"|"ph"/i);
    const meta = all.find((b) => 'request' in b && b.request.destination === 'meta_capi') as any;
    expect(JSON.parse(meta.request.body).test_event_code).toBe('TEST123');
    const tt = all.find((b) => 'request' in b && b.request.destination === 'tiktok_events_api') as any;
    expect(JSON.parse(tt.request.body).test_event_code).toBe('TEST999');
    const rd = all.find((b) => 'request' in b && b.request.destination === 'reddit_capi') as any;
    expect(JSON.parse(rd.request.body).data.test_mode).toBe(true);
    const pin = all.find((b) => 'request' in b && b.request.destination === 'pinterest_capi') as any;
    expect(pin.request.url).toContain('test=true');
    expect(JSON.parse(pin.request.body).data[0].opt_out).toBe(false);
  });

  it('checkout and purchase never share an ID or a platform event name', () => {
    const checkout = SERVER_ADAPTERS.meta_capi!(ctx({ name: 'checkout_created', eventId: deterministicEventId('checkout_created', 'booking-uuid') }));
    const purchase = SERVER_ADAPTERS.meta_capi!(ctx());
    const a = JSON.parse((checkout as any).request.body).data[0];
    const b = JSON.parse((purchase as any).request.body).data[0];
    expect(a.event_name).toBe('InitiateCheckout');
    expect(a.event_id).not.toBe(b.event_id);
    expect(PLATFORM_EVENTS.purchase_confirmed?.tiktok).toBe('CompletePayment');
    expect(PLATFORM_EVENTS.checkout_created?.tiktok).not.toBe('CompletePayment');
  });

  it('skips without match keys or configuration', () => {
    expect(SERVER_ADAPTERS.reddit_capi!(ctx({ clickIds: {}, vendorIds: {} }))).toEqual({ skip: 'no_match_keys' });
    expect(SERVER_ADAPTERS.tiktok_events_api!(ctx({ clickIds: {}, vendorIds: {} }))).toEqual({ skip: 'no_match_keys' });
    expect(SERVER_ADAPTERS.pinterest_capi!(ctx({ clickIds: {}, vendorIds: {} }))).toEqual({ skip: 'no_match_keys' });
    expect(SERVER_ADAPTERS.ga4!(ctx({ vendorIds: {} }))).toEqual({ skip: 'no_client_id' });
    delete process.env.TIKTOK_EVENTS_ACCESS_TOKEN;
    expect(SERVER_ADAPTERS.tiktok_events_api!(ctx())).toEqual({ skip: 'not_configured' });
    expect(destinationStatus('tiktok_events_api')).toMatchObject({ configured: false, missing: ['TIKTOK_EVENTS_ACCESS_TOKEN'] });
  });

  it('missing vendor configuration disables destinations; vendors are off in tests unless explicitly allowed', () => {
    for (const k of Object.keys(env)) delete process.env[k];
    for (const d of DESTINATIONS) expect(destinationStatus(d).configured, d).toBe(false);
    const pub = publicAnalyticsConfig();
    expect(pub).toMatchObject({ vendorsEnabled: false, gtmId: null, ga4Id: null, metaPixelId: null, redditPixelId: null, pinterestTagId: null, tiktokPixelId: null, googleAds: null });
    Object.assign(process.env, env);
    expect(serverDestinationActive('meta_capi')).toBe(false); // test environment
    __setAnalyticsTestRuntime({ vendorsAllowed: true });
    expect(serverDestinationActive('meta_capi')).toBe(true);
    expect(serverDestinationActive('meta_pixel')).toBe(false); // browser destination
  });

  it('public config never contains a secret', () => {
    __setAnalyticsTestRuntime({ vendorsAllowed: true });
    process.env.NEXT_PUBLIC_GTM_CONTAINER_ID = 'GTM-TEST';
    const text = JSON.stringify(publicAnalyticsConfig());
    delete process.env.NEXT_PUBLIC_GTM_CONTAINER_ID;
    for (const secret of ['ga4-secret-value', 'meta-token-value', 'reddit-token-value', 'pin-token-value', 'tiktok-token-value']) expect(text).not.toContain(secret);
    expect(text).toContain('GTM-TEST');
  });

  it('sanitises stored errors', () => {
    const msg = sanitizeError('HTTP 400: {"error":"bad access_token=EAAB123 for jane@example.com at https://graph.facebook.com/v21.0/1/events?access_token=EAAB123", Authorization: Bearer abc.def}');
    expect(msg).not.toMatch(/EAAB123|jane@example\.com|graph\.facebook|abc\.def/);
    expect(msg.length).toBeLessThanOrEqual(300);
  });
});

describe('catalogue', () => {
  it('browser and server events never overlap; every destination has a consent rule', () => {
    expect(BROWSER_EVENTS.filter((e) => (SERVER_EVENTS as readonly string[]).includes(e))).toEqual([]);
    for (const d of DESTINATIONS) expect(DESTINATION_CONSENT[d]).toBeDefined();
    expect(Object.entries(DESTINATION_CONSENT).filter(([, c]) => c === 'analytics').map(([d]) => d)).toEqual(['ga4']);
  });

  it('docs/marketing-event-matrix.md documents every mapped event and platform name', () => {
    const doc = readFileSync('docs/marketing-event-matrix.md', 'utf8');
    for (const [event, map] of Object.entries(PLATFORM_EVENTS)) {
      expect(doc, event).toContain(`\`${event}\``);
      for (const name of Object.values(map ?? {})) if (typeof name === 'string' && !['booking', 'tour', 'contact'].includes(name)) expect(doc, `${event} → ${name}`).toContain(name.replace(/^(Custom|custom):/, ''));
    }
  });

  it('touch cleaning re-validates what the browser sends', () => {
    const t = cleanTouch({ utm: { utm_source: 'Reddit', utm_medium: '<b>paid_social</b>', evil: 'x' } as any, clickIds: { rdt_cid: 'ok-1', foo: 'bar' } as any, landingPath: '/admin', referrer: 'https://www.tiktok.com/@someone/video/1' }, 'zayro.studio');
    expect(t).toEqual({ utm: { utm_source: 'reddit', utm_medium: 'bpaid_social/b' }, clickIds: { rdt_cid: 'ok-1' }, landingPath: null, referrerHost: 'tiktok.com' });
  });
});

function serverCredentialsForTest() {
  return { consumerKey: 'k', consumerSecret: 's', accessToken: 't', accessTokenSecret: 'ts' };
}

describe('Marketing Analyst role', () => {
  const analyst = SYSTEM_ROLE_PERMISSIONS['Marketing Analyst'];

  it('has only aggregate analytics permissions', () => {
    expect([...analyst].sort()).toEqual(['analytics.export', 'analytics.read']);
    const forbidden = [
      'bookings.read', 'bookings.create', 'bookings.update', 'bookings.cancel', 'bookings.refund', 'customers.read', 'customers.update', 'customers.merge', 'notes.write',
      'purchases.read', 'purchases.create', 'packages.read', 'packages.manage', 'services.manage', 'availability.manage', 'reports.read', 'reports.export',
      'integrations.read', 'integrations.retry', 'team.manage', 'audit.read', 'settings.manage',
    ] as const;
    for (const p of forbidden) expect(hasPermission(analyst, p), p).toBe(false);
    expect(ALL_PERMISSIONS).toContain('analytics.read');
    expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.Owner, 'analytics.export')).toBe(true);
    // Existing roles are unchanged.
    expect(hasPermission(SYSTEM_ROLE_PERMISSIONS['Studio Manager'], 'analytics.read')).toBe(false);
  });

  it('sees only the aggregate marketing sections: hub, analytics and the UTM builder', () => {
    expect(NAV_ITEMS.filter((i) => hasPermission(analyst, i.permission)).map((i) => i.href)).toEqual(['/admin/marketing', '/admin/analytics', '/admin/utm']);
    // No lead contact details, landing pages, tracking code or spend.
    for (const p of ['leads.read', 'leads.manage', 'pages.manage', 'marketing.scripts', 'marketing.spend'] as const) expect(hasPermission(analyst, p), p).toBe(false);
  });
});

describe('client bundle boundary', () => {
  const clientFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? clientFiles(p) : /\.(ts|tsx)$/.test(f) && !f.includes('.test.') ? [p] : [];
    });

  it('browser analytics code reads no environment variable and imports no server module at runtime', () => {
    const files = [...clientFiles('src/lib/analytics/browser'), ...clientFiles('src/components/analytics').filter((f) => !f.endsWith('AnalyticsHead.tsx'))];
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/process\.env/);
      // Only type imports from server modules (erased at build time).
      for (const line of src.split('\n').filter((l) => /from ['"].*server\//.test(l))) expect(line, f).toMatch(/^import type /);
    }
  });
});

describe('cron authorisation', () => {
  const saved = { c: process.env.CRON_SECRET, a: process.env.ANALYTICS_CRON_SECRET };
  afterEach(() => {
    for (const [k, v] of [['CRON_SECRET', saved.c], ['ANALYTICS_CRON_SECRET', saved.a]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('accepts only Bearer CRON_SECRET (the header Vercel Cron sends); no second secret name', async () => {
    const { authorisedCron, cronSecretConfigured } = await import('./server/cron');
    delete process.env.CRON_SECRET;
    expect(cronSecretConfigured()).toBe(false);
    expect(authorisedCron('Bearer anything')).toBe(false);
    process.env.CRON_SECRET = 'analytics-cron-secret-0123456789';
    expect(cronSecretConfigured()).toBe(true);
    expect(authorisedCron('Bearer analytics-cron-secret-0123456789')).toBe(true);
    expect(authorisedCron('Bearer analytics-cron-secret-012345678')).toBe(false);
    expect(authorisedCron('analytics-cron-secret-0123456789')).toBe(false);
    expect(authorisedCron(null)).toBe(false);
    // A legacy ANALYTICS_CRON_SECRET is ignored.
    delete process.env.CRON_SECRET;
    process.env.ANALYTICS_CRON_SECRET = 'analytics-cron-secret-0123456789';
    expect(authorisedCron('Bearer analytics-cron-secret-0123456789')).toBe(false);
    process.env.CRON_SECRET = 'short';
    expect(authorisedCron('Bearer short')).toBe(false);
  });

  it('no source, config or doc file refers to ANALYTICS_CRON_SECRET', () => {
    const files = ['.env.example', 'vercel.json', 'docs/analytics.md', 'docs/analytics-rollout.md', 'src/lib/analytics/server/cron.ts', 'src/app/api/analytics/deliveries/route.ts'];
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toContain('ANALYTICS_CRON_SECRET');
  });

  it('vercel.json schedules retries every 10 minutes and a daily cleanup, with no secret in the path', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(cfg.crons).toEqual([
      { path: '/api/analytics/deliveries', schedule: '*/10 * * * *' },
      { path: '/api/analytics/deliveries?cleanup=1', schedule: '30 8 * * *' },
    ]);
    expect(JSON.stringify(cfg)).not.toMatch(/secret|token|bearer/i);
  });
});

describe('vendor master switch', () => {
  it('parses strictly: only 1 or true enable it', async () => {
    const { parseVendorSwitch } = await import('./server/config');
    for (const v of [undefined, null, '', ' ', '0', 'false', 'FALSE', 'no', 'off', 'yes', 'on', '2', 'enabled']) expect(parseVendorSwitch(v as any), String(v)).toBe(false);
    for (const v of ['1', 'true', 'TRUE', ' True ']) expect(parseVendorSwitch(v), v).toBe(true);
  });

  it('switch off: no public vendor ID reaches the browser (no GTM, GA4, Ads or pixels)', async () => {
    const env = process.env as Record<string, string | undefined>;
    const keep = { ...env };
    try {
      Object.assign(env, { NODE_ENV: 'production', VERCEL_ENV: 'production', NEXT_PUBLIC_GTM_CONTAINER_ID: 'GTM-TEST', NEXT_PUBLIC_GA4_MEASUREMENT_ID: 'G-TEST', NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: 'G-LEGACY', NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID: 'AW-1', GA4_API_SECRET: 'x', NEXT_PUBLIC_META_PIXEL_ID: '1234567890', NEXT_PUBLIC_REDDIT_PIXEL_ID: 't2_x', NEXT_PUBLIC_PINTEREST_TAG_ID: '2612345', NEXT_PUBLIC_TIKTOK_PIXEL_ID: 'C3' });
      delete env.VITEST;
      for (const off of [undefined, '', '0', 'false', 'no']) {
        if (off === undefined) delete env.ANALYTICS_VENDORS_ENABLED;
        else env.ANALYTICS_VENDORS_ENABLED = off;
        expect(publicAnalyticsConfig(), String(off)).toEqual({ vendorsEnabled: false, gtmId: null, ga4Id: null, ga4ServerSide: false, googleAds: null, metaPixelId: null, redditPixelId: null, pinterestTagId: null, tiktokPixelId: null, xPixelId: null, xEventIds: {} });
        expect(serverDestinationActive('meta_capi')).toBe(false);
      }
      env.ANALYTICS_VENDORS_ENABLED = 'true';
      const on = publicAnalyticsConfig();
      expect(on).toMatchObject({ vendorsEnabled: true, gtmId: 'GTM-TEST', ga4Id: 'G-TEST', metaPixelId: '1234567890', redditPixelId: 't2_x', pinterestTagId: '2612345', tiktokPixelId: 'C3', ga4ServerSide: true });
      expect(on.googleAds?.id).toBe('AW-1');
    } finally {
      for (const k of Object.keys(env)) if (!(k in keep)) delete env[k];
      Object.assign(env, keep);
    }
  });

  it('legacy names are fallbacks; the new names win when both are set', async () => {
    const env = process.env as Record<string, string | undefined>;
    const keep = { ...env };
    try {
      Object.assign(env, { NODE_ENV: 'production', VERCEL_ENV: 'production', ANALYTICS_VENDORS_ENABLED: '1', NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: 'G-LEGACY', NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID: 'AW-LEGACY' });
      delete env.VITEST;
      expect(publicAnalyticsConfig()).toMatchObject({ ga4Id: 'G-LEGACY', googleAds: { id: 'AW-LEGACY' } });
      Object.assign(env, { NEXT_PUBLIC_GA4_MEASUREMENT_ID: 'G-NEW', GOOGLE_ADS_CONVERSION_ID: 'AW-NEW' });
      expect(publicAnalyticsConfig()).toMatchObject({ ga4Id: 'G-NEW', googleAds: { id: 'AW-NEW' } });
    } finally {
      for (const k of Object.keys(env)) if (!(k in keep)) delete env[k];
      Object.assign(env, keep);
    }
  });

  it('production with vendor IDs still sends nothing until ANALYTICS_VENDORS_ENABLED=1', async () => {
    const { vendorsAllowed } = await import('./server/config');
    const keep = { NODE_ENV: process.env.NODE_ENV, VITEST: process.env.VITEST, VERCEL_ENV: process.env.VERCEL_ENV, ANALYTICS_VENDORS_ENABLED: process.env.ANALYTICS_VENDORS_ENABLED };
    const env = process.env as Record<string, string | undefined>;
    try {
      env.NODE_ENV = 'production';
      delete env.VITEST;
      env.VERCEL_ENV = 'production';
      process.env.NEXT_PUBLIC_META_PIXEL_ID = '1234567890';
      delete env.ANALYTICS_VENDORS_ENABLED;
      expect(vendorsAllowed()).toBe(false);
      expect(publicAnalyticsConfig().metaPixelId).toBeNull();
      env.ANALYTICS_VENDORS_ENABLED = '1';
      expect(vendorsAllowed()).toBe(true);
      env.VERCEL_ENV = 'preview';
      expect(vendorsAllowed()).toBe(false);
    } finally {
      for (const [k, v] of Object.entries(keep)) {
        if (v === undefined) delete env[k];
        else env[k] = v;
      }
      delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    }
  });
});
