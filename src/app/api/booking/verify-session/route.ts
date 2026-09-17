import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { bookings, services } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Missing sessionId' },
        { status: 400 }
      );
    }

    // ========================================
    // RETRIEVE STRIPE SESSION
    // ========================================
    let stripeSession: Stripe.Checkout.Session;

    try {
      stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err: any) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    // ========================================
    // CHECK FOR CONFIRMED BOOKING
    // ========================================
    const booking = await db.query.bookings.findFirst({
      where: eq(bookings.stripe_session_id, sessionId),
    });

    if (!booking) {
      // Session exists but booking not created yet
      if (stripeSession.payment_status === 'paid') {
        return NextResponse.json({
          status: 'pending',
          message: 'Payment received but booking not yet confirmed',
        });
      }

      return NextResponse.json({
        status: 'unpaid',
        message: 'Payment not completed',
      });
    }

    if (booking.status !== 'confirmed') {
      return NextResponse.json({
        status: 'pending',
        message: 'Booking not yet confirmed',
      });
    }

    // ========================================
    // RETRIEVE SERVICE DETAILS
    // ========================================
    const service = await db.query.services.findFirst({
      where: eq(services.id, booking.service_id),
    });

    if (!service) {
      return NextResponse.json(
        { error: 'Service not found' },
        { status: 404 }
      );
    }

    // ========================================
    // RETURN CONFIRMED BOOKING
    // ========================================
    return NextResponse.json({
      status: 'confirmed',
      booking: {
        bookingId: booking.booking_id,
        status: booking.status,
        service: {
          name: service.name,
        },
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
    console.error('Error verifying session:', error);
    return NextResponse.json(
      { error: 'Failed to verify session' },
      { status: 500 }
    );
  }
}
