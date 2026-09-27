'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { formatBookingDateUTC } from '@/lib/utils';
import { formatDuration } from '@/lib/catalog';
import { formatTimeLabel } from '@/lib/crm/time';

interface BookingSummary {
  bookingId: string;
  service: { name: string; category: string };
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  totalAmount: string;
  isFree: boolean;
  firstName: string;
  emailHint: string;
}

type View =
  | { kind: 'loading' }
  | { kind: 'confirmed'; booking: BookingSummary }
  | { kind: 'processing' }
  | { kind: 'needs_review'; bookingId?: string }
  | { kind: 'problem'; message: string };

/** The webhook normally confirms within seconds; keep checking for about a minute. */
const POLL_INTERVAL_MS = 2500;
const POLL_ATTEMPTS = 24;

function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const bookingId = searchParams.get('booking_id');
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    if (!sessionId && !bookingId) {
      setView({ kind: 'problem', message: 'This page needs a booking reference. Please check your confirmation email.' });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async (attempt: number) => {
      try {
        // The server (database + Stripe), never the URL, decides what this page shows.
        const res = await fetch(sessionId ? '/api/booking/verify-session' : '/api/booking/verify-booking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sessionId ? { sessionId } : { bookingId }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.status === 'confirmed' && data.booking) {
          try {
            sessionStorage.removeItem('zayro-booking-state-v2');
          } catch {
            // ignore
          }
          return setView({ kind: 'confirmed', booking: data.booking });
        }
        if (data.status === 'needs_review') return setView({ kind: 'needs_review', bookingId: data.bookingId });
        if (data.status === 'cancelled') {
          return setView({ kind: 'problem', message: 'This booking has been cancelled. If you think this is a mistake, please contact us.' });
        }
        const waiting = !res.ok || data.status === 'processing' || data.status === 'pending';
        if (waiting && attempt < POLL_ATTEMPTS) {
          if (data.status === 'processing') setView({ kind: 'processing' });
          timer = setTimeout(() => check(attempt + 1), POLL_INTERVAL_MS);
          return;
        }
        if (data.status === 'processing') return setView({ kind: 'processing' });
        setView({
          kind: 'problem',
          message: sessionId
            ? 'We haven’t received a completed payment for this checkout. If you were charged, your confirmation email will follow shortly.'
            : 'We couldn’t find a confirmed booking with this reference.',
        });
      } catch {
        if (cancelled) return;
        if (attempt < POLL_ATTEMPTS) {
          timer = setTimeout(() => check(attempt + 1), POLL_INTERVAL_MS);
          return;
        }
        setView({ kind: 'problem', message: 'We couldn’t check your booking right now. Your confirmation email has the details.' });
      }
    };

    check(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, bookingId]);

  if (view.kind === 'loading' || view.kind === 'processing') {
    return (
      <div className="container py-24 md:py-32 text-center" aria-busy="true">
        <div className="spinner mx-auto mb-6" style={{ width: '2rem', height: '2rem' }} aria-hidden="true" />
        <h1 className="text-3xl font-black mb-2 text-zayro-dark">
          {view.kind === 'processing' ? 'Payment received — confirming your booking…' : 'Checking your booking…'}
        </h1>
        <p className="text-lg text-zayro-gray" role="status">
          This usually takes a few seconds. Please keep this page open.
        </p>
      </div>
    );
  }

  if (view.kind === 'needs_review') {
    return (
      <div className="container py-24 md:py-32">
        <div className="max-w-xl mx-auto card">
          <h1 className="text-2xl font-black mb-4 text-zayro-dark">We received your payment</h1>
          <p className="text-zayro-gray mb-4">
            Unfortunately this time is no longer available, so the booking couldn&apos;t be confirmed automatically. We&apos;ve been
            notified and will contact you shortly to rebook or refund you in full.
          </p>
          {view.bookingId && (
            <p className="text-sm text-zayro-gray mb-6">
              Reference: <span className="font-mono font-bold text-zayro-dark">{view.bookingId}</span>
            </p>
          )}
          <p className="text-sm text-zayro-gray">
            Questions?{' '}
            <a href="mailto:hello@zayro.studio" className="text-zayro-primary font-bold">
              hello@zayro.studio
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (view.kind === 'problem') {
    return (
      <div className="container py-24 md:py-32">
        <div className="max-w-xl mx-auto card">
          <h1 className="text-2xl font-black mb-4 text-zayro-dark">We couldn&apos;t confirm that yet</h1>
          <p className="text-zayro-gray mb-6" role="alert">
            {view.message}
          </p>
          <p className="text-zayro-gray mb-8 text-sm">
            Questions about a payment or booking? Email{' '}
            <a href="mailto:hello@zayro.studio" className="text-zayro-primary font-bold">
              hello@zayro.studio
            </a>
            .
          </p>
          <Link href="/booking" className="button button-primary">
            Back to booking
          </Link>
        </div>
      </div>
    );
  }

  const b = view.booking;
  const isTour = b.service.category === 'tour';
  return (
    <div className="container py-16 md:py-24">
      <div className="max-w-3xl mx-auto text-center mb-12">
        <span className="chip mb-6" role="status">
          <span className="chip-dot" aria-hidden="true" />
          Confirmed
        </span>
        <h1 className="text-4xl md:text-5xl font-black leading-tight text-zayro-dark">
          {isTour ? 'Your studio tour is booked' : 'Your booking is confirmed'}
        </h1>
        <p className="text-lg text-zayro-gray mt-4">
          Thanks{b.firstName ? `, ${b.firstName}` : ''}. A confirmation email is on its way{b.emailHint ? ` to ${b.emailHint}` : ''}.
        </p>
      </div>

      <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <dl className="card md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="sm:col-span-2">
            <dt className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-1">Booking ID</dt>
            <dd className="text-xl font-black font-mono text-zayro-dark break-all">{b.bookingId}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-1">Service</dt>
            <dd className="text-2xl font-black text-zayro-dark">{b.service.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-1">Date</dt>
            <dd className="text-lg font-bold text-zayro-dark">{formatBookingDateUTC(b.bookingDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-1">Time (ET)</dt>
            <dd className="text-lg font-bold text-zayro-dark">
              {formatTimeLabel(b.startTime)} – {formatTimeLabel(b.endTime)}
              <span className="block text-sm font-normal text-zayro-gray">{formatDuration(b.durationMinutes)}</span>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-1">Location</dt>
            <dd className="text-zayro-dark">ZAYRO Studios · 40 W 37th St, Suite 603, New York, NY 10018</dd>
          </div>
        </dl>

        <div className="card h-fit">
          <h2 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-4">{b.isFree ? 'Price' : 'Amount paid'}</h2>
          <p className="text-4xl font-black text-zayro-primary">{b.isFree ? 'Free' : `$${b.totalAmount}`}</p>
        </div>
      </div>

      <div className="card max-w-3xl mx-auto mb-12">
        <h2 className="text-xl font-bold mb-4 text-zayro-dark">What&apos;s next</h2>
        <ul className="space-y-3 text-zayro-gray">
          <li className="flex gap-3">
            <span className="text-zayro-primary font-bold" aria-hidden="true">
              →
            </span>
            <span>Please arrive about 10 minutes early.</span>
          </li>
          <li className="flex gap-3">
            <span className="text-zayro-primary font-bold" aria-hidden="true">
              →
            </span>
            <span>
              Need to change or cancel? Reply to your confirmation email or write to{' '}
              <a href="mailto:hello@zayro.studio" className="text-zayro-primary font-semibold">
                hello@zayro.studio
              </a>{' '}
              with your booking ID.
            </span>
          </li>
        </ul>
      </div>

      <div className="text-center">
        <Link href="/" className="button button-secondary px-8">
          Back to home
        </Link>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <div className="min-h-screen bg-zayro-bg">
      <Suspense
        fallback={
          <div className="container py-24 text-center" aria-busy="true">
            <div className="spinner mx-auto" aria-hidden="true" />
          </div>
        }
      >
        <SuccessContent />
      </Suspense>
    </div>
  );
}
