import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rowsOf, type Executor } from '@/lib/db/types';
import { attributeTouches, classifyTouch, deviceCategory, SESSION_TIMEOUT_MINUTES, type ClickIdKey, type TouchRecord } from '../attribution';
import { EVENT_VERSION, type ServerEventName } from '../catalog';
import type { ConsentState } from '../consent';
import type { CleanTouch, ValidEvent } from '../validation';
import { attributionWindowDays } from './config';
import { decryptJson, encryptJson, hashKey, randomToken } from './crypto';

/**
 * First-party analytics storage: visitors, sessions, events and attribution
 * snapshots, all in the application's own Postgres (the source of truth).
 *
 * Visitor / session identifiers are random cookie values set only after
 * Analytics consent; the database stores their HMAC hashes. A session ends
 * after 30 minutes without activity, or when a visit arrives with new
 * campaign parameters or a new ad click.
 */

export const VISITOR_COOKIE = 'zayro_vid';
export const SESSION_COOKIE = 'zayro_sid';
/** 13 months, matching raw-event retention. */
export const VISITOR_MAX_AGE_SECONDS = 395 * 24 * 60 * 60;
export const SESSION_MAX_AGE_SECONDS = SESSION_TIMEOUT_MINUTES * 60;

const COOKIE_VALUE = /^[A-Za-z0-9_-]{20,64}$/;
export const validCookieValue = (v: string | null | undefined): v is string => !!v && COOKIE_VALUE.test(v);

export interface Visit {
  visitorId: string;
  sessionId: string;
  /** New cookie values to set on the response (only when they changed). */
  setVisitorCookie?: string;
  setSessionCookie?: string;
  isNewSession: boolean;
}

interface SessionRow {
  id: string;
  visitor_id: string;
  last_ms: number | string;
  session_source: string | null;
  session_medium: string | null;
  session_campaign: string | null;
  click_id_types: string | null;
  vendor_ids_encrypted: string | null;
  click_ids_encrypted: string | null;
}

const num = (v: number | string | null | undefined) => Number(v ?? 0);

function touchStartsNewSession(existing: SessionRow, touch: CleanTouch | null, classified: ReturnType<typeof classifyTouch> | null): boolean {
  if (!touch || !classified) return false;
  const hasCampaign = Object.keys(touch.utm).length > 0 || Object.keys(touch.clickIds).length > 0;
  if (!hasCampaign) return false;
  const types = Object.keys(touch.clickIds).sort().join(',');
  return (
    classified.source !== existing.session_source ||
    classified.medium !== existing.session_medium ||
    (classified.campaign ?? null) !== (existing.session_campaign ?? null) ||
    (types !== '' && types !== (existing.click_id_types ?? ''))
  );
}

/**
 * Finds or creates the visitor and current session for a consented
 * browser. Returns null when Analytics consent is missing (cookieless).
 */
