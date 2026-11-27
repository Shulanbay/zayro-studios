/**
 * Campaign capture, URL sanitisation, channel classification and the three
 * attribution models. Pure — runs in the browser (capture) and on the
 * server (re-validation, snapshots). The server never trusts the browser's
 * classification: it re-runs `classifyTouch` on the sanitised inputs.
 *
 * Attribution models (docs/marketing-campaign-tracking.md):
 *  - First Touch: the visitor's first recorded session.
 *  - Last Non-Direct Touch: the most recent session inside the attribution
 *    window (default 90 days) whose channel is not "direct". A later direct
 *    visit never replaces it. If every session in the window is direct, it
 *    is the conversion session itself (direct).
 *  - Conversion Touch: the session in which the booking was created.
 */

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

/** Platform-native click identifiers, accepted only from these exact query parameters. */
// gbraid / wbraid: Google Ads click IDs on iOS app / web-to-app traffic (used instead of gclid).
// twclid: X (Twitter) Ads click ID.
export const CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'rdt_cid', 'epik', 'ttclid', 'twclid'] as const;
export type ClickIdKey = (typeof CLICK_ID_KEYS)[number];

export const CLICK_ID_MAX_LENGTH: Record<ClickIdKey, number> = { gclid: 200, gbraid: 200, wbraid: 200, fbclid: 500, rdt_cid: 200, epik: 300, ttclid: 500, twclid: 300 };
const CLICK_ID_RE = /^[A-Za-z0-9._~-]+$/;

export const UTM_MAX_LENGTH = 150;
export const PATH_MAX_LENGTH = 300;
export const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 90;
export const SESSION_TIMEOUT_MINUTES = 30;

/**
 * Query parameters never kept anywhere (paths, referrers, event source URLs):
 * Stripe session ids, booking references, management tokens, contact data.
 */
const SENSITIVE_PARAM = /^(session_id|booking_id|hold_id|token|t|code|key|secret|password|email|e-?mail|phone|tel|name|first_?name|last_?name|manage|signature|sig|auth|jwt|state|id_token|access_token)$/i;
/** Parameters we keep in a sanitised page URL (event source URL for ad platforms). */
const KEEP_PARAMS = new Set<string>(['service', 'category', 'setup', ...UTM_KEYS]);

/** Paths that are never tracked (admin, APIs, Manage Booking, token exchange, webhooks). */
const EXCLUDED_PATH = /^\/(admin|api|booking\/manage|_next)(\/|$)/;

export function isTrackablePath(path: string | null | undefined): boolean {
  if (!path || typeof path !== 'string' || !path.startsWith('/')) return false;
  return !EXCLUDED_PATH.test(path);
}

/** Path only, no query or fragment, bounded, with a safe character set. */
export function sanitizePath(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null;
  let path = input.split('#')[0].split('?')[0];
  if (!path.startsWith('/')) return null;
  path = path.replace(/[^A-Za-z0-9/_.~%-]/g, '').replace(/\/{2,}/g, '/');
  if (path.length > PATH_MAX_LENGTH) path = path.slice(0, PATH_MAX_LENGTH);
  return path || '/';
}

/**
 * A page URL safe to send to an ad platform as the event source URL:
 * origin + path + only allowlisted query parameters. Click IDs, tokens,
 * Stripe ids and anything unknown are removed; the fragment always goes
 * (Manage Booking keeps its token there).
 */
export function sanitizePageUrl(input: string | null | undefined, origin = 'https://zayro.studio'): string | null {
  if (!input) return null;
  try {
    const url = new URL(input, origin);
    const path = sanitizePath(url.pathname);
    if (!path || !isTrackablePath(path)) return null;
    const out = new URL(path, url.origin);
    url.searchParams.forEach((value, key) => {
      if (KEEP_PARAMS.has(key) && !SENSITIVE_PARAM.test(key)) out.searchParams.set(key, cleanUtm(value) ?? '');
    });
    return out.toString();
  } catch {
    return null;
  }
}

