import { X_EVENT_KEYS, type Destination, type XEventKey } from '../catalog';
import { DEFAULT_ATTRIBUTION_WINDOW_DAYS } from '../attribution';
import { vendorsAllowedOverride } from './runtime';

/**
 * Analytics configuration from environment variables. Every destination is
 * optional: missing configuration disables it, the site and booking work
 * the same. Nothing here ever returns a secret value — only whether it is
 * set. Public IDs (GTM container, GA4 measurement ID, pixel IDs, Google Ads
 * conversion ID/labels) are meant for the browser and are passed to it via
 * publicAnalyticsConfig().
 *
 * Vendor delivery (browser tags and server APIs) runs only on the
 * production deployment (VERCEL_ENV=production) unless
 * ANALYTICS_ALLOW_NON_PRODUCTION=1 is set for a test property, so preview,
 * local and automated-test traffic never reaches production datasets.
 */

const env = (name: string): string => (process.env[name] ?? '').trim();
const isSet = (name: string) => env(name).length > 0;
const flag = (name: string) => ['1', 'true', 'yes'].includes(env(name).toLowerCase());

const PUBLIC_ID = /^[A-Za-z0-9_-]{2,64}$/;
const publicId = (...names: string[]): string | null => {
  for (const n of names) {
    const v = env(n);
    if (v && PUBLIC_ID.test(v)) return v;
  }
  return null;
};

/**
 * Master switch for every external destination (browser tags and server
 * APIs). Off unless ANALYTICS_VENDORS_ENABLED=1 is set by the owner, so a
 * deploy never starts sending real events by itself — even when vendor IDs
 * are already present in the environment. First-party analytics, the
 * consent banner and the dashboard work regardless.
 */
export function vendorsAllowed(): boolean {
  const override = vendorsAllowedOverride();
  if (override !== null) return override;
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return false;
  if (!vendorSwitchOn()) return false;
  return env('VERCEL_ENV') === 'production' || flag('ANALYTICS_ALLOW_NON_PRODUCTION');
}

/**
 * ANALYTICS_VENDORS_ENABLED, parsed strictly: only "1" or "true" (any case)
 * turn it on. Missing, empty, "0", "false", "no" or anything else is off.
 */
export function parseVendorSwitch(raw: string | undefined | null): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

export function vendorSwitchOn(): boolean {
  return parseVendorSwitch(process.env.ANALYTICS_VENDORS_ENABLED);
}

/** Owner-only status (Admin → Integrations): the switch, where it is effective, and the analytics secrets — booleans only. */
export function analyticsOperationalStatus() {
  return {
    vendorSwitch: vendorSwitchOn(),
    activeInThisEnvironment: vendorsAllowed(),
    environment: env('VERCEL_ENV') || 'local',
    encryptionSecretConfigured: env('ANALYTICS_ENCRYPTION_SECRET').length >= 32,
    cronSecretConfigured: env('CRON_SECRET').length >= 16,
  };
}

export function attributionWindowDays(): number {
  const n = parseInt(env('ANALYTICS_ATTRIBUTION_WINDOW_DAYS'), 10);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_ATTRIBUTION_WINDOW_DAYS;
}

export interface PublicAnalyticsConfig {
  vendorsEnabled: boolean;
  gtmId: string | null;
  ga4Id: string | null;
  /** GA4 receives conversions server-side (Measurement Protocol); the browser then skips GA4 conversion events. */
  ga4ServerSide: boolean;
  googleAds: { id: string; labels: { booking?: string; tour?: string; contact?: string } } | null;
  metaPixelId: string | null;
  redditPixelId: string | null;
  pinterestTagId: string | null;
  tiktokPixelId: string | null;
  /** X Pixel ID and the Events Manager event IDs (tw-xxxxx-yyyyy) per event key. */
  xPixelId: string | null;
  xEventIds: Partial<Record<XEventKey, string>>;
}

