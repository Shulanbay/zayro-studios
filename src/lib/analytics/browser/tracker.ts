/**
 * The typed browser analytics API. UI code calls trackEvent() /
 * trackConversion() and never touches dataLayer, gtag, fbq, rdt, pintrk or
 * ttq directly. Adapters:
 *   - firstParty: batches events to /api/analytics/collect (keepalive);
 *   - dataLayer: GTM / gtag events with GA4 names (Analytics consent);
 *   - pixels: Meta, Reddit, Pinterest, TikTok, X (Advertising consent).
 *
 * Never sent anywhere: names, emails, phones, notes, guest details, Stripe
 * IDs, booking references, Manage Booking tokens. Admin, API and Manage
 * Booking pages are never tracked.
 */
import type { PublicAnalyticsConfig } from '../server/config';
import type { ConversionPayload } from '../server/hooks';
import { captureFromUrl, isTrackablePath, sanitizePageUrl, sanitizePath, stripClickIds, type CapturedTouch } from '../attribution';
import { PLATFORM_EVENTS, type BrowserEventName, type Destination } from '../catalog';
import { CONSENT_COOKIE, applyGpc, consentModeSignals, currentConsent, type ConsentState } from '../consent';
import { ensureGtag, loadAdvertisingTags, loadGoogleTag, vendorWindow } from './vendors';

interface QueuedEvent {
  name: BrowserEventName;
  eventId: string;
  occurredAt: number;
  path: string;
  properties: Record<string, unknown>;
}

const state: {
  config: PublicAnalyticsConfig | null;
  consent: ConsentState | null;
  queue: QueuedEvent[];
  touch: CapturedTouch | null;
  touchSent: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  urlCleaned: boolean;
  listeners: Set<(c: ConsentState | null) => void>;
} = { config: null, consent: null, queue: [], touch: null, touchSent: false, timer: null, urlCleaned: false, listeners: new Set() };

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Fallback for very old browsers: v4 layout from getRandomValues.
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
}

function readCookie(name: string): string | null {
  try {
    const hit = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
    return hit ? hit.slice(name.length + 1) : null;
  } catch {
    return null;
  }
}

/** Global Privacy Control signal from the browser (an opt-out of advertising). */
export function browserGpc(): boolean {
  return typeof navigator !== 'undefined' && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

export function readStoredConsent(): ConsentState | null {
  return applyGpc(currentConsent(readCookie(CONSENT_COOKIE)), browserGpc());
}

export function getConsent(): ConsentState | null {
  return state.consent;
}

export function onConsentChange(fn: (c: ConsentState | null) => void): () => void {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

const path = () => (typeof location === 'undefined' ? '/' : location.pathname);
const trackable = () => typeof window !== 'undefined' && isTrackablePath(path());
const googleOn = () => !!state.config?.vendorsEnabled && !!state.consent?.analytics && !!(state.config.gtmId || state.config.ga4Id);
const adsOn = () => !!state.config?.vendorsEnabled && !!state.consent?.advertising;

/** Called once by the provider, before any event. */
export function initAnalytics(config: PublicAnalyticsConfig) {
  if (state.config) return;
  state.config = config;
  state.consent = readStoredConsent();
  try {
    state.touch = captureFromUrl(location.href, document.referrer || null, location.hostname);
  } catch {
    state.touch = null;
  }
  applyVendors();
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => flush(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush(true);
    });
  }
}

/** Consent changed (banner / preferences): update Consent Mode, load allowed tags, clean the URL. */
export function setConsent(next: ConsentState | null) {
  next = applyGpc(next, browserGpc());
  state.consent = next;
  const w = vendorWindow();
  ensureGtag(w)('consent', 'update', consentModeSignals(next));
  applyVendors();
  state.listeners.forEach((fn) => fn(next));
  flush(false);
}

function applyVendors() {
  const c = state.config;
  if (!c || !trackable()) return;
  if (c.vendorsEnabled && state.consent) {
    loadGoogleTag(c, state.consent);
    if (state.consent.advertising) loadAdvertisingTags(c);
  }
  cleanUrlSoon();
}

