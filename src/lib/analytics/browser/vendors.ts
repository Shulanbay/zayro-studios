/**
 * Browser vendor tags, loaded only when configured, on the production
 * site, and after the matching consent:
 *   - Google tag (gtag.js) only when there is no GTM container — GTM and a
 *     separate gtag.js are never both loaded, so nothing is counted twice;
 *   - Meta Pixel, Reddit Pixel, Pinterest Tag, TikTok Pixel: Advertising
 *     consent only.
 * Each loader runs once per page load. None of them fires a PageView on
 * init; the tracker sends page views itself on every App Router navigation,
 * so a route change is counted exactly once.
 */
import type { PublicAnalyticsConfig } from '../server/config';

type AnyFn = (...args: unknown[]) => void;
type W = Window & {
  dataLayer?: unknown[];
  gtag?: AnyFn;
  fbq?: AnyFn & { callMethod?: AnyFn; queue?: unknown[]; loaded?: boolean; version?: string; push?: AnyFn };
  _fbq?: unknown;
  rdt?: AnyFn & { sendEvent?: AnyFn; callQueue?: unknown[] };
  pintrk?: AnyFn & { queue?: unknown[]; version?: string };
  ttq?: Record<string, any> & unknown[];
  TiktokAnalyticsObject?: string;
};

const loaded = new Set<string>();

function addScript(src: string, id: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  s.id = id;
  document.head.appendChild(s);
}

export function ensureGtag(w: W) {
  w.dataLayer = w.dataLayer || [];
  if (!w.gtag) {
    w.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer!.push(arguments);
    };
  }
  return w.gtag;
}

/** Direct gtag.js mode (no GTM): GA4 and/or Google Ads, page views sent manually. */
export function loadGoogleTag(config: PublicAnalyticsConfig, consent: { analytics: boolean; advertising: boolean }) {
  if (config.gtmId || loaded.has('gtag')) return;
  const ids = [consent.analytics && config.ga4Id ? config.ga4Id : null, consent.advertising && config.googleAds ? config.googleAds.id : null].filter(Boolean) as string[];
  if (!ids.length) return;
  const w = window as W;
  const gtag = ensureGtag(w);
  loaded.add('gtag');
  addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids[0])}`, 'zayro-gtag');
  gtag('js', new Date());
  for (const id of ids) gtag('config', id, { send_page_view: false, allow_enhanced_conversions: false });
}

export function loadMetaPixel(id: string) {
  if (loaded.has('meta')) return;
  loaded.add('meta');
  const w = window as W;
  if (!w.fbq) {
    const n: any = function (...args: unknown[]) {
      // eslint-disable-next-line prefer-spread
      n.callMethod ? n.callMethod.apply(n, args) : n.queue.push(args);
    };
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    w.fbq = n;
    if (!w._fbq) w._fbq = n;
  }
  addScript('https://connect.facebook.net/en_US/fbevents.js', 'zayro-meta');
  // Advanced matching stays off: no user data is passed to init.
  w.fbq!('init', id);
}

export function loadRedditPixel(id: string) {
  if (loaded.has('reddit')) return;
  loaded.add('reddit');
  const w = window as W;
  if (!w.rdt) {
    const p: any = function (...args: unknown[]) {
      // eslint-disable-next-line prefer-spread
      p.sendEvent ? p.sendEvent.apply(p, args) : p.callQueue.push(args);
    };
    p.callQueue = [];
    w.rdt = p;
  }
  addScript('https://www.redditstatic.com/ads/pixel.js', 'zayro-reddit');
  w.rdt!('init', id, { optOut: false, useDecimalCurrencyValues: true });
}

export function loadPinterestTag(id: string) {
  if (loaded.has('pinterest')) return;
  loaded.add('pinterest');
  const w = window as W;
  if (!w.pintrk) {
    const p: any = function (...args: unknown[]) {
      p.queue.push(Array.prototype.slice.call(args));
    };
    p.queue = [];
    p.version = '3.0';
    w.pintrk = p;
  }
  addScript('https://s.pinimg.com/ct/core.js', 'zayro-pinterest');
  w.pintrk!('load', id);
}

export function loadTikTokPixel(id: string) {
  if (loaded.has('tiktok')) return;
  loaded.add('tiktok');
  const w = window as W;
  w.TiktokAnalyticsObject = 'ttq';
  const ttq: any = (w.ttq = w.ttq || ([] as any));
  ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
  ttq.setAndDefer = (t: any, e: string) => {
    t[e] = (...args: unknown[]) => t.push([e, ...args]);
  };
  for (const m of ttq.methods) ttq.setAndDefer(ttq, m);
  ttq.load = (pixel: string) => {
    ttq._i = ttq._i || {};
    ttq._i[pixel] = [];
    ttq._t = ttq._t || {};
    ttq._t[pixel] = +new Date();
    addScript(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(pixel)}&lib=ttq`, 'zayro-tiktok');
  };
  ttq.load(id);
}

export function loadAdvertisingTags(config: PublicAnalyticsConfig) {
  if (config.metaPixelId) loadMetaPixel(config.metaPixelId);
  if (config.redditPixelId) loadRedditPixel(config.redditPixelId);
  if (config.pinterestTagId) loadPinterestTag(config.pinterestTagId);
  if (config.tiktokPixelId) loadTikTokPixel(config.tiktokPixelId);
}

export function vendorWindow(): W {
  return window as W;
}
