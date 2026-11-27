import type { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rowsOf } from '@/lib/db/types';
import { CONSENT_COOKIE, applyGpc, currentConsent, gpcFromHeaders } from '../consent';
import type { ServerEventName } from '../catalog';
import { deterministicEventId } from './crypto';
import { enqueueDeliveries, processDueDeliveries } from './deliveries';
import { attributionForBooking, insertServerEvent, snapshotAttribution, visitFromCookies, type ServerVisitContext } from './store';
import { publicAnalyticsConfig } from './config';

/**
 * The only entry points the booking, payment, webhook and contact code
 * calls. Every function here:
 *  - runs after the business transaction has committed;
 *  - is idempotent (deterministic event IDs + unique constraints), so a
 *    repeated webhook, a page refresh or a retry never duplicates anything;
 *  - never throws: analytics failures are logged (counts and messages
 *    only) and the caller carries on — a booking, payment, webhook,
 *    confirmation email, Calendar event or Sheets row is never affected.
 */

/** What the browser needs to fire the matching pixel/dataLayer event with the same ID. No PII. */
export interface ConversionPayload {
  name: 'checkout_created' | 'purchase_confirmed' | 'tour_confirmed' | 'contact_submitted' | 'booking_confirmed';
  eventId: string;
  transactionId: string | null;
  valueCents: number | null;
  taxCents: number | null;
  currency: 'USD';
  items: { id: string; name: string; category: string; quantity: number; priceCents: number }[];
  ga4ServerSide: boolean;
}

export const eventIds = {
  checkout: (bookingId: string) => deterministicEventId('checkout_created', bookingId),
  purchase: (purchaseId: string) => deterministicEventId('purchase_confirmed', purchaseId),
  freeBooking: (bookingId: string) => deterministicEventId('free_booking_confirmed', bookingId),
  extension: (purchaseId: string) => deterministicEventId('extension_purchased', purchaseId),
  refund: (refundId: string) => deterministicEventId('refund_succeeded', refundId),
  contact: (submissionId: string) => deterministicEventId('contact_submitted', submissionId),
  abandoned: (bookingId: string) => deterministicEventId('booking_abandoned', bookingId),
};