export function publicAnalyticsConfig(): PublicAnalyticsConfig {
  const vendorsEnabled = vendorsAllowed();
  const adsId = publicId('GOOGLE_ADS_CONVERSION_ID', 'NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID');
  const ga4Id = publicId('NEXT_PUBLIC_GA4_MEASUREMENT_ID', 'NEXT_PUBLIC_GOOGLE_ANALYTICS_ID');
  return {
    vendorsEnabled,
    gtmId: vendorsEnabled ? publicId('NEXT_PUBLIC_GTM_CONTAINER_ID') : null,
    ga4Id: vendorsEnabled ? ga4Id : null,
    ga4ServerSide: vendorsEnabled && !!ga4Id && isSet('GA4_API_SECRET'),
    googleAds:
      vendorsEnabled && adsId
        ? {
            id: adsId.startsWith('AW-') ? adsId : `AW-${adsId}`,
            labels: {
              booking: publicId('GOOGLE_ADS_BOOKING_CONVERSION_LABEL') ?? undefined,
              tour: publicId('GOOGLE_ADS_TOUR_CONVERSION_LABEL') ?? undefined,
              contact: publicId('GOOGLE_ADS_CONTACT_CONVERSION_LABEL') ?? undefined,
            },
          }
        : null,
    metaPixelId: vendorsEnabled ? publicId('NEXT_PUBLIC_META_PIXEL_ID') : null,
    redditPixelId: vendorsEnabled ? publicId('NEXT_PUBLIC_REDDIT_PIXEL_ID') : null,
    pinterestTagId: vendorsEnabled ? publicId('NEXT_PUBLIC_PINTEREST_TAG_ID') : null,
    tiktokPixelId: vendorsEnabled ? publicId('NEXT_PUBLIC_TIKTOK_PIXEL_ID') : null,
    xPixelId: vendorsEnabled ? publicId('NEXT_PUBLIC_X_PIXEL_ID') : null,
    xEventIds: vendorsEnabled ? xEventIds() : {},
  };
}

/** X event IDs from X_EVENT_ID_<KEY> (e.g. X_EVENT_ID_PURCHASE=tw-abc12-def34). */
export function xEventIds(): Partial<Record<XEventKey, string>> {
  const out: Partial<Record<XEventKey, string>> = {};
  for (const k of X_EVENT_KEYS) {
    const v = env(`X_EVENT_ID_${k.toUpperCase()}`);
    if (/^tw-[A-Za-z0-9]{2,20}-[A-Za-z0-9]{2,20}$/.test(v)) out[k] = v;
  }
  return out;
}

export interface DestinationStatus {
  destination: Destination;
  label: string;
  channel: 'browser' | 'server';
  configured: boolean;
  /** Names of the variables still missing (owner view only; never values). */
  missing: string[];
  testMode: boolean;
  advancedMatching: false;
}

const DEST_INFO: Record<Destination, { label: string; channel: 'browser' | 'server'; required: string[][]; test?: string }> = {
  ga4: { label: 'GA4 (Measurement Protocol)', channel: 'server', required: [['NEXT_PUBLIC_GA4_MEASUREMENT_ID', 'NEXT_PUBLIC_GOOGLE_ANALYTICS_ID'], ['GA4_API_SECRET']], test: 'GA4_DEBUG' },
  google_ads: { label: 'Google Ads conversions (browser tag)', channel: 'browser', required: [['GOOGLE_ADS_CONVERSION_ID', 'NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID'], ['GOOGLE_ADS_BOOKING_CONVERSION_LABEL']] },
  meta_pixel: { label: 'Meta Pixel', channel: 'browser', required: [['NEXT_PUBLIC_META_PIXEL_ID']] },
  meta_capi: { label: 'Meta Conversions API', channel: 'server', required: [['NEXT_PUBLIC_META_PIXEL_ID'], ['META_CONVERSIONS_API_TOKEN']], test: 'META_TEST_EVENT_CODE' },
  reddit_pixel: { label: 'Reddit Pixel', channel: 'browser', required: [['NEXT_PUBLIC_REDDIT_PIXEL_ID']] },
  reddit_capi: { label: 'Reddit Conversions API', channel: 'server', required: [['REDDIT_PIXEL_ID', 'NEXT_PUBLIC_REDDIT_PIXEL_ID'], ['REDDIT_CONVERSIONS_ACCESS_TOKEN']], test: 'REDDIT_TEST_MODE' },
  pinterest_tag: { label: 'Pinterest Tag', channel: 'browser', required: [['NEXT_PUBLIC_PINTEREST_TAG_ID']] },
  pinterest_capi: { label: 'Pinterest Conversions API', channel: 'server', required: [['PINTEREST_AD_ACCOUNT_ID'], ['PINTEREST_CONVERSIONS_ACCESS_TOKEN']], test: 'PINTEREST_TEST_MODE' },
  tiktok_pixel: { label: 'TikTok Pixel', channel: 'browser', required: [['NEXT_PUBLIC_TIKTOK_PIXEL_ID']] },
  tiktok_events_api: { label: 'TikTok Events API', channel: 'server', required: [['TIKTOK_PIXEL_CODE', 'NEXT_PUBLIC_TIKTOK_PIXEL_ID'], ['TIKTOK_EVENTS_ACCESS_TOKEN']], test: 'TIKTOK_TEST_EVENT_CODE' },
  x_pixel: { label: 'X (Twitter) Pixel', channel: 'browser', required: [['NEXT_PUBLIC_X_PIXEL_ID'], ['X_EVENT_ID_PURCHASE']] },
  x_capi: {
    label: 'X Conversion API',
    channel: 'server',
    required: [['NEXT_PUBLIC_X_PIXEL_ID'], ['X_EVENT_ID_PURCHASE'], ['X_ADS_CONSUMER_KEY'], ['X_ADS_CONSUMER_SECRET'], ['X_ADS_ACCESS_TOKEN'], ['X_ADS_ACCESS_TOKEN_SECRET']],
  },
};