/**
 * After click IDs are captured (and, with Advertising consent, after the
 * pixels had a moment to read them), remove them from the visible URL so
 * they aren't bookmarked, shared or copied into other links.
 */
function cleanUrlSoon() {
  if (state.urlCleaned || !state.consent) return;
  const delay = state.consent.advertising ? 2500 : 0;
  setTimeout(() => {
    try {
      const next = stripClickIds(location.href);
      if (next) history.replaceState(history.state, '', next);
      state.urlCleaned = true;
    } catch {
      // ignore
    }
  }, delay);
}

function vendorIds(): Record<string, string> {
  const out: Record<string, string> = {};
  const c = state.consent;
  if (!c) return out;
  const add = (k: string, cookie: string) => {
    const v = readCookie(cookie);
    if (v && /^[A-Za-z0-9._~-]{1,600}$/.test(v)) out[k] = v;
  };
  if (c.analytics) add('ga', '_ga');
  if (c.advertising) {
    add('fbp', '_fbp');
    add('fbc', '_fbc');
    add('ttp', '_ttp');
    add('epik', '_epik');
    add('rdt', '_rdt_uuid');
  }
  return out;
}

function schedule() {
  if (state.timer) return;
  state.timer = setTimeout(() => flush(false), 800);
}

/** Sends queued first-party events. Fails silently: analytics never affects the page. */
export function flush(unloading: boolean, dispatch?: { eventId: string; destinations: Destination[] }) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (!state.queue.length && !dispatch) return;
  // Until the visitor chooses, hold events so the landing page can be linked to the
  // session if they accept; if they leave first, send them without any identifier.
  if (!state.consent && !unloading && !dispatch) return;
  const events = state.queue.splice(0, 20);
  const consented = !!state.consent?.analytics;
  const body: Record<string, unknown> = { events, automated: !!(navigator as Navigator & { webdriver?: boolean }).webdriver || undefined };
  if (consented && !state.touchSent && state.touch) {
    const t = state.touch;
    body.touch = {
      utm: t.utm,
      clickIds: state.consent?.advertising ? t.clickIds : {},
      landingPath: t.landingPath,
      referrer: t.referrerHost ? `https://${t.referrerHost}/` : null,
    };
    state.touchSent = true;
  }
  if (consented) body.vendorIds = vendorIds();
  if (dispatch) body.dispatch = dispatch;
  const json = JSON.stringify(body);
  try {
    if (unloading && navigator.sendBeacon) navigator.sendBeacon('/api/analytics/collect', new Blob([json], { type: 'application/json' }));
    else void fetch('/api/analytics/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
  } catch {
    // ignore
  }
  if (state.queue.length) schedule();
}

function pushDataLayer(event: string, params: Record<string, unknown>) {
  if (!googleOn()) return;
  const w = vendorWindow();
  if (state.config?.gtmId) {
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ event, ...params });
  } else {
    ensureGtag(w)('event', event, params);
  }
}

