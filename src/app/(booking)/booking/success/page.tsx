'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { formatBookingDateUTC } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface BookingConfirmation {
  bookingId: string;
  status: string;
  service: {
    name: string;
  };
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  totalAmount: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const bookingId = searchParams.get('booking_id');

  const [booking, setBooking] = useState<BookingConfirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function verifyBooking() {
      if (!sessionId && !bookingId) {
        setError('No booking reference found');
        setLoading(false);
        return;
      }

      try {
        // Query server for booking status — paid bookings verify via the
        // Stripe session, free bookings verify via the booking ID directly.
        // Either way the server (not the URL) is the source of truth.
        const response = await fetch(
          sessionId ? '/api/booking/verify-session' : '/api/booking/verify-booking',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sessionId ? { sessionId } : { bookingId }),
          }
        );

        if (!response.ok) {
          throw new Error('Failed to verify booking');
        }

        const data = await response.json();

        if (data.status === 'confirmed') {
          setBooking(data.booking);
        } else if (data.status === 'pending') {
          setError('Payment is being processed. Please check your email shortly.');
        } else {
          setError('Booking not found or payment failed');
        }
      } catch (err: any) {
        console.error('Error verifying booking:', err);
        setError('Unable to verify your booking. Please check your email.');
      } finally {
        setLoading(false);
      }
    }

    verifyBooking();
  }, [sessionId, bookingId]);

  if (loading) {
    return (
      <div className="container py-24 md:py-32 text-center" aria-busy="true">
        <div className="spinner mx-auto mb-6" style={{ width: '2rem', height: '2rem' }} />
        <h1 className="text-3xl font-black mb-2 text-zayro-dark">Verifying your booking...</h1>
        <p className="text-lg text-zayro-gray">This only takes a moment.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container py-24 md:py-32">
        <div className="max-w-xl mx-auto card">
          <h1 className="text-2xl font-black mb-4 text-zayro-dark">We couldn't confirm that yet</h1>
          <p className="text-zayro-gray mb-6">{error}</p>
          <p className="text-zayro-gray mb-8 text-sm">
            If you have questions about your payment or booking, contact us at{' '}
            <a href="mailto:hello@zayro.studio" className="text-zayro-primary font-bold">
              hello@zayro.studio
            </a>
          </p>
          <Link href="/booking" className="button button-primary">
            Return to Booking
          </Link>
        </div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="container py-24 md:py-32">
        <div className="max-w-xl mx-auto card text-center">
          <h1 className="text-2xl font-black mb-4 text-zayro-dark">Booking Not Found</h1>
          <p className="text-zayro-gray mb-8">
            We could not find your booking. Please check your email for confirmation details.
          </p>
          <Link href="/booking" className="button button-primary">
            Return to Booking
          </Link>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-zayro-bg">
      <div className="container py-16 md:py-24">
        <div className="max-w-4xl mx-auto mb-14 text-center">
          <span className="chip mb-6" role="status">
            <span className="chip-dot" aria-hidden="true" />
            Confirmed
          </span>
          <h1 className="text-4xl md:text-5xl font-black leading-tight text-zayro-dark">Your Booking Is Confirmed</h1>
          <p className="text-lg text-zayro-gray mt-4">
            A confirmation email is on its way. Check your spam folder if you don't see it soon.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12 max-w-4xl mx-auto">
          <div className="md:col-span-2 space-y-6">
            <div className="card">
              <h3 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-2">Booking ID</h3>
              <p className="text-xl font-black font-mono text-zayro-dark">{booking.bookingId}</p>
            </div>

            <div className="card">
              <h3 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-2">Service</h3>
              <p className="text-2xl font-black text-zayro-dark">{booking.service.name}</p>
            </div>

            <div className="card">
              <h3 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-2">Date & Time</h3>
              <p className="text-xl font-black text-zayro-dark">{formatBookingDateUTC(booking.bookingDate)}</p>
              <p className="text-lg font-bold mt-1 text-zayro-primary">
                {booking.startTime} - {booking.endTime} ET · {booking.durationMinutes} min
              </p>
            </div>

            <div className="card">
              <h3 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-2">Customer Info</h3>
              <p className="font-bold text-zayro-dark">{booking.customerName}</p>
              <p className="text-zayro-gray">{booking.customerEmail}</p>
              <p className="text-zayro-gray">{booking.customerPhone}</p>
            </div>

            <div className="card">
              <h3 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-2">Location</h3>
              <p className="font-bold text-zayro-dark">ZAYRO Studios</p>
              <p className="text-zayro-gray">40 W 37th St, Suite 603, New York, NY 10018</p>
            </div>
          </div>

          <div className="card h-fit">
            <h3 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-6">Amount Paid</h3>
            <div className="text-4xl font-black text-zayro-primary mb-6">${booking.totalAmount}</div>
            <p className="text-sm text-zayro-gray border-t border-zayro-border pt-6">
              A confirmation email has been sent. Check your spam folder if you don't see it.
            </p>
          </div>
        </div>

        <div className="card max-w-2xl mx-auto mb-14">
          <h3 className="text-xl font-bold mb-5 text-zayro-dark">What's Next?</h3>
          <ul className="space-y-3">
            <li className="flex gap-3">
              <span className="text-zayro-primary font-bold" aria-hidden="true">→</span>
              <span className="text-zayro-gray">Arrive 10 minutes early for your session</span>
            </li>
            <li className="flex gap-3">
              <span className="text-zayro-primary font-bold" aria-hidden="true">→</span>
              <span className="text-zayro-gray">
                Questions? Contact us at{' '}
                <a href="mailto:hello@zayro.studio" className="text-zayro-primary font-semibold">
                  hello@zayro.studio
                </a>
              </span>
            </li>
          </ul>
        </div>

        <div className="text-center">
          <Link href="/" className="button button-primary px-8 py-4">
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <SuccessContent />
    </Suspense>
  );
}
