import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/crm/rateLimit';
import { releaseHold } from '@/lib/holds';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ hold_id: z.string().trim().uuid() });

/**
 * The customer left Checkout (cancel page) or went back to pick another
 * time: give the slot back now instead of when the hold runs out. The hold
 * id is an unguessable UUID only the customer's browser and Stripe's
 * cancel URL know. An open Checkout session for the hold is expired first,
 * so an old payment tab can't complete afterwards.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'release-hold', 30, 600);
  if (limited) return limited;

  let holdId: string;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid hold id' }, { status: 400 });
    holdId = parsed.data.hold_id;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const result = await releaseHold(holdId);
    if (result.released) return NextResponse.json({ released: true });
    if (result.reason === 'paid') {
      return NextResponse.json({ released: false, paid: true });
    }
    if (result.reason === 'stripe_unavailable') {
      return NextResponse.json({ error: 'Please try again in a moment.' }, { status: 503 });
    }
    return NextResponse.json({ released: false, status: result.status ?? result.reason });
  } catch (error) {
    console.error('Error releasing hold:', (error as Error)?.message || error);
    return NextResponse.json({ error: 'Please try again in a moment.' }, { status: 500 });
  }
}
