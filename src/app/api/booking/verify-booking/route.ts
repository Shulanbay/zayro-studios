import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { bookings, services } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * Server-side verification for the free-booking path (no Stripe session to
 * check). Looks up the booking by its public booking_id and only returns
 * details if it is actually confirmed in the database — never trusts
 * anything the client claims about payment/confirmation state.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bookingId } = body;

    if (!bookingId) {
      return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });
    }

    const booking = await db.query.bookings.findFirst({
      where: eq(bookings.booking_id, bookingId),
    });

    if (!booking || booking.status !== 'confirmed') {
      return NextResponse.json({ status: 'pending', message: 'Booking not found or not confirmed' });
    }

    const service = await db.query.services.findFirst({
      where: eq(services.id, booking.service_id),
    });

    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    return NextResponse.json({
      status: 'confirmed',
      booking: {
        bookingId: booking.booking_id,
        status: booking.status,
        service: { name: service.name },
        bookingDate: booking.booking_date,
        startTime: booking.start_time,
        endTime: booking.end_time,
        durationMinutes: booking.duration_minutes,
        totalAmount: booking.total_amount,
        customerName: `${booking.customer_first_name} ${booking.customer_last_name}`,
        customerEmail: booking.customer_email,
        customerPhone: booking.customer_phone,
      },
    });
  } catch (error: any) {
    console.error('Error verifying booking:', error);
    return NextResponse.json({ error: 'Failed to verify booking' }, { status: 500 });
  }
}
