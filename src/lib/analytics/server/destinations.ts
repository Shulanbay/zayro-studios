import { createHmac, randomBytes } from 'crypto';
import { PLATFORM_EVENTS, type Destination, type ServerEventName } from '../catalog';
import { serverCredentials } from './config';
import type { TransportRequest } from './runtime';

/**
 * Server-side destination adapters. Each one turns an authoritative event
 * into the vendor's request, or says why it is skipped. Adapters never
 * receive customer contact data: advanced matching (hashed email / phone /
 * IP / User-Agent) is not implemented and stays disabled — only consented
 * click IDs and vendor browser IDs are used as match keys.
 *
 * Endpoints and versions (verify against current official docs before
 * enabling each platform; all are documented in docs/analytics.md):
 *   GA4      POST https://www.google-analytics.com/mp/collect (debug: /debug/mp/collect)
 *   Meta     POST https://graph.facebook.com/{META_GRAPH_API_VERSION, default v21.0}/{pixel}/events
 *   Reddit   POST https://ads-api.reddit.com/api/v3/pixels/{pixel}/conversion_events
 *   Pinterest POST https://api.pinterest.com/v5/ad_accounts/{id}/events
 *   TikTok   POST https://business-api.tiktok.com/open_api/v1.3/event/track/
 *   X        POST https://ads-api.x.com/{X_ADS_API_VERSION, default 12}/measurement/conversions/{pixel}
 *            (OAuth 1.0a user context; docs.x.com/x-ads-api/measurement/web-conversions)
 */

export interface DeliveryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  priceCents: number;
}

export interface DeliveryContext {
  destination: Destination;
  eventId: string;
  name: ServerEventName;
  occurredAt: Date;
  valueCents: number | null;
  taxCents: number | null;
  currency: string;
  items: DeliveryItem[];
  /** Public-safe transaction reference (the purchase event ID, never an order number or Stripe ID). */
  transactionId: string | null;
  pageUrl: string | null;
  clickIds: Record<string, string>;
  vendorIds: Record<string, string>;
  clickAt: Date | null;
}

export type Built = { request: TransportRequest; testMode: boolean } | { skip: string };

const dollars = (cents: number | null) => (cents === null ? undefined : Math.round(cents) / 100);
const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

