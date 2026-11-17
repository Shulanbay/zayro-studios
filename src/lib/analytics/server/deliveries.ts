import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rowsOf } from '@/lib/db/types';
import { DESTINATION_CONSENT, SERVER_DELIVERED, type Destination, type ServerEventName } from '../catalog';
import { sanitizePageUrl } from '../attribution';
import { serverDestinationActive, vendorsAllowed } from './config';
import { decryptJson } from './crypto';
import { SERVER_ADAPTERS, sanitizeError, type DeliveryContext, type DeliveryItem } from './destinations';
import { getTransport } from './runtime';

/**
 * Delivery of authoritative events to external destinations.
 *
 *  - Queued after the business transaction commits; one row per
 *    (event, destination) — the unique pair makes a duplicate webhook or a
 *    second enqueue a no-op.
 *  - Retries reuse the same external event ID (never a new one).
 *  - Exponential backoff: 1 min, 5 min, 30 min, 2 h, 12 h; after 6 failed
 *    attempts the delivery is "dead" and shown in delivery health.
 *  - A delivery failure is recorded (sanitised) and never throws into the
 *    booking, payment, webhook, email, Calendar or Sheets code.
 *  - Consent is re-checked at send time; withdrawn consent skips the send.
 */

export const MAX_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 30, 120, 720];

export function nextRetryDelayMinutes(attempts: number): number {
  return BACKOFF_MINUTES[Math.min(Math.max(attempts - 1, 0), BACKOFF_MINUTES.length - 1)];
}

/** Queues the server destinations that apply to an event. Returns the destinations queued or skipped. */
export async function enqueueDeliveries(eventRowId: string): Promise<{ queued: Destination[]; skipped: Destination[] }> {
  const event = rowsOf<{ id: string; external_event_id: string; event_name: ServerEventName; consent_analytics: boolean; consent_advertising: boolean }>(
    await db.execute(sql`SELECT id, external_event_id, event_name, consent_analytics, consent_advertising FROM analytics_events WHERE id = ${eventRowId}`)
  )[0];
  const queued: Destination[] = [];
  const skipped: Destination[] = [];
  if (!event) return { queued, skipped };
  for (const destination of SERVER_DELIVERED[event.event_name] ?? []) {
    if (!serverDestinationActive(destination)) continue; // not configured / not production: no row at all
    const needs = DESTINATION_CONSENT[destination];
    const consented = needs === 'analytics' ? event.consent_analytics : event.consent_advertising;
    const status = consented ? 'pending' : 'skipped';
    await db.execute(sql`
      INSERT INTO analytics_deliveries (analytics_event_id, destination, channel, external_event_id, status, last_error_sanitized)
      VALUES (${event.id}, ${destination}, 'server', ${event.external_event_id}, ${status}, ${consented ? null : 'no_consent'})
      ON CONFLICT (analytics_event_id, destination) DO NOTHING`);
    (consented ? queued : skipped).push(destination);
  }
  return { queued, skipped };
}