/** The referrer's host only — never its path or query (they can carry personal data). */
export function referrerHost(referrer: string | null | undefined, ownHost?: string | null): string | null {
  if (!referrer || typeof referrer !== 'string') return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '').slice(0, 255);
    if (!host) return null;
    // ownHost may carry a port ("localhost:3000"); URL.hostname never does.
    if (ownHost && host === ownHost.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '')) return null;
    return /^[a-z0-9.-]+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** UTM values: lowercase, trimmed, bounded, printable; email/phone-like values are dropped. */
export function cleanUtm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/[\u0000-\u001f<>"'`\\]/g, '').slice(0, UTM_MAX_LENGTH);
  if (!v) return null;
  if (looksLikePii(v)) return null;
  return v;
}

export function cleanClickId(key: ClickIdKey, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > CLICK_ID_MAX_LENGTH[key] || !CLICK_ID_RE.test(v)) return null;
  return v;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d[\s().-]{0,2}){9,}\d/;

/** Best-effort detection of an email address or phone number in a string. */
export function looksLikePii(value: string): boolean {
  return EMAIL_RE.test(value) || PHONE_RE.test(value) || /%40/.test(value);
}

export interface CampaignParams {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
}

export type ClickIds = Partial<Record<ClickIdKey, string>>;

export interface CapturedTouch {
  utm: CampaignParams;
  clickIds: ClickIds;
  landingPath: string | null;
  referrerHost: string | null;
}

/** Reads campaign parameters and click IDs from a URL's query string. */
export function captureFromUrl(href: string, referrer: string | null, ownHost: string | null): CapturedTouch {
  let params: URLSearchParams;
  let path: string | null = null;
  try {
    const url = new URL(href);
    params = url.searchParams;
    path = sanitizePath(url.pathname);
  } catch {
    params = new URLSearchParams();
  }
  const utm: CampaignParams = {};
  for (const k of UTM_KEYS) {
    const v = cleanUtm(params.get(k));
    if (v) utm[k] = v;
  }
  const clickIds: ClickIds = {};
  for (const k of CLICK_ID_KEYS) {
    const v = cleanClickId(k, params.get(k));
    if (v) clickIds[k] = v;
  }
  return { utm, clickIds, landingPath: path, referrerHost: referrerHost(referrer, ownHost) };
}

/** The same URL without click IDs (used with history.replaceState after capture). */
export function stripClickIds(href: string): string | null {
  try {
    const url = new URL(href);
    let changed = false;
    for (const k of CLICK_ID_KEYS) {
      if (url.searchParams.has(k)) {
        url.searchParams.delete(k);
        changed = true;
      }
    }
    return changed ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Channel classification
// ---------------------------------------------------------------------------

export type Channel = 'paid_search' | 'paid_social' | 'organic_search' | 'organic_social' | 'email' | 'referral' | 'display' | 'affiliate' | 'direct' | 'other';
export type Platform = 'google' | 'meta' | 'instagram' | 'reddit' | 'pinterest' | 'tiktok' | 'x' | 'chatgpt' | 'ai' | 'organic' | 'direct' | 'referral' | 'other';

export const PLATFORM_LABELS: Record<Platform, string> = {
  google: 'Google Ads',
  meta: 'Meta / Facebook',
  instagram: 'Instagram',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
  tiktok: 'TikTok',
  x: 'X (Twitter)',
  chatgpt: 'ChatGPT Ads',
  ai: 'AI assistants (ChatGPT, Perplexity, Gemini…)',
  organic: 'Organic (search & social)',
  direct: 'Direct',
  referral: 'Referral',
  other: 'Other',
};

const SEARCH_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yahoo\.com|search\.yahoo\.com|ecosia\.org|baidu\.com|yandex\.[a-z]+|search\.brave\.com)$/;
const SOCIAL_HOSTS: [RegExp, string][] = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|m\.facebook\.com|l\.facebook\.com|lm\.facebook\.com)$/, 'facebook'],
  [/(^|\.)(instagram\.com|l\.instagram\.com)$/, 'instagram'],
  [/(^|\.)(reddit\.com|old\.reddit\.com|out\.reddit\.com)$/, 'reddit'],
  [/(^|\.)(pinterest\.[a-z.]+|pin\.it)$/, 'pinterest'],
  [/(^|\.)(tiktok\.com)$/, 'tiktok'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'x'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)(threads\.net)$/, 'threads'],
];