export async function resolveVisit(input: {
  consent: ConsentState | null;
  visitorCookie: string | null;
  sessionCookie: string | null;
  touch: CleanTouch | null;
  vendorIds: Record<string, string>;
  userAgent: string | null;
  path: string | null;
  now?: Date;
}): Promise<Visit | null> {
  const { consent } = input;
  if (!consent?.analytics) return null;
  const now = input.now ?? new Date();
  const ad = consent.advertising;
  const clickTypes = (ad ? Object.keys(input.touch?.clickIds ?? {}) : []) as ClickIdKey[];
  // Classification uses click-ID presence only transiently; raw IDs are kept only with Advertising consent.
  const classified = input.touch ? classifyTouch({ utm: input.touch.utm, clickIdTypes: Object.keys(input.touch.clickIds) as ClickIdKey[], referrerHost: input.touch.referrerHost }) : null;
  const clickEnc = ad && input.touch && Object.keys(input.touch.clickIds).length ? encryptJson(input.touch.clickIds as Record<string, string>) : null;
  const allowedVendor = Object.fromEntries(Object.entries(input.vendorIds).filter(([k]) => (k === 'ga' ? consent.analytics : ad)));

  // Visitor
  let visitorCookie = validCookieValue(input.visitorCookie) ? input.visitorCookie : null;
  let setVisitorCookie: string | undefined;
  let visitorId: string | null = null;
  let returning = false;
  if (visitorCookie) {
    const found = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM analytics_visitors WHERE anonymous_id_hash = ${hashKey('vid', visitorCookie)} LIMIT 1`));
    visitorId = found[0]?.id ?? null;
    returning = !!visitorId;
  }
  if (!visitorId) {
    visitorCookie = visitorCookie ?? randomToken(24);
    setVisitorCookie = visitorCookie;
    const t = classified ?? classifyTouch({ utm: {}, clickIdTypes: [], referrerHost: null });
    const inserted = rowsOf<{ id: string }>(
      await db.execute(sql`
        INSERT INTO analytics_visitors (anonymous_id_hash, first_seen_at, last_seen_at, first_landing_path, first_referrer_host,
          first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content, first_utm_term, first_channel,
          first_click_id_types, first_click_ids_encrypted, consent_state)
        VALUES (${hashKey('vid', visitorCookie)}, ${now}, ${now}, ${input.touch?.landingPath ?? input.path}, ${input.touch?.referrerHost ?? null},
          ${t.source}, ${t.medium}, ${t.campaign}, ${t.content}, ${t.term}, ${t.channel},
          ${clickTypes.join(',') || null}, ${clickEnc}, ${ad ? 'advertising' : 'analytics'})
        ON CONFLICT (anonymous_id_hash) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
        RETURNING id`)
    );
    visitorId = inserted[0].id;
  } else {
    await db.execute(sql`UPDATE analytics_visitors SET last_seen_at = ${now}, consent_state = ${ad ? 'advertising' : 'analytics'}, updated_at = ${now} WHERE id = ${visitorId}`);
  }

  // Session
  let sessionCookie = validCookieValue(input.sessionCookie) ? input.sessionCookie : null;
  let existing: SessionRow | null = null;
  if (sessionCookie) {
    const rows = rowsOf<SessionRow>(
      await db.execute(sql`SELECT id, visitor_id, (extract(epoch FROM last_seen_at) * 1000)::float8 AS last_ms, session_source, session_medium, session_campaign, click_id_types, vendor_ids_encrypted, click_ids_encrypted
                             FROM analytics_sessions WHERE session_key_hash = ${hashKey('sid', sessionCookie)} LIMIT 1`)
    );
    existing = rows[0] ?? null;
    const stale = existing ? now.getTime() - num(existing.last_ms) > SESSION_TIMEOUT_MINUTES * 60_000 : true;
    if (existing && (existing.visitor_id !== visitorId || stale || touchStartsNewSession(existing, input.touch, classified))) existing = null;
  }

  if (existing) {
    const vendor = { ...decryptJson(existing.vendor_ids_encrypted), ...allowedVendor };
    const clicks = clickEnc ? { ...decryptJson(existing.click_ids_encrypted), ...(input.touch?.clickIds as Record<string, string>) } : null;
    await db.execute(sql`
      UPDATE analytics_sessions SET last_seen_at = ${now}, exit_path = coalesce(${input.path}, exit_path),
        consent_advertising = ${ad},
        vendor_ids_encrypted = ${Object.keys(allowedVendor).length ? encryptJson(vendor) : sql`vendor_ids_encrypted`},
        click_ids_encrypted = ${clicks ? encryptJson(clicks) : sql`click_ids_encrypted`},
        updated_at = ${now}
      WHERE id = ${existing.id}`);
    return { visitorId, sessionId: existing.id, setVisitorCookie, setSessionCookie: sessionCookie!, isNewSession: false };
  }

  sessionCookie = randomToken(24);
  const t = classified ?? classifyTouch({ utm: {}, clickIdTypes: [], referrerHost: null });
  const first = rowsOf<{ s: string | null; m: string | null; c: string | null }>(
    await db.execute(sql`SELECT first_utm_source AS s, first_utm_medium AS m, first_utm_campaign AS c FROM analytics_visitors WHERE id = ${visitorId}`)
  )[0];
  const created = rowsOf<{ id: string }>(
    await db.execute(sql`
      INSERT INTO analytics_sessions (session_key_hash, visitor_id, started_at, last_seen_at, landing_path, exit_path, referrer_host, device_category,
        first_touch_source, first_touch_medium, first_touch_campaign, session_source, session_medium, session_campaign, session_content, session_term,
        channel, platform, click_id_types, click_ids_encrypted, vendor_ids_encrypted, is_returning, consent_advertising)
      VALUES (${hashKey('sid', sessionCookie)}, ${visitorId}, ${now}, ${now}, ${input.touch?.landingPath ?? input.path}, ${input.path}, ${input.touch?.referrerHost ?? null},
        ${deviceCategory(input.userAgent)}, ${first?.s ?? t.source}, ${first?.m ?? t.medium}, ${first?.c ?? t.campaign},
        ${t.source}, ${t.medium}, ${t.campaign}, ${t.content}, ${t.term}, ${t.channel}, ${t.platform},
        ${clickTypes.join(',') || null}, ${clickEnc}, ${Object.keys(allowedVendor).length ? encryptJson(allowedVendor) : null}, ${returning}, ${ad})
      RETURNING id`)
  );
  return { visitorId, sessionId: created[0].id, setVisitorCookie, setSessionCookie: sessionCookie, isNewSession: true };
}

/** Stores validated browser events. Duplicate event IDs are ignored. Returns how many were new. */
export async function recordBrowserEvents(events: ValidEvent[], visit: Visit | null, consent: ConsentState | null): Promise<number> {
  let inserted = 0;
  for (const e of events) {
    const rows = rowsOf<{ id: string }>(
      await db.execute(sql`
        INSERT INTO analytics_events (external_event_id, visitor_id, session_id, event_name, event_version, source, occurred_at, page_path, properties, consent_analytics, consent_advertising)
        VALUES (${e.eventId}, ${visit?.visitorId ?? null}, ${visit?.sessionId ?? null}, ${e.name}, ${EVENT_VERSION}, 'browser', ${e.occurredAt}, ${e.path},
          ${JSON.stringify(e.properties)}::jsonb, ${!!consent?.analytics}, ${!!consent?.advertising})
        ON CONFLICT (external_event_id) DO NOTHING
        RETURNING id`)
    );
    if (rows.length) inserted++;
  }
  if (visit && inserted) {
    const pageViews = events.filter((e) => e.name === 'page_view').length;
    const engaged = events.some((e) => e.name === 'engaged');
    await db.execute(sql`
      UPDATE analytics_sessions SET page_view_count = page_view_count + ${pageViews},
        engaged = engaged OR ${engaged} OR (page_view_count + ${pageViews}) >= 2
      WHERE id = ${visit.sessionId}`);
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Server-side context and authoritative events
// ---------------------------------------------------------------------------

export interface ServerVisitContext {
  visitorId: string | null;
  sessionId: string | null;
  consent: { analytics: boolean; advertising: boolean };
}

/** The consented visit of the browser making this request (cookies only; nothing is created). */
export async function visitFromCookies(cookies: { get(name: string): { value: string } | undefined }, consent: ConsentState | null): Promise<ServerVisitContext> {
  const base: ServerVisitContext = { visitorId: null, sessionId: null, consent: { analytics: !!consent?.analytics, advertising: !!consent?.advertising } };
  if (!consent?.analytics) return base;
  const vid = cookies.get(VISITOR_COOKIE)?.value;
  if (!validCookieValue(vid)) return base;
  const visitor = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM analytics_visitors WHERE anonymous_id_hash = ${hashKey('vid', vid)} LIMIT 1`))[0];
  if (!visitor) return base;
  const sid = cookies.get(SESSION_COOKIE)?.value;
  let session = validCookieValue(sid)
    ? rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM analytics_sessions WHERE session_key_hash = ${hashKey('sid', sid)} AND visitor_id = ${visitor.id} LIMIT 1`))[0]
    : undefined;
  if (!session) session = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM analytics_sessions WHERE visitor_id = ${visitor.id} ORDER BY started_at DESC LIMIT 1`))[0];
  return { ...base, visitorId: visitor.id, sessionId: session?.id ?? null };
}

