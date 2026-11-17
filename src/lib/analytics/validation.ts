/**
 * Validation of what the browser may send to /api/analytics/collect.
 * Pure. Strict allowlists everywhere: unknown events are rejected (that
 * includes every authoritative conversion — purchase, refund, confirmed
 * booking, confirmed extension are server-only), unknown properties are
 * rejected, strings are bounded, paths must be trackable, timestamps must be
 * recent, and anything that looks like an email address or phone number is
 * refused.
 */
import { z } from 'zod';
import { BROWSER_PROPERTIES, BROWSER_DESTINATIONS, isBrowserEvent, isServerEvent, type BrowserEventName, type Destination } from './catalog';
import { CLICK_ID_KEYS, cleanClickId, cleanUtm, isTrackablePath, looksLikePii, referrerHost, sanitizePath, UTM_KEYS, type CampaignParams, type ClickIds } from './attribution';

export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_EVENTS_PER_BATCH = 20;
/** Browser clocks drift; events older than this or in the future are refused. */
export const TIMESTAMP_PAST_TOLERANCE_MS = 24 * 60 * 60 * 1000;
export const TIMESTAMP_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

const rawEvent = z
  .object({
    name: z.string().max(60),
    eventId: uuid,
    occurredAt: z.number().int().positive(),
    path: z.string().max(400),
    properties: z.record(z.unknown()).optional(),
  })
  .strict();

const rawTouch = z
  .object({
    utm: z.record(z.string().max(400)).optional(),
    clickIds: z.record(z.string().max(600)).optional(),
    landingPath: z.string().max(400).nullable().optional(),
    referrer: z.string().max(2000).nullable().optional(),
  })
  .strict();

const rawVendorIds = z
  .object({
    ga: z.string().max(100).optional(),
    fbp: z.string().max(100).optional(),
    fbc: z.string().max(600).optional(),
    ttp: z.string().max(100).optional(),
    epik: z.string().max(300).optional(),
    rdt: z.string().max(100).optional(),
  })
  .strict();

export const collectBodySchema = z
  .object({
    events: z.array(rawEvent).max(MAX_EVENTS_PER_BATCH).default([]),
    touch: rawTouch.optional(),
    vendorIds: rawVendorIds.optional(),
    /** Pixels the browser fired for a server-authoritative conversion (same event ID). */
    dispatch: z.object({ eventId: uuid, destinations: z.array(z.string().max(30)).max(10) }).strict().optional(),
    /** navigator.webdriver — automated browsers are not analytics. */
    automated: z.boolean().optional(),
  })
  .strict();

export type CollectBody = z.infer<typeof collectBodySchema>;

export interface ValidEvent {
  name: BrowserEventName;
  eventId: string;
  occurredAt: Date;
  path: string;
  properties: Record<string, unknown>;
}

export type EventVerdict = { ok: true; event: ValidEvent } | { ok: false; reason: string };

function containsPii(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (typeof value === 'string') return looksLikePii(value);
  if (Array.isArray(value)) return value.some((v) => containsPii(v, depth + 1));
  if (value && typeof value === 'object') return Object.entries(value).some(([k, v]) => looksLikePii(k) || containsPii(v, depth + 1));
  return false;
}

export function validateEvent(raw: z.infer<typeof rawEvent>, now = Date.now()): EventVerdict {
  if (isServerEvent(raw.name) || ['purchase', 'refund', 'booking_confirmed', 'booking_extended'].includes(raw.name)) {
    return { ok: false, reason: 'server_only_event' };
  }
  if (!isBrowserEvent(raw.name)) return { ok: false, reason: 'unknown_event' };
  if (raw.occurredAt < now - TIMESTAMP_PAST_TOLERANCE_MS || raw.occurredAt > now + TIMESTAMP_FUTURE_TOLERANCE_MS) return { ok: false, reason: 'timestamp_out_of_range' };
  const path = sanitizePath(raw.path);
  if (!path || !isTrackablePath(path)) return { ok: false, reason: 'path_not_allowed' };
  const props = raw.properties ?? {};
  if (containsPii(props)) return { ok: false, reason: 'pii_detected' };
  const parsed = BROWSER_PROPERTIES[raw.name].safeParse(props);
  if (!parsed.success) return { ok: false, reason: 'invalid_properties' };
  return { ok: true, event: { name: raw.name, eventId: raw.eventId.toLowerCase(), occurredAt: new Date(raw.occurredAt), path, properties: parsed.data as Record<string, unknown> } };
}

export interface CleanTouch {
  utm: CampaignParams;
  clickIds: ClickIds;
  landingPath: string | null;
  referrerHost: string | null;
}

export function cleanTouch(raw: CollectBody['touch'], ownHost: string | null): CleanTouch | null {
  if (!raw) return null;
  const utm: CampaignParams = {};
  for (const k of UTM_KEYS) {
    const v = cleanUtm(raw.utm?.[k]);
    if (v) utm[k] = v;
  }
  const clickIds: ClickIds = {};
  for (const k of CLICK_ID_KEYS) {
    const v = cleanClickId(k, raw.clickIds?.[k]);
    if (v) clickIds[k] = v;
  }
  const landing = sanitizePath(raw.landingPath ?? null);
  return { utm, clickIds, landingPath: landing && isTrackablePath(landing) ? landing : null, referrerHost: referrerHost(raw.referrer ?? null, ownHost) };
}

const VENDOR_ID_RE = /^[A-Za-z0-9._~-]{1,600}$/;

export function cleanVendorIds(raw: CollectBody['vendorIds']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && VENDOR_ID_RE.test(v)) out[k] = v;
  return out;
}

export function cleanDispatchDestinations(list: string[]): Destination[] {
  return Array.from(new Set(list.filter((d): d is Destination => (BROWSER_DESTINATIONS as string[]).includes(d))));
}
