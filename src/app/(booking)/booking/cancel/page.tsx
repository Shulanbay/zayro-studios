'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface HoldStatus {
  valid: boolean;
  expiresAt?: string;
  status?: string;
}

function CancelContent() {
  const searchParams = useSearchParams();
  const holdId = searchParams.get('hold_id');

  const [holdStatus, setHoldStatus] = useState<HoldStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkHold() {
      if (!holdId) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/booking/validate-hold', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hold_id: holdId }),
        });

        const data = await response.json();
        setHoldStatus(data);
      } catch (err) {
        console.error('Error checking hold:', err);
        setHoldStatus({ valid: false });
      } finally {
        setLoading(false);
      }
    }

    checkHold();
  }, [holdId]);

  return (
    <main className="min-h-screen bg-zayro-bg">
      <div className="container py-16 md:py-24">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-black leading-tight mb-10 text-zayro-dark">
            Checkout Cancelled
          </h1>

          <div className="card mb-8 space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-2 text-zayro-dark">Payment Not Completed</h2>
              <p className="text-zayro-gray">Your payment was not processed. No charge has been made to your card.</p>
            </div>

            {loading ? (
              <div className="flex items-center gap-3 text-zayro-gray" aria-busy="true">
                <span className="spinner" aria-hidden="true" />
                Checking hold status...
              </div>
            ) : holdStatus?.valid ? (
              <div>
                <p className="chip mb-4" role="status">
                  <span className="chip-dot" aria-hidden="true" />
                  Your time slot is still reserved
                </p>
                <p className="text-zayro-gray mb-6">Your hold is still valid — you can return to complete your booking.</p>
                <Link href="/booking" className="button button-primary inline-block">
                  Return to Checkout
                </Link>
              </div>
            ) : (
              <div>
                <h3 className="text-lg font-bold mb-2 text-zayro-dark">Booking Hold Expired</h3>
                <p className="text-zayro-gray mb-6">Your hold has expired. Please select a new time slot to continue.</p>
                <Link href="/booking" className="button button-primary inline-block">
                  Book Again
                </Link>
              </div>
            )}
          </div>

          <div className="card mb-8">
            <h3 className="text-lg font-bold mb-3 text-zayro-dark">What Happened?</h3>
            <p className="text-zayro-gray mb-3">You cancelled the Stripe checkout flow. This might happen if:</p>
            <ul className="list-disc list-inside text-zayro-gray space-y-1">
              <li>You clicked the back button in the payment form</li>
              <li>You closed the payment window</li>
              <li>You encountered an issue during checkout</li>
            </ul>
          </div>

          <div className="card mb-10">
            <h3 className="text-lg font-bold mb-3 text-zayro-dark">Need Help?</h3>
            <p className="text-zayro-gray">
              If you experienced any issues, contact us at{' '}
              <a href="mailto:hello@zayro.studio" className="text-zayro-primary font-bold">
                hello@zayro.studio
              </a>
            </p>
          </div>

          <Link href="/" className="text-zayro-primary hover:text-zayro-dark transition-colors font-medium">
            ← Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function CancelPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <CancelContent />
    </Suspense>
  );
}
