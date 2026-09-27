import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { bookings, services } from '@/lib/db/schema';
import { enforceRateLimit } from '@/lib/crm/rateLimit';
import { getStripe } from '@/lib/crm/refunds';
import { publicBookingSummary, publicStatus } from '@/lib/publicBooking';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ sessionId: z.string().trim().regex(/^cs_(test|live)_[A-Za-z0-9]+$/) });

/**
 * The success page after Stripe Checkout. The booking is confirmed only by
 * the signature-verified webhook; this route reports what the database says
 * (plus Stripe's own payment status while the webhook is still on its way),
 * with a minimal summary and no contact details.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'verify-session', 60, 600);
  if (limited) return limited;

  let sessionId: string;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ status: 'not_found' });
    sessionId = parsed.data.sessionId;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const booking = await db.query.bookings.findFirst({ where: eq(bookings.stripe_session_id, sessionId) });
    if (!booking) return NextResponse.json({ status: 'not_found' });

    const status = publicStatus(booking);
    if (status === 'pending') {
      // The webhook usually lands within seconds; tell the page whether the
      // money is already in so it keeps waiting instead of giving up.
      const stripe = getStripe();
      const session = stripe ? await stripe.checkout.sessions.retrieve(sessionId).catch(() => null) : null;
      return NextResponse.json({ status: session?.payment_status === 'paid' ? 'processing' : 'pending' });
    }
    if (status !== 'confirmed') return NextResponse.json({ status, bookingId: booking.booking_id });

    const service = await db.query.services.findFirst({ where: eq(services.id, booking.service_id) });
    if (!service) return NextResponse.json({ status: 'not_found' });
    return NextResponse.json({ status: 'confirmed', booking: publicBookingSummary(booking, service) });
  } catch (error) {
    console.error('Error verifying session:', (error as Error)?.message || error);
    return NextResponse.json({ error: 'Please try again in a moment.' }, { status: 503 });
  }
}
