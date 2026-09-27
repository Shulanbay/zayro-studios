import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { bookings, services } from '@/lib/db/schema';
import { enforceRateLimit } from '@/lib/crm/rateLimit';
import { publicBookingSummary, publicStatus } from '@/lib/publicBooking';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ bookingId: z.string().trim().regex(/^ZAY-[A-Z0-9]{6,16}$/) });

/**
 * Server-side verification for the free-booking path (no Stripe session to
 * check). Only a confirmed booking returns details, and only the minimal,
 * non-sensitive summary (see lib/publicBooking.ts).
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'verify-booking', 30, 600);
  if (limited) return limited;

  let bookingId: string;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ status: 'not_found' });
    bookingId = parsed.data.bookingId;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const booking = await db.query.bookings.findFirst({ where: eq(bookings.booking_id, bookingId) });
    // Free confirmations are immediate; anything else is not for this page.
    if (!booking || booking.stripe_session_id) return NextResponse.json({ status: 'not_found' });

    const status = publicStatus(booking);
    if (status !== 'confirmed') return NextResponse.json({ status });

    const service = await db.query.services.findFirst({ where: eq(services.id, booking.service_id) });
    if (!service) return NextResponse.json({ status: 'not_found' });

    return NextResponse.json({ status: 'confirmed', booking: publicBookingSummary(booking, service) });
  } catch (error) {
    console.error('Error verifying booking:', (error as Error)?.message || error);
    return NextResponse.json({ error: 'Please try again in a moment.' }, { status: 503 });
  }
}