export function destinationStatus(destination: Destination): DestinationStatus {
  const info = DEST_INFO[destination];
  const missing = info.required.filter((alts) => !alts.some(isSet)).map((alts) => alts[0]);
  const testMode = info.test ? (destination === 'reddit_capi' || destination === 'pinterest_capi' || destination === 'ga4' ? flag(info.test) : isSet(info.test)) : false;
  return { destination, label: info.label, channel: info.channel, configured: missing.length === 0, missing, testMode, advancedMatching: false };
}

/** A server destination is active only when configured, allowed in this environment and transport is available. */
export function serverDestinationActive(destination: Destination): boolean {
  return DEST_INFO[destination].channel === 'server' && destinationStatus(destination).configured && vendorsAllowed();
}

export function allDestinationStatuses(): DestinationStatus[] {
  return (Object.keys(DEST_INFO) as Destination[]).map(destinationStatus);
}

/** Server-side values for adapters. Only adapters call this; never serialise its result. */
export function serverCredentials() {
  return {
    ga4: { measurementId: publicId('NEXT_PUBLIC_GA4_MEASUREMENT_ID', 'NEXT_PUBLIC_GOOGLE_ANALYTICS_ID'), apiSecret: env('GA4_API_SECRET'), debug: flag('GA4_DEBUG') },
    meta: { pixelId: publicId('NEXT_PUBLIC_META_PIXEL_ID'), token: env('META_CONVERSIONS_API_TOKEN'), testEventCode: env('META_TEST_EVENT_CODE') || null, apiVersion: env('META_GRAPH_API_VERSION') || 'v21.0' },
    reddit: { pixelId: publicId('REDDIT_PIXEL_ID', 'NEXT_PUBLIC_REDDIT_PIXEL_ID'), token: env('REDDIT_CONVERSIONS_ACCESS_TOKEN'), testMode: flag('REDDIT_TEST_MODE') },
    pinterest: { adAccountId: publicId('PINTEREST_AD_ACCOUNT_ID'), token: env('PINTEREST_CONVERSIONS_ACCESS_TOKEN'), testMode: flag('PINTEREST_TEST_MODE') },
    tiktok: { pixelCode: publicId('TIKTOK_PIXEL_CODE', 'NEXT_PUBLIC_TIKTOK_PIXEL_ID'), token: env('TIKTOK_EVENTS_ACCESS_TOKEN'), testEventCode: env('TIKTOK_TEST_EVENT_CODE') || null },
    x: {
      pixelId: publicId('NEXT_PUBLIC_X_PIXEL_ID'),
      eventIds: xEventIds(),
      consumerKey: env('X_ADS_CONSUMER_KEY'),
      consumerSecret: env('X_ADS_CONSUMER_SECRET'),
      accessToken: env('X_ADS_ACCESS_TOKEN'),
      accessTokenSecret: env('X_ADS_ACCESS_TOKEN_SECRET'),
      apiVersion: env('X_ADS_API_VERSION') || '12',
    },
  };
}

/** Comma-separated IPs excluded as internal traffic (compared server-side, never stored). */
export function isInternalIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const list = env('ANALYTICS_EXCLUDED_IPS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(ip.trim());
}

export const RETENTION = {
  rawEventsMonths: () => clampInt(env('ANALYTICS_RETENTION_EVENTS_MONTHS'), 13, 1, 60),
  sessionsMonths: () => clampInt(env('ANALYTICS_RETENTION_SESSIONS_MONTHS'), 25, 1, 120),
  failedDeliveriesDays: () => clampInt(env('ANALYTICS_RETENTION_FAILED_DELIVERY_DAYS'), 90, 1, 3650),
  consentRecordsMonths: () => clampInt(env('ANALYTICS_RETENTION_CONSENT_MONTHS'), 25, 1, 120),
};

function clampInt(raw: string, fallback: number, min: number, max: number): number {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
