import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { actorOf, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';

export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

/** Events the CRM webhook handler processes (see src/lib/crm/webhook.ts). */
const CRM_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
  'charge.refunded',
  'refund.updated',
] as const;

const WEBHOOK_PATH = '/api/payment/webhook';

function missingEvents(enabled: string[]): string[] {
  if (enabled.includes('*')) return [];
  return CRM_WEBHOOK_EVENTS.filter((e) => !enabled.includes(e));
}

// Read-only diagnostic: lists configured Stripe webhook endpoints (URL,
// enabled status, subscribed events) so an admin can confirm the webhook
// that confirms paid bookings is actually set up, without ever exposing
// any signing secret (Stripe's list API doesn't return it after creation).
export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, 'integrations.read');
  if (!guard.ok) return guard.response;

  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
    return NextResponse.json({
      livemode: (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_'),
      endpoints: endpoints.data.map((e) => ({
        id: e.id,
        url: e.url,
        status: e.status,
        enabled_events: e.enabled_events,
        missing_events: e.url.endsWith(WEBHOOK_PATH) ? missingEvents(e.enabled_events) : [],
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}

/**
 * Adds the events the CRM needs to the EXISTING webhook endpoint for
 * /api/payment/webhook. Never creates an endpoint (so the signing secret in
 * Vercel stays valid) and never removes events. Owner-only, audited.
 */
export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'settings.manage');
  if (!guard.ok) return guard.response;

  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
    const matches = endpoints.data.filter((e) => e.url.endsWith(WEBHOOK_PATH));
    if (matches.length !== 1) {
      return NextResponse.json(
        { error: matches.length === 0 ? 'No webhook endpoint for /api/payment/webhook in this Stripe account' : 'More than one endpoint for /api/payment/webhook — fix it in the Stripe Dashboard' },
        { status: 409 }
      );
    }
    const endpoint = matches[0];
    const missing = missingEvents(endpoint.enabled_events);
    if (missing.length === 0) return NextResponse.json({ message: 'Webhook already has every event the CRM needs', added: [] });

    const events = Array.from(new Set([...endpoint.enabled_events, ...missing])) as Stripe.WebhookEndpointUpdateParams.EnabledEvent[];
    const updated = await stripe.webhookEndpoints.update(endpoint.id, { enabled_events: events });
    await writeAudit({
      actor: actorOf(guard.admin),
      operation: 'integration.stripe_webhook_events',
      entityType: 'stripe_webhook',
      entityId: endpoint.id,
      before: { events: endpoint.enabled_events },
      after: { events: updated.enabled_events },
    });
    return NextResponse.json({ message: `Added ${missing.length} event(s) to the existing webhook`, added: missing, events: updated.enabled_events });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}
