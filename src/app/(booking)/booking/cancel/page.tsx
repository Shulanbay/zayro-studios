'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

type Outcome = 'working' | 'released' | 'paid' | 'gone' | 'error';

/**
 * Stripe sends the customer here when they leave Checkout. The reserved
 * slot is given back straight away (and the Checkout session expired, so an
 * old tab can't be paid later); if the payment actually went through in the
 * meantime, we say so instead.
 */
function CancelContent() {
  const searchParams = useSearchParams();
  const holdId = searchParams.get('hold_id');
  const [outcome, setOutcome] = useState<Outcome>(holdId ? 'working' : 'gone');

  useEffect(() => {
    if (!holdId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/booking/release-hold', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hold_id: holdId }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) return setOutcome('error');
        if (data.paid) return setOutcome('paid');
        setOutcome(data.released ? 'released' : 'gone');
      } catch {
        if (!cancelled) setOutcome('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [holdId]);

  return (
    <div className="container py-16 md:py-24">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-black leading-tight mb-8 text-zayro-dark">
          {outcome === 'paid' ? 'Your payment went through' : 'Payment not completed'}
        </h1>

        <div className="card mb-8" aria-live="polite">
          {outcome === 'working' && (
            <p className="flex items-center gap-3 text-zayro-gray" aria-busy="true">
              <span className="spinner" aria-hidden="true" />
              Releasing your reserved time…
            </p>
          )}
          {(outcome === 'released' || outcome === 'gone') && (
            <>
              <p className="text-zayro-gray mb-6">
                No payment was taken{outcome === 'released' ? ' and the time you picked has been released' : ''}. You can
                choose a time again whenever you&apos;re ready.
              </p>
              <Link href="/booking" className="button button-primary">
                Choose a time
              </Link>
            </>
          )}
          {outcome === 'paid' && (
            <>
              <p className="text-zayro-gray mb-6">
                Stripe has already completed this payment, so your booking is being confirmed. You&apos;ll receive a
                confirmation email shortly.
              </p>
              <Link href="/" className="button button-primary">
                Back to home
              </Link>
            </>
          )}
          {outcome === 'error' && (
            <>
              <p className="text-zayro-gray mb-6">
                No payment was taken. Your reserved time will be released automatically within about 30 minutes.
              </p>
              <Link href="/booking" className="button button-primary">
                Back to booking
              </Link>
            </>
          )}
        </div>

        <p className="text-zayro-gray">
          Need help? Email{' '}
          <a href="mailto:hello@zayro.studio" className="text-zayro-primary font-bold">
            hello@zayro.studio
          </a>
          .
        </p>
      </div>
    </div>
  );
}

export default function CancelPage() {
  return (
    <div className="min-h-screen bg-zayro-bg">
      <Suspense
        fallback={
          <div className="container py-24 text-center" aria-busy="true">
            <div className="spinner mx-auto" aria-hidden="true" />
          </div>
        }
      >
        <CancelContent />
      </Suspense>
    </div>
  );
}
