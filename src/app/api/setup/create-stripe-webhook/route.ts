import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getBaseUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

// TEMPORARY one-time setup endpoint, explicitly authorized by the site
// owner to create the missing Stripe test-mode webhook via the API instead
// of the Dashboard. Guarded by a nonce (not a stored secret) so it isn't
// wide open while deployed. Delete this file after use.
const SETUP_NONCE = 'zayro-setup-8f21c9a4-temp';

export async function POST(request: NextRequest) {
  const nonce = request.headers.get('x-setup-nonce');
  if (nonce !== SETUP_NONCE) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const webhookUrl = `${getBaseUrl(request)}/api/payment/webhook`;

  try {
    const existing = await stripe.webhookEndpoints.list({ limit: 50 });
    const match = existing.data.find((e) => e.url === webhookUrl);

    if (match) {
      return NextResponse.json({
        status: 'already_exists',
        id: match.id,
        url: match.url,
        enabled_events: match.enabled_events,
        note: 'An endpoint already exists for this URL. Its signing secret cannot be retrieved again — only rolled (rotated) to get a new one. Not doing that automatically to avoid breaking anything already relying on the current secret.',
      });
    }

    const created = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: ['checkout.session.completed', 'charge.succeeded'],
      description: 'ZAYRO Studios booking confirmation (created via setup script)',
    });

    return NextResponse.json({
      status: 'created',
      id: created.id,
      url: created.url,
      enabled_events: created.enabled_events,
      secret: created.secret,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
  }
}
