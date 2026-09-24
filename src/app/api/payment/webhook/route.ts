import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { db } from '@/lib/db';
import { integrationLogs } from '@/lib/db/schema';
import { processStripeEvent } from '@/lib/crm/webhook';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export const dynamic = 'force-dynamic';

/**
 * Stripe webhook. The signature is verified against the raw body before
 * anything else; processing (idempotent, transactional) lives in
 * lib/crm/webhook.ts.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = (await headers()).get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  if (!signature) {
    await logRejected('Missing stripe-signature header');
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 401 });
  }
  if (!webhookSecret) {
    await logRejected('STRIPE_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    await logRejected(`Signature verification failed: ${(err as Error)?.message || err}`);
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  const outcome = await processStripeEvent(event);
  return NextResponse.json(outcome.body, { status: outcome.httpStatus });
}

async function logRejected(message: string) {
  try {
    await db.insert(integrationLogs).values({
      integration_type: 'stripe',
      booking_id: null,
      status: 'failed',
      error_message: message.slice(0, 500),
      response_data: { message: message.slice(0, 500), timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error logging webhook rejection:', (err as Error)?.message || err);
  }
}