export interface ServerEventInput {
  name: ServerEventName;
  eventId: string;
  bookingId?: string | null;
  purchaseId?: string | null;
  visitorId?: string | null;
  sessionId?: string | null;
  valueCents?: number | null;
  currency?: string | null;
  pagePath?: string | null;
  properties?: Record<string, unknown>;
  consent: { analytics: boolean; advertising: boolean };
  occurredAt?: Date;
}

/** Inserts one authoritative event; a repeat of the same real-world action is a no-op. */
export async function insertServerEvent(input: ServerEventInput, exec: Executor = db): Promise<{ id: string; inserted: boolean }> {
  const rows = rowsOf<{ id: string }>(
    await exec.execute(sql`
      INSERT INTO analytics_events (external_event_id, visitor_id, session_id, booking_id, purchase_id, event_name, event_version, source, occurred_at, page_path,
        properties, value_cents, currency, consent_analytics, consent_advertising)
      VALUES (${input.eventId}, ${input.visitorId ?? null}, ${input.sessionId ?? null}, ${input.bookingId ?? null}, ${input.purchaseId ?? null}, ${input.name}, ${EVENT_VERSION},
        'server', ${input.occurredAt ?? new Date()}, ${input.pagePath ?? null}, ${JSON.stringify(input.properties ?? {})}::jsonb, ${input.valueCents ?? null},
        ${input.currency ?? null}, ${input.consent.analytics}, ${input.consent.advertising})
      ON CONFLICT (external_event_id) DO NOTHING
      RETURNING id`)
  );
  if (rows.length) {
    if (input.sessionId) await exec.execute(sql`UPDATE analytics_sessions SET converted = true WHERE id = ${input.sessionId} AND ${['checkout_created', 'purchase_confirmed', 'tour_confirmed', 'contact_submitted'].includes(input.name)}`);
    return { id: rows[0].id, inserted: true };
  }
  const existing = rowsOf<{ id: string }>(await exec.execute(sql`SELECT id FROM analytics_events WHERE external_event_id = ${input.eventId}`));
  return { id: existing[0].id, inserted: false };
}

