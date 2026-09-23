import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminSession } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

// Read-only diagnostic: lists configured Stripe webhook endpoints (URL,
// enabled status, subscribed events) so an admin can confirm the webhook
// that confirms paid bookings is actually set up, without ever exposing
// any signing secret (Stripe's list API doesn't return it after creation).
export async function GET() {
  if (!getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