/** Answer engines: organic referrals (ChatGPT also adds utm_source=chatgpt.com to links it shows). */
const AI_HOSTS = /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|gemini\.google\.com|bard\.google\.com|claude\.ai|copilot\.microsoft\.com|you\.com|phind\.com)$/;
const AI_SOURCES = /^(chatgpt(\.com)?|openai|chat\.openai\.com|perplexity(\.ai)?|gemini|claude(\.ai)?|copilot)$/;

const PAID_MEDIUM = /^(cpc|ppc|paid|paid_?search|paidsearch|sem|cpm|cpv|paid_?social|paidsocial|social_?paid|paid-social|ads?|display|banner|retargeting|remarketing)$/;
const SOCIAL_PLATFORMS: Record<string, Platform> = { facebook: 'meta', fb: 'meta', meta: 'meta', instagram: 'instagram', ig: 'instagram', reddit: 'reddit', pinterest: 'pinterest', tiktok: 'tiktok', x: 'x', twitter: 'x' };

export interface TouchInput {
  utm: CampaignParams;
  clickIdTypes: ClickIdKey[];
  referrerHost: string | null;
}

export interface ClassifiedTouch {
  source: string;
  medium: string;
  campaign: string | null;
  content: string | null;
  term: string | null;
  channel: Channel;
  platform: Platform;
}

function socialSourceFromHost(host: string | null): string | null {
  if (!host) return null;
  for (const [re, name] of SOCIAL_HOSTS) if (re.test(host)) return name;
  return null;
}

/**
 * Source / medium / channel / platform for one session's entry. Paid social
 * is normalised to `<platform> / paid_social`, never mixed with organic
 * social. A click ID alone marks the visit as paid on that platform.
 */
export function classifyTouch(input: TouchInput): ClassifiedTouch {
  const { utm, clickIdTypes, referrerHost: host } = input;
  let source = utm.utm_source ?? null;
  let medium = utm.utm_medium ?? null;
  const campaign = utm.utm_campaign ?? null;
  const content = utm.utm_content ?? null;
  const term = utm.utm_term ?? null;
  const has = (k: ClickIdKey) => clickIdTypes.includes(k);

  // Normalise known paid-social sources.
  const srcKey = source?.replace(/\.com$/, '') ?? '';
  if (srcKey in SOCIAL_PLATFORMS) source = srcKey === 'fb' || srcKey === 'meta' ? 'facebook' : srcKey === 'ig' ? 'instagram' : srcKey === 'twitter' ? 'x' : srcKey;

  // Click IDs fill in missing campaign tagging.
  if (!source) {
    if (has('gclid') || has('gbraid') || has('wbraid')) source = 'google';
    else if (has('fbclid')) source = socialSourceFromHost(host) === 'instagram' ? 'instagram' : 'facebook';
    else if (has('rdt_cid')) source = 'reddit';
    else if (has('epik')) source = 'pinterest';
    else if (has('ttclid')) source = 'tiktok';
    else if (has('twclid')) source = 'x';
  }
  const googleClick = has('gclid') || has('gbraid') || has('wbraid');
  const paidClick = googleClick || has('rdt_cid') || has('epik') || has('ttclid') || has('twclid') || (has('fbclid') && !!utm.utm_medium && PAID_MEDIUM.test(utm.utm_medium));
  if (!medium && (googleClick || has('rdt_cid') || has('epik') || has('ttclid') || has('twclid'))) medium = googleClick ? 'cpc' : 'paid_social';

  if (source && AI_SOURCES.test(source)) {
    // ChatGPT Ads (tagged with a paid medium) vs answer-engine referrals.
    const m = medium ?? 'referral';
    if (PAID_MEDIUM.test(m) && /^(chatgpt|openai)/.test(source)) return { source: 'chatgpt', medium: m, campaign, content, term, channel: 'paid_search', platform: 'chatgpt' };
    return { source, medium: m, campaign, content, term, channel: 'referral', platform: 'ai' };
  }

  if (source) {
    const m = medium ?? 'referral';
    const isSocial = source in SOCIAL_PLATFORMS || ['facebook', 'instagram', 'reddit', 'pinterest', 'tiktok', 'linkedin', 'x', 'twitter', 'youtube', 'threads'].includes(source);
    const isPaid = PAID_MEDIUM.test(m) || paidClick;
    let channel: Channel;
    if (m === 'email' || m === 'newsletter') channel = 'email';
    else if (m === 'affiliate') channel = 'affiliate';
    else if (isPaid && isSocial) channel = 'paid_social';
    else if (isPaid && (m === 'display' || m === 'banner' || m === 'cpm')) channel = 'display';
    else if (isPaid) channel = 'paid_search';
    else if (m === 'organic' && !isSocial) channel = 'organic_search';
    else if (isSocial) channel = 'organic_social';
    else if (m === 'referral') channel = 'referral';
    else channel = 'other';

    const finalMedium = channel === 'paid_social' ? 'paid_social' : m;
    let platform: Platform;
    if (channel === 'paid_social') platform = SOCIAL_PLATFORMS[source] ?? 'other';
    else if ((channel === 'paid_search' || channel === 'display') && source === 'google') platform = 'google';
    else if (channel === 'organic_search' || channel === 'organic_social') platform = 'organic';
    else if (channel === 'referral') platform = 'referral';
    else platform = 'other';
    return { source, medium: finalMedium, campaign, content, term, channel, platform };
  }

  if (host) {
    if (AI_HOSTS.test(host)) return { source: host, medium: 'referral', campaign, content, term, channel: 'referral', platform: 'ai' };
    if (SEARCH_HOSTS.test(host)) return { source: host.split('.').slice(-2, -1)[0] || host, medium: 'organic', campaign, content, term, channel: 'organic_search', platform: 'organic' };
    const social = socialSourceFromHost(host);
    if (social) return { source: social, medium: 'social', campaign, content, term, channel: 'organic_social', platform: 'organic' };
    return { source: host, medium: 'referral', campaign, content, term, channel: 'referral', platform: 'referral' };
  }
  return { source: '(direct)', medium: '(none)', campaign: null, content: null, term: null, channel: 'direct', platform: 'direct' };
}