function touchOf(row: Record<string, any>): TouchRecord {
  const at = new Date(num(row.started_ms)).toISOString();
  return {
    at,
    source: row.session_source ?? '(direct)',
    medium: row.session_medium ?? '(none)',
    campaign: row.session_campaign ?? null,
    content: row.session_content ?? null,
    term: row.session_term ?? null,
    channel: row.channel ?? 'direct',
    platform: row.platform ?? 'direct',
    landingPath: row.landing_path ?? null,
    clickIdTypes: row.click_id_types ? String(row.click_id_types).split(',').filter(Boolean) : [],
  };
}

/**
 * Snapshots acquisition for a booking (once). Later visits, reschedules and
 * extensions never rewrite it. Click IDs and vendor IDs are copied
 * (encrypted) only with Advertising consent.
 */
export async function snapshotAttribution(
  input: { bookingId: string; purchaseId?: string | null; visit: ServerVisitContext; now?: Date },
  exec: Executor = db
): Promise<boolean> {
  const now = input.now ?? new Date();
  const { visit } = input;
  const windowDays = attributionWindowDays();
  let firstTouch: TouchRecord | null = null;
  let lastNonDirect: TouchRecord | null = null;
  let conversionTouch: TouchRecord | null = null;
  let clickEnc: string | null = null;
  let vendorEnc: string | null = null;

  if (visit.visitorId && visit.sessionId) {
    const sessions = rowsOf<Record<string, any>>(
      await exec.execute(sql`SELECT id, (extract(epoch FROM started_at) * 1000)::float8 AS started_ms, session_source, session_medium, session_campaign, session_content, session_term, channel, platform, landing_path, click_id_types,
                                     click_ids_encrypted, vendor_ids_encrypted
                                FROM analytics_sessions WHERE visitor_id = ${visit.visitorId} ORDER BY started_at ASC LIMIT 500`)
    );
    const current = sessions.find((s) => s.id === visit.sessionId) ?? sessions[sessions.length - 1];
    if (current) {
      const touches = sessions.map(touchOf);
      const picked = attributeTouches(touches, touchOf(current), now, windowDays);
      firstTouch = picked.firstTouch;
      lastNonDirect = picked.lastNonDirect;
      conversionTouch = picked.conversionTouch;
      if (visit.consent.advertising) {
        // Latest valid click per platform inside the window wins.
        const since = now.getTime() - windowDays * 86_400_000;
        const clicks: Record<string, string> = {};
        const vendor: Record<string, string> = {};
        for (const s of sessions) {
          if (num(s.started_ms) < since) continue;
          Object.assign(clicks, decryptJson(s.click_ids_encrypted));
          Object.assign(vendor, decryptJson(s.vendor_ids_encrypted));
        }
        clickEnc = encryptJson(clicks);
        vendorEnc = encryptJson(vendor);
      }
    }
  }

  const rows = rowsOf<{ id: string }>(
    await exec.execute(sql`
      INSERT INTO analytics_attributions (booking_id, purchase_id, visitor_id, session_id, first_touch, last_non_direct_touch, conversion_touch,
        click_ids_encrypted, vendor_ids_encrypted, consent_analytics, consent_advertising, attribution_window_days, attributed_at)
      VALUES (${input.bookingId}, ${input.purchaseId ?? null}, ${visit.visitorId}, ${visit.sessionId},
        ${firstTouch ? JSON.stringify(firstTouch) : null}::jsonb, ${lastNonDirect ? JSON.stringify(lastNonDirect) : null}::jsonb, ${conversionTouch ? JSON.stringify(conversionTouch) : null}::jsonb,
        ${clickEnc}, ${vendorEnc}, ${visit.consent.analytics}, ${visit.consent.advertising}, ${windowDays}, ${now})
      ON CONFLICT (booking_id) DO NOTHING
      RETURNING id`)
  );
  return rows.length > 0;
}