function json(destination: Destination, url: string, body: unknown, headers: Record<string, string> = {}): TransportRequest {
  return { destination, url, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
}

function ga4(ctx: DeliveryContext): Built {
  const c = serverCredentials().ga4;
  if (!c.measurementId || !c.apiSecret) return { skip: 'not_configured' };
  const name = PLATFORM_EVENTS[ctx.name]?.ga4;
  if (!name) return { skip: 'no_mapping' };
  // GA "_ga" cookie: GA1.1.<random>.<timestamp> → client_id "<random>.<timestamp>"
  const raw = ctx.vendorIds.ga;
  const clientId = raw ? raw.split('.').slice(-2).join('.') : null;
  if (!clientId || !/^\d+\.\d+$/.test(clientId)) return { skip: 'no_client_id' };
  const params: Record<string, unknown> = { engagement_time_msec: 1 };
  if (ctx.valueCents !== null) {
    params.value = dollars(ctx.valueCents);
    params.currency = ctx.currency;
  }
  if (ctx.name === 'purchase_confirmed' || ctx.name === 'refund_succeeded' || ctx.name === 'extension_purchased') {
    params.transaction_id = ctx.transactionId ?? ctx.eventId;
    params.affiliation = 'ZAYRO Studios';
    if (ctx.taxCents !== null) params.tax = dollars(ctx.taxCents);
  }
  if (ctx.items.length) params.items = ctx.items.map((i) => ({ item_id: i.id, item_name: i.name, item_category: i.category, quantity: i.quantity, price: dollars(i.priceCents) }));
  const host = c.debug ? 'https://www.google-analytics.com/debug/mp/collect' : 'https://www.google-analytics.com/mp/collect';
  const url = `${host}?measurement_id=${encodeURIComponent(c.measurementId)}&api_secret=${encodeURIComponent(c.apiSecret)}`;
  return {
    request: json('ga4', url, {
      client_id: clientId,
      timestamp_micros: ctx.occurredAt.getTime() * 1000,
      // Advertising consent is not implied by analytics consent.
      consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
      events: [{ name, params }],
    }),
    testMode: c.debug,
  };
}

function meta(ctx: DeliveryContext): Built {
  const c = serverCredentials().meta;
  if (!c.pixelId || !c.token) return { skip: 'not_configured' };
  const name = PLATFORM_EVENTS[ctx.name]?.meta;
  if (!name) return { skip: 'no_mapping' };
  const fbc = ctx.vendorIds.fbc ?? (ctx.clickIds.fbclid ? `fb.1.${(ctx.clickAt ?? ctx.occurredAt).getTime()}.${ctx.clickIds.fbclid}` : undefined);
  const fbp = ctx.vendorIds.fbp;
  if (!fbc && !fbp) return { skip: 'no_match_keys' };
  const custom: Record<string, unknown> = {};
  if (ctx.valueCents !== null) {
    custom.value = dollars(ctx.valueCents);
    custom.currency = ctx.currency;
  }
  if (ctx.items.length) {
    custom.content_ids = ctx.items.map((i) => i.id);
    custom.content_type = 'product';
    custom.num_items = ctx.items.reduce((n, i) => n + i.quantity, 0);
  }
  if (ctx.transactionId && ctx.name === 'purchase_confirmed') custom.order_id = ctx.transactionId;
  const body: Record<string, unknown> = {
    data: [{ event_name: name, event_time: seconds(ctx.occurredAt), event_id: ctx.eventId, action_source: 'website', event_source_url: ctx.pageUrl ?? undefined, user_data: { fbc, fbp }, custom_data: custom }],
    access_token: c.token,
  };
  if (c.testEventCode) body.test_event_code = c.testEventCode;
  return { request: json('meta_capi', `https://graph.facebook.com/${encodeURIComponent(c.apiVersion)}/${encodeURIComponent(c.pixelId)}/events`, body), testMode: !!c.testEventCode };
}

function reddit(ctx: DeliveryContext): Built {
  const c = serverCredentials().reddit;
  if (!c.pixelId || !c.token) return { skip: 'not_configured' };
  const mapped = PLATFORM_EVENTS[ctx.name]?.reddit;
  if (!mapped) return { skip: 'no_mapping' };
  const clickId = ctx.clickIds.rdt_cid;
  const uuid = ctx.vendorIds.rdt;
  if (!clickId && !uuid) return { skip: 'no_match_keys' };
  const type = mapped.startsWith('Custom:') ? { tracking_type: 'Custom', custom_event_name: mapped.slice(7) } : { tracking_type: mapped };
  const metadata: Record<string, unknown> = { conversion_id: ctx.eventId };
  if (ctx.valueCents !== null) {
    metadata.value = dollars(ctx.valueCents);
    metadata.currency = ctx.currency;
  }
  if (ctx.items.length) {
    metadata.item_count = ctx.items.reduce((n, i) => n + i.quantity, 0);
    metadata.products = ctx.items.map((i) => ({ id: i.id, name: i.name, category: i.category }));
  }
  const event: Record<string, unknown> = { event_at: ctx.occurredAt.getTime(), action_source: 'WEBSITE', type, metadata, user: uuid ? { uuid } : {} };
  if (clickId) event.click_id = clickId;
  return {
    request: json('reddit_capi', `https://ads-api.reddit.com/api/v3/pixels/${encodeURIComponent(c.pixelId)}/conversion_events`, { data: { test_mode: c.testMode, events: [event] } }, { Authorization: `Bearer ${c.token}` }),
    testMode: c.testMode,
  };
}

function pinterest(ctx: DeliveryContext): Built {
  const c = serverCredentials().pinterest;
  if (!c.adAccountId || !c.token) return { skip: 'not_configured' };
  const mapped = PLATFORM_EVENTS[ctx.name]?.pinterest;
  if (!mapped) return { skip: 'no_mapping' };
  const epik = ctx.clickIds.epik ?? ctx.vendorIds.epik;
  if (!epik) return { skip: 'no_match_keys' };
  const eventName = mapped.startsWith('custom') ? 'custom' : mapped === 'pagevisit' ? 'page_visit' : mapped === 'viewcategory' ? 'view_category' : mapped;
  const custom: Record<string, unknown> = {};
  if (ctx.valueCents !== null) {
    custom.value = String(dollars(ctx.valueCents));
    custom.currency = ctx.currency;
  }
  if (ctx.items.length) {
    custom.content_ids = ctx.items.map((i) => i.id);
    custom.num_items = ctx.items.reduce((n, i) => n + i.quantity, 0);
  }
  if (ctx.transactionId && ctx.name === 'purchase_confirmed') custom.order_id = ctx.transactionId;
  const url = `https://api.pinterest.com/v5/ad_accounts/${encodeURIComponent(c.adAccountId)}/events${c.testMode ? '?test=true' : ''}`;
  return {
    request: json(
      'pinterest_capi',
      url,
      { data: [{ event_name: eventName, action_source: 'web', event_time: seconds(ctx.occurredAt), event_id: ctx.eventId, event_source_url: ctx.pageUrl ?? undefined, opt_out: false, user_data: { click_id: epik }, custom_data: custom }] },
      { Authorization: `Bearer ${c.token}` }
    ),
    testMode: c.testMode,
  };
}

function tiktok(ctx: DeliveryContext): Built {
  const c = serverCredentials().tiktok;
  if (!c.pixelCode || !c.token) return { skip: 'not_configured' };
  const name = PLATFORM_EVENTS[ctx.name]?.tiktok;
  if (!name) return { skip: 'no_mapping' };
  const ttclid = ctx.clickIds.ttclid;
  const ttp = ctx.vendorIds.ttp;
  if (!ttclid && !ttp) return { skip: 'no_match_keys' };
  const properties: Record<string, unknown> = {};
  if (ctx.valueCents !== null) {
    properties.value = dollars(ctx.valueCents);
    properties.currency = ctx.currency;
  }
  if (ctx.items.length) {
    properties.content_type = 'product';
    properties.contents = ctx.items.map((i) => ({ content_id: i.id, content_name: i.name, quantity: i.quantity, price: dollars(i.priceCents) }));
  }
  const body: Record<string, unknown> = {
    event_source: 'web',
    event_source_id: c.pixelCode,
    data: [{ event: name, event_time: seconds(ctx.occurredAt), event_id: ctx.eventId, user: { ttclid, ttp }, properties, page: ctx.pageUrl ? { url: ctx.pageUrl } : undefined }],
  };
  if (c.testEventCode) body.test_event_code = c.testEventCode;
  return { request: json('tiktok_events_api', 'https://business-api.tiktok.com/open_api/v1.3/event/track/', body, { 'Access-Token': c.token }), testMode: !!c.testEventCode };
}

/** RFC 3986 percent-encoding, as OAuth 1.0a requires. */
function pct(v: string): string {
  return encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * OAuth 1.0a (HMAC-SHA1) Authorization header for a JSON POST. A JSON body
 * is not part of the signature base string; only the oauth_* parameters
 * (and query parameters, none here) are.
 */
export function oauth1Header(
  url: string,
  creds: { consumerKey: string; consumerSecret: string; accessToken: string; accessTokenSecret: string },
  nonce = randomBytes(16).toString('hex'),
  timestamp = Math.floor(Date.now() / 1000).toString()
): string {
  const params: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${pct(k)}=${pct(params[k])}`)
    .join('&');
  const base = ['POST', pct(url), pct(paramString)].join('&');
  const signature = createHmac('sha1', `${pct(creds.consumerSecret)}&${pct(creds.accessTokenSecret)}`).update(base).digest('base64');
  return (
    'OAuth ' +
    Object.entries({ ...params, oauth_signature: signature })
      .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
      .join(', ')
  );
}

function x(ctx: DeliveryContext): Built {
  const c = serverCredentials().x;
  if (!c.pixelId || !c.consumerKey || !c.consumerSecret || !c.accessToken || !c.accessTokenSecret) return { skip: 'not_configured' };
  const key = PLATFORM_EVENTS[ctx.name]?.x;
  const eventId = key ? c.eventIds[key] : undefined;
  if (!key || !eventId) return { skip: 'no_mapping' };
  // Match key: the consented X click ID only (no hashed email / phone — advanced matching stays off).
  const twclid = ctx.clickIds.twclid;
  if (!twclid) return { skip: 'no_match_keys' };
  const conversion: Record<string, unknown> = {
    conversion_time: ctx.occurredAt.toISOString(),
    event_id: eventId,
    identifiers: [{ twclid }],
    // Same key as the pixel's conversion_id, so X deduplicates browser + server.
    conversion_id: ctx.eventId,
  };
  if (ctx.valueCents !== null) {
    conversion.value = (Math.round(ctx.valueCents) / 100).toFixed(2);
    conversion.price_currency = ctx.currency;
  }
  if (ctx.items.length) {
    conversion.number_items = ctx.items.reduce((n, i) => n + i.quantity, 0);
    conversion.contents = ctx.items.map((i) => ({ content_id: i.id, content_name: i.name, content_type: i.category, content_price: dollars(i.priceCents), num_items: i.quantity }));
  }
  const url = `https://ads-api.x.com/${encodeURIComponent(c.apiVersion)}/measurement/conversions/${encodeURIComponent(c.pixelId)}`;
  return { request: json('x_capi', url, { conversions: [conversion] }, { Authorization: oauth1Header(url, c) }), testMode: false };
}

export const SERVER_ADAPTERS: Partial<Record<Destination, (ctx: DeliveryContext) => Built>> = {
  ga4,
  meta_capi: meta,
  reddit_capi: reddit,
  pinterest_capi: pinterest,
  tiktok_events_api: tiktok,
  x_capi: x,
};

/** Error text safe to store: no tokens, secrets, emails or long payloads. */
export function sanitizeError(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/OAuth\s+[^\n]+/gi, 'OAuth [redacted]')
    .replace(/(access_token|api_secret|token|secret)\s*[=:]\s*["']?[^\s"'&,}]+/gi, '$1=[redacted]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}