// ---------------------------------------------------------------------------
// Attribution models
// ---------------------------------------------------------------------------

export interface TouchRecord {
  at: string; // ISO time the session started
  source: string;
  medium: string;
  campaign: string | null;
  content: string | null;
  term: string | null;
  channel: Channel | string;
  platform: Platform | string;
  landingPath: string | null;
  clickIdTypes: string[];
}

export function isDirect(touch: Pick<TouchRecord, 'channel'>): boolean {
  return touch.channel === 'direct';
}

/**
 * Picks the three touches from a visitor's sessions (any order). `window`
 * bounds Last Non-Direct: a non-direct touch older than the window no longer
 * counts and the conversion touch is used instead.
 */
export function attributeTouches(
  sessions: TouchRecord[],
  conversion: TouchRecord,
  now: Date,
  windowDays = DEFAULT_ATTRIBUTION_WINDOW_DAYS
): { firstTouch: TouchRecord; lastNonDirect: TouchRecord; conversionTouch: TouchRecord } {
  const all = [...sessions];
  if (!all.some((s) => s.at === conversion.at && s.source === conversion.source)) all.push(conversion);
  const sorted = all.filter((s) => Date.parse(s.at) <= now.getTime()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const firstTouch = sorted[0] ?? conversion;
  const since = now.getTime() - windowDays * 86_400_000;
  const candidates = sorted.filter((s) => !isDirect(s) && Date.parse(s.at) >= since);
  const lastNonDirect = candidates[candidates.length - 1] ?? conversion;
  return { firstTouch, lastNonDirect, conversionTouch: conversion };
}

/** Device category from a User-Agent (only the category is ever stored). */
export function deviceCategory(ua: string | null | undefined): 'desktop' | 'mobile' | 'tablet' | 'other' {
  if (!ua) return 'other';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry/i.test(ua)) return 'mobile';
  if (/Windows|Macintosh|X11|Linux|CrOS/i.test(ua)) return 'desktop';
  return 'other';
}

const BOT_UA = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegrambot|discordbot|preview|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|monitor|vercel|curl|wget|python-requests|axios|node-fetch|go-http-client|java\/|okhttp|postman|insomnia|stripe/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || ua.length < 20) return true;
  return BOT_UA.test(ua);
}
