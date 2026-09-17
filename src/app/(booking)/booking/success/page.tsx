'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

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

export default function SuccessPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');

  const [booking, setBooking] = useState<BookingConfirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function verifyBooking() {
      if (!sessionId) {
        setError('No session found');
        setLoading(false);
        return;
      }

      try {
        // Query server for booking status
        const response = await fetch(`/api/booking/verify-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });

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
  }, [sessionId]);

  if (loading) {
    return (
      <div className="container py-32 text-center">
        <h1 className="text-4xl font-black mb-4">Verifying Payment...</h1>
        <p className="text-lg text-zayro-gray">Please wait while we confirm your booking.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container py-32">
        <div className="max-w-2xl mx-auto bg-red-50 border-2 border-red-200 p-8 md:p-12">
          <h1 className="text-3xl font-black mb-4 text-red-900">Payment Issue</h1>
          <p className="text-lg text-red-800 mb-8">{error}</p>
          <p className="text-zayro-gray mb-8">
            If you have questions about your payment or booking, please contact us at{' '}
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
      <div className="container py-32">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-3xl font-black mb-4">Booking Not Found</h1>
          <p className="text-lg text-zayro-gray mb-8">
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
      <div className="container py-16 md:py-32">
        {/* Success Header */}
        <div className="max-w-4xl mx-auto mb-16">
          <div className="text-6xl md:text-8xl font-black mb-8 text-zayro-primary">
            ✓ CONFIRMED
          </div>
          <h1 className="text-4xl md:text-5xl font-black leading-tight">
            Your Booking Is Confirmed
          </h1>
          <p className="text-lg text-zayro-gray mt-6">
            Confirmation details have been sent to your email. You're all set!
          </p>
        </div>

        {/* Booking Details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-16">
          {/* Details Column */}
          <div className="md:col-span-2 space-y-12">
            {/* Booking ID */}
            <div className="border-b border-zayro-bg pb-8">
              <h3 className="text-sm font-bold text-zayro-gray uppercase mb-4">Booking ID</h3>
              <p className="text-2xl font-black font-mono">{booking.bookingId}</p>
            </div>

            {/* Service */}
            <div className="border-b border-zayro-bg pb-8">
              <h3 className="text-sm font-bold text-zayro-gray uppercase mb-4">Service</h3>
              <p className="text-3xl font-black">{booking.service.name}</p>
            </div>

            {/* Date & Time */}
            <div className="border-b border-zayro-bg pb-8">
              <h3 className="text-sm font-bold text-zayro-gray uppercase mb-4">Date & Time</h3>
              <p className="text-2xl font-black">
                {new Date(booking.bookingDate).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
              <p className="text-xl font-bold mt-2 text-zayro-primary">
                {booking.startTime} - {booking.endTime} ET
              </p>
              <p className="text-lg text-zayro-gray mt-2">
                Duration: {booking.durationMinutes} minutes
              </p>
            </div>

            {/* Customer Info */}
            <div className="border-b border-zayro-bg pb-8">
              <h3 className="text-sm font-bold text-zayro-gray uppercase mb-4">Customer Info</h3>
              <p className="text-lg font-bold">{booking.customerName}</p>
              <p className="text-lg">{booking.customerEmail}</p>
              <p className="text-lg">{booking.customerPhone}</p>
            </div>

            {/* Location */}
            <div>
              <h3 className="text-sm font-bold text-zayro-gray uppercase mb-4">Location</h3>
              <p className="text-lg font-bold">ZAYRO Studios</p>
              <p className="text-lg">40 W 37th St, Suite 603</p>
              <p className="text-lg">New York, NY 10018</p>
            </div>
          </div>

          {/* Pricing Column */}
          <div className="bg-white p-8 md:p-12 border border-zayro-bg h-fit">
            <h3 className="text-sm font-bold text-zayro-gray uppercase mb-8">Amount Paid</h3>
            <div className="text-4xl font-black text-zayro-primary mb-8">
              ${booking.totalAmount}
            </div>
            <div className="space-y-4 border-t border-zayro-bg pt-8">
              <p className="text-sm text-zayro-gray">
                A confirmation email has been sent. Check your spam folder if you don't see it.
              </p>
            </div>
          </div>
        </div>

        {/* Next Steps */}
        <div className="bg-white p-8 md:p-12 border border-zayro-bg max-w-2xl mx-auto mb-16">
          <h3 className="text-2xl font-bold mb-6">What's Next?</h3>
          <ul className="space-y-4 text-lg">
            <li className="flex gap-4">
              <span className="text-zayro-primary font-bold">→</span>
              <span>A calendar invite will be sent to your email shortly</span>
            </li>
            <li className="flex gap-4">
              <span className="text-zayro-primary font-bold">→</span>
              <span>Arrive 10 minutes early for your session</span>
            </li>
            <li className="flex gap-4">
              <span className="text-zayro-primary font-bold">→</span>
              <span>Questions? Contact us at hello@zayro.studio</span>
            </li>
          </ul>
        </div>

        {/* Action */}
        <div className="text-center">
          <Link href="/" className="button button-primary text-lg py-4 px-8">
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