/** Browser pixels report that they fired a server conversion with the same event ID. */
export async function recordBrowserDispatch(externalEventId: string, destinations: Destination[]): Promise<number> {
  if (!destinations.length) return 0;
  const event = rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM analytics_events WHERE external_event_id = ${externalEventId} AND source = 'server'`))[0];
  if (!event) return 0;
  let n = 0;
  for (const d of destinations) {
    const r = rowsOf<{ id: string }>(
      await db.execute(sql`
        INSERT INTO analytics_deliveries (analytics_event_id, destination, channel, external_event_id, status, attempts, delivered_at)
        VALUES (${event.id}, ${d}, 'browser', ${externalEventId}, 'delivered', 1, now())
        ON CONFLICT (analytics_event_id, destination) DO NOTHING RETURNING id`)
    );
    n += r.length;
  }
  return n;
}

async function itemsForPurchase(purchaseId: string | null): Promise<DeliveryItem[]> {
  if (!purchaseId) return [];
  const rows = rowsOf<{ item_type: string; reference_id: string | null; name: string | null; category: string | null; quantity: number; unit: number }>(
    await db.execute(sql`
      SELECT i.item_type, i.reference_id, coalesce(s.name, sa.name, pp.name, i.item_type) AS name,
             coalesce(s.category::text, i.item_type) AS category, i.quantity, i.unit_price_cents AS unit
        FROM purchase_items i
        LEFT JOIN services s ON i.item_type = 'service' AND s.id::text = i.reference_id
        LEFT JOIN service_addons sa ON i.item_type = 'addon' AND sa.id::text = i.reference_id
        LEFT JOIN package_plans pp ON i.item_type = 'package' AND pp.id::text = i.reference_id
       WHERE i.purchase_id = ${purchaseId} AND i.item_type <> 'adjustment'
       ORDER BY i.created_at`)
  );
  // Names come from the catalogue, never from description snapshots (which hold dates and times).
  return rows.map((r) => ({ id: `${r.item_type}_${r.reference_id ?? 'x'}`, name: String(r.name).slice(0, 100), category: String(r.category), quantity: Number(r.quantity), priceCents: Number(r.unit) }));
}

interface DueRow {
  id: string;
  destination: Destination;
  attempts: number;
  external_event_id: string;
  event_name: ServerEventName;
  occurred_ms: number | string;
  value_cents: number | null;
  currency: string | null;
  page_path: string | null;
  properties: Record<string, unknown> | string | null;
  purchase_id: string | null;
  booking_id: string | null;
  session_id: string | null;
  consent_analytics: boolean;
  consent_advertising: boolean;
}

async function contextFor(row: DueRow): Promise<{ ctx: DeliveryContext | null; reason?: string }> {
  const props = typeof row.properties === 'string' ? JSON.parse(row.properties) : row.properties ?? {};
  // Match keys: from the booking's attribution snapshot (purchase, tour) or the event's own session (contact).
  let clickEnc: string | null = null;
  let vendorEnc: string | null = null;
  let clickAt: Date | null = null;
  let visitorConsent: string | null = null;
  if (row.booking_id) {
    const a = rowsOf<{ click_ids_encrypted: string | null; vendor_ids_encrypted: string | null; consent_advertising: boolean; at: string | null; state: string | null }>(
      await db.execute(sql`SELECT a.click_ids_encrypted, a.vendor_ids_encrypted, a.consent_advertising, a.conversion_touch->>'at' AS at, v.consent_state AS state
                             FROM analytics_attributions a LEFT JOIN analytics_visitors v ON v.id = a.visitor_id WHERE a.booking_id = ${row.booking_id}`)
    )[0];
    if (a) {
      clickEnc = a.click_ids_encrypted;
      vendorEnc = a.vendor_ids_encrypted;
      clickAt = a.at ? new Date(a.at) : null;
      visitorConsent = a.state;
    }
  } else if (row.session_id) {
    const s = rowsOf<{ click_ids_encrypted: string | null; vendor_ids_encrypted: string | null; started_ms: number | string; state: string | null }>(
      await db.execute(sql`SELECT s.click_ids_encrypted, s.vendor_ids_encrypted, (extract(epoch FROM s.started_at) * 1000)::float8 AS started_ms, v.consent_state AS state
                             FROM analytics_sessions s JOIN analytics_visitors v ON v.id = s.visitor_id WHERE s.id = ${row.session_id}`)
    )[0];
    if (s) {
      clickEnc = s.click_ids_encrypted;
      vendorEnc = s.vendor_ids_encrypted;
      clickAt = new Date(Number(s.started_ms));
      visitorConsent = s.state;
    }
  }
  const needs = DESTINATION_CONSENT[row.destination];
  const eventConsent = needs === 'analytics' ? row.consent_analytics : row.consent_advertising;
  const withdrawn = visitorConsent === 'denied' || (needs === 'advertising' && visitorConsent === 'analytics');
  if (!eventConsent || withdrawn) return { ctx: null, reason: 'consent_withdrawn' };

  const items = await itemsForPurchase(row.purchase_id);
  return {
    ctx: {
      destination: row.destination,
      eventId: row.external_event_id,
      name: row.event_name,
      occurredAt: new Date(Number(row.occurred_ms)),
      valueCents: row.value_cents === null ? null : Number(row.value_cents),
      taxCents: typeof props.tax_cents === 'number' ? props.tax_cents : null,
      currency: row.currency ?? 'USD',
      items,
      transactionId: typeof props.transaction_id === 'string' ? props.transaction_id : null,
      pageUrl: row.page_path ? sanitizePageUrl(row.page_path) : null,
      clickIds: needs === 'advertising' ? decryptJson(clickEnc) : {},
      vendorIds: Object.fromEntries(Object.entries(decryptJson(vendorEnc)).filter(([k]) => (needs === 'analytics' ? k === 'ga' : k !== 'ga'))),
      clickAt,
    },
  };
}

/**
 * Sends due deliveries (pending, or failed and due for retry). Safe to run
 * concurrently: rows are claimed with a lock timestamp first. Returns counts only.
 */
export async function processDueDeliveries(options: { limit?: number; eventRowId?: string } = {}): Promise<{ delivered: number; failed: number; skipped: number; dead: number }> {
  // Master switch off (or not production): leave the queue untouched — nothing is
  // claimed, sent, or marked delivered/skipped; those rows wait for the switch.
  if (!vendorsAllowed()) return { delivered: 0, failed: 0, skipped: 0, dead: 0 };
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200);
  const claimed = rowsOf<DueRow>(
    await db.execute(sql`
      WITH due AS (
        SELECT d.id FROM analytics_deliveries d
         WHERE d.channel = 'server' AND d.status IN ('pending', 'failed') AND d.next_retry_at <= now()
           AND (d.locked_at IS NULL OR d.locked_at < now() - interval '5 minutes')
           ${options.eventRowId ? sql`AND d.analytics_event_id = ${options.eventRowId}` : sql``}
         ORDER BY d.next_retry_at
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE analytics_deliveries d SET locked_at = now(), attempts = d.attempts + 1, updated_at = now()
        FROM due, analytics_events e
       WHERE d.id = due.id AND e.id = d.analytics_event_id
      RETURNING d.id, d.destination, d.attempts, d.external_event_id, e.event_name, (extract(epoch FROM e.occurred_at) * 1000)::float8 AS occurred_ms,
                e.value_cents, e.currency, e.page_path, e.properties, e.purchase_id, e.booking_id, e.session_id, e.consent_analytics, e.consent_advertising`)
  );

  const out = { delivered: 0, failed: 0, skipped: 0, dead: 0 };
  for (const row of claimed) {
    const finish = async (status: 'delivered' | 'failed' | 'dead' | 'skipped', error: string | null, testMode = false) => {
      const retryIn = nextRetryDelayMinutes(Number(row.attempts));
      await db.execute(sql`
        UPDATE analytics_deliveries SET status = ${status}, last_error_sanitized = ${error ? sanitizeError(error) : null}, locked_at = NULL,
          test_mode = ${testMode}, delivered_at = ${status === 'delivered' ? sql`now()` : sql`delivered_at`},
          next_retry_at = ${status === 'failed' ? sql`now() + make_interval(mins => ${retryIn}::int)` : sql`next_retry_at`}, updated_at = now()
        WHERE id = ${row.id}`);
      out[status]++;
    };
    try {
      const adapter = SERVER_ADAPTERS[row.destination];
      if (!adapter || !serverDestinationActive(row.destination)) {
        await finish('skipped', 'not_configured');
        continue;
      }
      const { ctx, reason } = await contextFor(row);
      if (!ctx) {
        await finish('skipped', reason ?? 'skipped');
        continue;
      }
      const built = adapter(ctx);
      if ('skip' in built) {
        await finish('skipped', built.skip);
        continue;
      }
      const res = await getTransport()(built.request);
      if (res.ok) await finish('delivered', null, built.testMode);
      else await finish(Number(row.attempts) >= MAX_ATTEMPTS ? 'dead' : 'failed', `HTTP ${res.status}: ${res.text}`, built.testMode);
    } catch (error) {
      await finish(Number(row.attempts) >= MAX_ATTEMPTS ? 'dead' : 'failed', (error as Error)?.message || String(error)).catch(() => undefined);
    }
  }
  return out;
}

/** Owner retry: puts failed and dead deliveries back in the queue (attempts kept, same event IDs). */
export async function requeueFailedDeliveries(): Promise<number> {
  const rows = rowsOf<{ id: string }>(
    await db.execute(sql`UPDATE analytics_deliveries SET status = 'pending', next_retry_at = now(), locked_at = NULL, attempts = LEAST(attempts, ${MAX_ATTEMPTS - 1}), updated_at = now()
                          WHERE channel = 'server' AND status IN ('failed', 'dead') RETURNING id`)
  );
  return rows.length;
}