export interface AttributionRow {
  visitor_id: string | null;
  session_id: string | null;
  consent_analytics: boolean;
  consent_advertising: boolean;
  click_ids_encrypted: string | null;
  vendor_ids_encrypted: string | null;
  conversion_touch: TouchRecord | null;
}

export async function attributionForBooking(bookingId: string, exec: Executor = db): Promise<AttributionRow | null> {
  const rows = rowsOf<AttributionRow>(
    await exec.execute(sql`SELECT visitor_id, session_id, consent_analytics, consent_advertising, click_ids_encrypted, vendor_ids_encrypted, conversion_touch
                             FROM analytics_attributions WHERE booking_id = ${bookingId} LIMIT 1`)
  );
  return rows[0] ?? null;
}

/** Records a consent choice (proof of consent), keyed by the random consent ID's hash. */
export async function recordConsent(state: ConsentState, action: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO analytics_consents (consent_id_hash, consent_version, analytics, advertising, action)
    VALUES (${hashKey('consent', state.consentId)}, ${state.version}, ${state.analytics}, ${state.advertising}, ${action})`);
}

/**
 * Consent withdrawn or narrowed for this browser: the visitor is marked, and
 * every advertising delivery not yet sent for its events is skipped.
 */
export async function applyConsentToVisitor(visitorCookie: string | null | undefined, consent: { analytics: boolean; advertising: boolean }): Promise<void> {
  if (!validCookieValue(visitorCookie)) return;
  const visitor = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM analytics_visitors WHERE anonymous_id_hash = ${hashKey('vid', visitorCookie)} LIMIT 1`))[0];
  if (!visitor) return;
  const state = consent.advertising ? 'advertising' : consent.analytics ? 'analytics' : 'denied';
  await db.execute(sql`UPDATE analytics_visitors SET consent_state = ${state}, updated_at = now() WHERE id = ${visitor.id}`);
  if (!consent.advertising) {
    await db.execute(sql`
      UPDATE analytics_deliveries d SET status = 'skipped', last_error_sanitized = 'consent_withdrawn', updated_at = now()
        FROM analytics_events e
       WHERE d.analytics_event_id = e.id AND d.status IN ('pending', 'failed') AND d.destination <> 'ga4'
         AND (e.visitor_id = ${visitor.id} OR e.booking_id IN (SELECT booking_id FROM analytics_attributions WHERE visitor_id = ${visitor.id}))`);
    await db.execute(sql`UPDATE analytics_sessions SET consent_advertising = false, click_ids_encrypted = NULL, vendor_ids_encrypted = NULL WHERE visitor_id = ${visitor.id}`);
  }
  if (!consent.analytics) {
    await db.execute(sql`
      UPDATE analytics_deliveries d SET status = 'skipped', last_error_sanitized = 'consent_withdrawn', updated_at = now()
        FROM analytics_events e
       WHERE d.analytics_event_id = e.id AND d.status IN ('pending', 'failed') AND d.destination = 'ga4' AND e.visitor_id = ${visitor.id}`);
  }
}