/** One browser funnel event. Unknown names don't compile; properties are validated again on the server. */
export function trackEvent(name: BrowserEventName, properties: Record<string, unknown> = {}) {
  if (!trackable()) return;
  const eventId = uuid();
  state.queue.push({ name, eventId, occurredAt: Date.now(), path: sanitizePath(path()) ?? '/', properties });
  schedule();

  if (name === 'page_view') return vendorPageView(eventId, { ga4: true, ads: true });
  const map = PLATFORM_EVENTS[name];
  const pageParams = { page_path: sanitizePath(path()) ?? '/', page_title: document.title.slice(0, 120) };
  if (map?.ga4) pushDataLayer(map.ga4, { event_id: eventId, ...pageParams, ...properties });
  // Generic booking-step event for GTM / GA4 funnels (the specific step event above stays the source of truth).
  const step = BOOKING_STEP_INDEX[name];
  if (step) pushDataLayer('booking_step_completed', { event_id: `${eventId}:step`, booking_step: step, booking_step_name: name, ...pageParams, service_id: properties.service_id });
  if (adsOn()) {
    const w = vendorWindow();
    const content = { content_category: properties.category, content_name: properties.service_name };
    try {
      if (map?.meta === 'ViewContent') {
        if (state.config?.metaPixelId) w.fbq?.('track', 'ViewContent', content, { eventID: eventId });
        if (state.config?.redditPixelId) w.rdt?.('track', 'ViewContent', { conversionId: eventId });
        if (state.config?.pinterestTagId) w.pintrk?.('track', 'viewcategory', { event_id: eventId });
        if (state.config?.tiktokPixelId) w.ttq?.track?.('ViewContent', {}, { event_id: eventId });
        const xId = state.config?.xEventIds?.view_content;
        if (state.config?.xPixelId && xId) w.twq?.('event', xId, { conversion_id: eventId });
      }
      // Contact / click events: standard non-purchase events on platforms that have one.
      if (map?.meta && map.meta !== 'ViewContent' && map.meta !== 'PageView' && state.config?.metaPixelId) w.fbq?.('track', map.meta, {}, { eventID: eventId });
      if (map?.tiktok && map.tiktok !== 'ViewContent' && map.tiktok !== 'PageView' && state.config?.tiktokPixelId && isBrowserEventTikTok(map.tiktok)) w.ttq?.track?.(map.tiktok, {}, { event_id: eventId });
    } catch {
      // a vendor script error never breaks the page
    }
  }
}

/** Booking-flow steps in order (the dataLayer also gets a generic booking_step_completed). */
const BOOKING_STEP_INDEX: Partial<Record<BrowserEventName, number>> = {
  booking_started: 1,
  service_selected: 2,
  setup_selected: 3,
  date_selected: 4,
  time_selected: 5,
  extras_reached: 6,
  details_started: 7,
  hold_created: 8,
};

/** TikTok events the browser may send for clicks (never the conversion events, which come from trackConversion). */
function isBrowserEventTikTok(name: string): boolean {
  return name === 'ClickButton' || name === 'Contact';
}

/** GA4 + pixel page view for the current route (once per navigation). */
function vendorPageView(eventId: string, which: { ga4: boolean; ads: boolean }) {
  if (which.ga4) pushDataLayer('page_view', { event_id: eventId, page_path: sanitizePath(path()), page_location: sanitizePageUrl(location.href, location.origin), page_title: document.title.slice(0, 120) });
  if (!which.ads || !adsOn()) return;
  const w = vendorWindow();
  try {
    if (state.config?.metaPixelId) w.fbq?.('track', 'PageView', {}, { eventID: eventId });
    if (state.config?.redditPixelId) w.rdt?.('track', 'PageVisit', { conversionId: eventId });
    if (state.config?.pinterestTagId) w.pintrk?.('page');
    if (state.config?.tiktokPixelId) w.ttq?.page?.();
    const xId = state.config?.xEventIds?.page_view;
    if (state.config?.xPixelId && xId) w.twq?.('event', xId, { conversion_id: eventId });
  } catch {
    // ignore vendor errors
  }
}

/** After consent is granted on a page: the tags that just became allowed see this page view. */
export function replayPageViewToVendors() {
  if (!trackable()) return;
  vendorPageView(uuid(), { ga4: true, ads: true });
}

function onceKey(id: string) {
  return `zayro_conv_${id}`;
}

/**
 * Mirrors a server-authoritative conversion to the browser tags with the
 * server's event ID, so each platform deduplicates browser + server copies
 * of the same conversion. Fires at most once per event ID per tab.
 */
