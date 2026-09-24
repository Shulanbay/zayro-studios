import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { requirePermission } from '@/lib/crm/auth';

export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

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
      endpoints: endpoints.data.map((e) => ({
        id: e.id,
        url: e.url,
        status: e.status,
        enabled_events: e.enabled_events,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}