async function safely<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[analytics] ${label} failed (booking and payment unaffected):`, ((error as Error)?.message || String(error)).slice(0, 200));
    return null;
  }
}

/** Queue + attempt delivery for one event, bounded in time; leftovers are retried by the delivery job. */
async function deliverSoon(eventRowId: string) {
  const work = (async () => {
    const { queued } = await enqueueDeliveries(eventRowId);
    if (queued.length) await processDueDeliveries({ eventRowId, limit: 10 });
  })();
  await Promise.race([work.catch(() => undefined), new Promise((r) => setTimeout(r, 2500))]);
}

async function requestVisit(request: NextRequest): Promise<ServerVisitContext> {
  const consent = applyGpc(currentConsent(request.cookies.get(CONSENT_COOKIE)?.value), gpcFromHeaders(request.headers));
  return visitFromCookies(request.cookies, consent);
}

async function itemsOf(purchaseId: string) {
  const rows = rowsOf<{ item_type: string; reference_id: string | null; name: string | null; category: string | null; quantity: number; unit: number }>(
    await db.execute(sql`
      SELECT i.item_type, i.reference_id, coalesce(s.name, sa.name, pp.name, i.item_type) AS name, coalesce(s.category::text, i.item_type) AS category,
             i.quantity, i.unit_price_cents AS unit
        FROM purchase_items i
        LEFT JOIN services s ON i.item_type = 'service' AND s.id::text = i.reference_id
        LEFT JOIN service_addons sa ON i.item_type = 'addon' AND sa.id::text = i.reference_id
        LEFT JOIN package_plans pp ON i.item_type = 'package' AND pp.id::text = i.reference_id
       WHERE i.purchase_id = ${purchaseId} AND i.item_type <> 'adjustment' ORDER BY i.created_at`)
  );
  return rows.map((r) => ({ id: `${r.item_type}_${r.reference_id ?? 'x'}`, name: String(r.name).slice(0, 100), category: String(r.category), quantity: Number(r.quantity), priceCents: Number(r.unit) }));
}

function payload(name: ConversionPayload['name'], eventId: string, valueCents: number | null, taxCents: number | null, items: ConversionPayload['items'], transactionId: string | null = null): ConversionPayload {
  return { name, eventId, transactionId, valueCents, taxCents, currency: 'USD', items, ga4ServerSide: publicAnalyticsConfig().ga4ServerSide };
}

/** Stripe Checkout was created by the server (not a click). Snapshots attribution for the booking. */
export async function analyticsCheckoutCreated(request: NextRequest, input: { bookingId: string; purchaseId: string; totalCents: number; taxCents: number }): Promise<ConversionPayload | null> {
  return safely('checkout_created', async () => {
    const visit = await requestVisit(request);
    await snapshotAttribution({ bookingId: input.bookingId, purchaseId: input.purchaseId, visit });
    const eventId = eventIds.checkout(input.bookingId);
    const items = await itemsOf(input.purchaseId);
    const ev = await insertServerEvent({
      name: 'checkout_created',
      eventId,
      bookingId: input.bookingId,
      purchaseId: input.purchaseId,
      visitorId: visit.visitorId,
      sessionId: visit.sessionId,
      valueCents: input.totalCents,
      currency: 'USD',
      pagePath: '/booking',
      properties: { tax_cents: input.taxCents },
      consent: visit.consent,
    });
    if (ev.inserted) await deliverSoon(ev.id);
    return payload('checkout_created', eventId, input.totalCents, input.taxCents, items);
  });
}

/** A free booking (studio tour or $0 session) was confirmed in the database. */
export async function analyticsFreeBookingConfirmed(request: NextRequest, input: { bookingId: string; purchaseId: string | null; isTour: boolean }): Promise<ConversionPayload | null> {
  return safely('free_booking_confirmed', async () => {
    const visit = await requestVisit(request);
    await snapshotAttribution({ bookingId: input.bookingId, purchaseId: input.purchaseId, visit });
    const name: ServerEventName = input.isTour ? 'tour_confirmed' : 'booking_confirmed';
    const eventId = eventIds.freeBooking(input.bookingId);
    const ev = await insertServerEvent({
      name,
      eventId,
      bookingId: input.bookingId,
      purchaseId: input.purchaseId,
      visitorId: visit.visitorId,
      sessionId: visit.sessionId,
      valueCents: 0,
      currency: 'USD',
      pagePath: '/booking',
      consent: visit.consent,
    });
    if (ev.inserted) await deliverSoon(ev.id);
    return payload(name, eventId, 0, 0, []);
  });
}

interface PurchaseFacts {
  id: string;
  total_cents: number;
  tax_cents: number;
  status: string;
  purchased_at_ms: number | string | null;
}

async function purchaseFacts(purchaseId: string): Promise<PurchaseFacts | null> {
  return (
    rowsOf<PurchaseFacts>(
      await db.execute(sql`SELECT id, total_cents, tax_cents, status, (extract(epoch FROM purchased_at) * 1000)::float8 AS purchased_at_ms FROM purchases WHERE id = ${purchaseId}`)
    )[0] ?? null
  );
}

/**
 * The Stripe webhook confirmed a paid booking. The only place a purchase
 * conversion is created. Uses the attribution snapshot from Checkout time.
 */
export async function analyticsPurchaseConfirmed(bookingId: string): Promise<void> {
  await safely('purchase_confirmed', async () => {
    const b = rowsOf<{ id: string; purchase_id: string | null; status: string; payment_status: string }>(
      await db.execute(sql`SELECT id, purchase_id, status::text, payment_status::text FROM bookings WHERE id = ${bookingId}`)
    )[0];
    if (!b?.purchase_id || b.status !== 'confirmed' || b.payment_status !== 'succeeded') return;
    const p = await purchaseFacts(b.purchase_id);
    if (!p || !['paid', 'partially_refunded', 'refunded'].includes(p.status) || Number(p.total_cents) <= 0) return;
    let attribution = await attributionForBooking(bookingId);
    if (!attribution) {
      // Booking started before analytics existed (or snapshot failed): record it unattributed.
      await snapshotAttribution({ bookingId, purchaseId: p.id, visit: { visitorId: null, sessionId: null, consent: { analytics: false, advertising: false } } });
      attribution = await attributionForBooking(bookingId);
    }
    await db.execute(sql`UPDATE analytics_attributions SET purchase_id = coalesce(purchase_id, ${p.id}), updated_at = now() WHERE booking_id = ${bookingId}`);
    const eventId = eventIds.purchase(p.id);
    const ev = await insertServerEvent({
      name: 'purchase_confirmed',
      eventId,
      bookingId,
      purchaseId: p.id,
      visitorId: attribution?.visitor_id ?? null,
      sessionId: attribution?.session_id ?? null,
      valueCents: Number(p.total_cents),
      currency: 'USD',
      pagePath: '/booking/success',
      properties: { tax_cents: Number(p.tax_cents), transaction_id: eventId },
      consent: { analytics: !!attribution?.consent_analytics, advertising: !!attribution?.consent_advertising },
      occurredAt: p.purchased_at_ms ? new Date(Number(p.purchased_at_ms)) : new Date(),
    });
    if (ev.inserted) await deliverSoon(ev.id);
  });
}

/** A paid extension of an existing booking: inherits the booking's attribution, counted as extension revenue. */
export async function analyticsExtensionPurchased(bookingId: string, purchaseId: string): Promise<void> {
  await safely('extension_purchased', async () => {
    const p = await purchaseFacts(purchaseId);
    if (!p || !['paid', 'partially_refunded', 'refunded'].includes(p.status)) return;
    const attribution = await attributionForBooking(bookingId);
    const eventId = eventIds.extension(p.id);
    const ev = await insertServerEvent({
      name: 'extension_purchased',
      eventId,
      bookingId,
      purchaseId: p.id,
      visitorId: attribution?.visitor_id ?? null,
      sessionId: attribution?.session_id ?? null,
      valueCents: Number(p.total_cents),
      currency: 'USD',
      properties: { tax_cents: Number(p.tax_cents), transaction_id: eventId, revenue_type: 'extension' },
      consent: { analytics: !!attribution?.consent_analytics, advertising: !!attribution?.consent_advertising },
      occurredAt: p.purchased_at_ms ? new Date(Number(p.purchased_at_ms)) : new Date(),
    });
    if (ev.inserted) await deliverSoon(ev.id);
  });
}

/** Succeeded refunds of a purchase become refund events (once each). Acquisition records are untouched. */
export async function analyticsRefundsSucceeded(purchaseId: string): Promise<void> {
  await safely('refund_succeeded', async () => {
    const refunds = rowsOf<{ id: string; amount_cents: number; booking_id: string | null; at_ms: number | string }>(
      await db.execute(sql`SELECT id, amount_cents, booking_id, (extract(epoch FROM updated_at) * 1000)::float8 AS at_ms FROM refunds WHERE purchase_id = ${purchaseId} AND status = 'succeeded'`)
    );
    if (!refunds.length) return;
    const bookingId =
      refunds.find((r) => r.booking_id)?.booking_id ??
      rowsOf<{ id: string }>(await db.execute(sql`SELECT id FROM bookings WHERE purchase_id = ${purchaseId} LIMIT 1`))[0]?.id ??
      rowsOf<{ booking_id: string }>(await db.execute(sql`SELECT booking_id FROM booking_extensions WHERE purchase_id = ${purchaseId} LIMIT 1`))[0]?.booking_id ??
      null;
    const attribution = bookingId ? await attributionForBooking(bookingId) : null;
    const isExtension = rowsOf(await db.execute(sql`SELECT 1 FROM purchases WHERE id = ${purchaseId} AND type = 'extension'`)).length > 0;
    for (const r of refunds) {
      const ev = await insertServerEvent({
        name: 'refund_succeeded',
        eventId: eventIds.refund(r.id),
        bookingId,
        purchaseId,
        visitorId: attribution?.visitor_id ?? null,
        sessionId: attribution?.session_id ?? null,
        valueCents: Number(r.amount_cents),
        currency: 'USD',
        properties: { transaction_id: isExtension ? eventIds.extension(purchaseId) : eventIds.purchase(purchaseId) },
        consent: { analytics: !!attribution?.consent_analytics, advertising: !!attribution?.consent_advertising },
        occurredAt: new Date(Number(r.at_ms)),
      });
      if (ev.inserted) await deliverSoon(ev.id);
    }
  });
}

/**
 * A started Checkout ended without payment (Stripe said expired / failed,
 * or the customer left Checkout and the slot was released). Once per
 * booking; no value is reported (nothing was charged).
 */
export async function analyticsBookingAbandoned(bookingId: string, reason: 'expired' | 'failed' | 'left_checkout'): Promise<void> {
  await safely('booking_abandoned', async () => {
    const attribution = await attributionForBooking(bookingId);
    const ev = await insertServerEvent({
      name: 'booking_abandoned',
      eventId: eventIds.abandoned(bookingId),
      bookingId,
      visitorId: attribution?.visitor_id ?? null,
      sessionId: attribution?.session_id ?? null,
      properties: { reason },
      consent: { analytics: !!attribution?.consent_analytics, advertising: !!attribution?.consent_advertising },
    });
    if (ev.inserted) await deliverSoon(ev.id);
  });
}

/** The server accepted a contact form message (after spam checks and a successful send). */
export async function analyticsContactSubmitted(request: NextRequest, submissionId: string, topic: string | null, pagePath = '/contact'): Promise<ConversionPayload | null> {
  return safely('contact_submitted', async () => {
    const visit = await requestVisit(request);
    const eventId = eventIds.contact(submissionId);
    const ev = await insertServerEvent({
      name: 'contact_submitted',
      eventId,
      visitorId: visit.visitorId,
      sessionId: visit.sessionId,
      pagePath,
      properties: topic ? { topic_kind: topic.toLowerCase().startsWith('monthly package') ? 'package' : 'general' } : {},
      consent: visit.consent,
    });
    if (ev.inserted) await deliverSoon(ev.id);
    return payload('contact_submitted', eventId, null, null, []);
  });
}

/**
 * The conversion payload for the public success page, only once the
 * database says the booking is confirmed (and, for paid bookings, paid).
 * Deterministic IDs, so it matches the server event whether or not the
 * webhook's analytics step already ran.
 */
export async function conversionForConfirmedBooking(bookingId: string): Promise<ConversionPayload | null> {
  return safely('conversion_payload', async () => {
    const b = rowsOf<{ id: string; purchase_id: string | null; status: string; payment_status: string; total: string; category: string }>(
      await db.execute(sql`SELECT b.id, b.purchase_id, b.status::text, b.payment_status::text, b.total_amount::text AS total, s.category::text
                             FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.id = ${bookingId}`)
    )[0];
    if (!b || !['confirmed', 'completed'].includes(b.status) || b.payment_status !== 'succeeded') return null;
    const paid = Number(b.total) > 0;
    if (!paid) return payload(b.category === 'tour' ? 'tour_confirmed' : 'booking_confirmed', eventIds.freeBooking(b.id), 0, 0, []);
    if (!b.purchase_id) return null;
    const p = await purchaseFacts(b.purchase_id);
    if (!p || !['paid', 'partially_refunded', 'refunded'].includes(p.status)) return null;
    const eventId = eventIds.purchase(p.id);
    return payload('purchase_confirmed', eventId, Number(p.total_cents), Number(p.tax_cents), await itemsOf(p.id), eventId);
  });
}