export function trackConversion(c: ConversionPayload | null | undefined) {
  if (!c || !trackable() || !state.config?.vendorsEnabled) return;
  try {
    if (sessionStorage.getItem(onceKey(c.eventId))) return;
    sessionStorage.setItem(onceKey(c.eventId), '1');
  } catch {
    // storage blocked: the platforms still deduplicate on the event ID
  }
  const map = PLATFORM_EVENTS[c.name];
  const value = c.valueCents === null ? undefined : c.valueCents / 100;
  const currency = c.currency;
  const fired: Destination[] = [];
  const items = c.items.map((i) => ({ item_id: i.id, item_name: i.name, item_category: i.category, quantity: i.quantity, price: i.priceCents / 100 }));

  // GA4 via GTM / gtag — skipped for GA4 itself when the server sends it (Measurement Protocol).
  if (map?.ga4 && googleOn()) {
    const params: Record<string, unknown> = { event_id: c.eventId, value, currency };
    if (c.name === 'purchase_confirmed') Object.assign(params, { transaction_id: c.transactionId, tax: c.taxCents === null ? undefined : c.taxCents / 100, affiliation: 'ZAYRO Studios', items });
    pushDataLayer(c.ga4ServerSide ? 'zayro_conversion' : map.ga4, { ...params, conversion_name: c.name });
  }
  if (adsOn()) {
    const w = vendorWindow();
    const cfg = state.config!;
    try {
      const label = map?.googleAds ? cfg.googleAds?.labels[map.googleAds] : undefined;
      // With GTM, Google Ads conversion tags live in GTM (trigger on the dataLayer event); the site sends them only in direct gtag mode.
      if (label && cfg.googleAds && !cfg.gtmId) {
        ensureGtag(w)('event', 'conversion', { send_to: `${cfg.googleAds.id}/${label}`, value, currency, transaction_id: c.transactionId ?? c.eventId });
        fired.push('google_ads');
      }
      if (cfg.metaPixelId && map?.meta && w.fbq) {
        w.fbq('track', map.meta, { value, currency, content_ids: c.items.map((i) => i.id), content_type: c.items.length ? 'product' : undefined, num_items: c.items.length || undefined }, { eventID: c.eventId });
        fired.push('meta_pixel');
      }
      if (cfg.redditPixelId && map?.reddit && w.rdt) {
        const [type, custom] = map.reddit.startsWith('Custom:') ? ['Custom', map.reddit.slice(7)] : [map.reddit, undefined];
        w.rdt('track', type, { conversionId: c.eventId, value, currency, itemCount: c.items.reduce((n, i) => n + i.quantity, 0) || undefined, products: c.items.map((i) => ({ id: i.id, name: i.name, category: i.category })), ...(custom ? { customEventName: custom } : {}) });
        fired.push('reddit_pixel');
      }
      if (cfg.pinterestTagId && map?.pinterest && w.pintrk) {
        const ev = map.pinterest.startsWith('custom') ? 'custom' : map.pinterest;
        w.pintrk('track', ev, { event_id: c.eventId, value, currency, order_quantity: c.items.reduce((n, i) => n + i.quantity, 0) || undefined, order_id: c.name === 'purchase_confirmed' ? c.transactionId : undefined });
        fired.push('pinterest_tag');
      }
      if (cfg.tiktokPixelId && map?.tiktok && w.ttq?.track) {
        w.ttq.track(map.tiktok, { value, currency, content_type: c.items.length ? 'product' : undefined, contents: c.items.map((i) => ({ content_id: i.id, content_name: i.name, quantity: i.quantity, price: i.priceCents / 100 })) }, { event_id: c.eventId });
        fired.push('tiktok_pixel');
      }
      const xEvent = map?.x ? cfg.xEventIds?.[map.x] : undefined;
      if (cfg.xPixelId && xEvent && w.twq) {
        // conversion_id = the server's event ID, so X deduplicates pixel + Conversion API.
        w.twq('event', xEvent, { value, currency, conversion_id: c.eventId, contents: c.items.map((i) => ({ content_id: i.id, content_name: i.name, content_type: i.category, content_price: i.priceCents / 100, num_items: i.quantity })) });
        fired.push('x_pixel');
      }
    } catch {
      // ignore vendor errors
    }
  }
  if (fired.length) flush(false, { eventId: c.eventId, destinations: fired });
}

/** Test helper: reset module state. */
export function __resetTracker() {
  state.config = null;
  state.consent = null;
  state.queue = [];
  state.touch = null;
  state.touchSent = false;
  state.urlCleaned = false;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
}

export function __trackerState() {
  return state;
}
