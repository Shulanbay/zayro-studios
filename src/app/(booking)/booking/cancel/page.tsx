'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface HoldStatus {
  valid: boolean;
  expiresAt?: string;
  status?: string;
}

export default function CancelPage() {
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
      <div className="container py-16 md:py-32">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-6xl md:text-8xl font-black leading-tight mb-12">
            CHECKOUT<br />CANCELLED
          </h1>

          <div className="bg-white p-8 md:p-12 border border-zayro-bg mb-12 space-y-8">
            <div>
              <h2 className="text-2xl font-bold mb-4">Payment Not Completed</h2>
              <p className="text-lg text-zayro-gray">
                Your payment was not processed. No charge has been made to your card.
              </p>
            </div>

            {loading ? (
              <p className="text-lg">Checking hold status...</p>
            ) : holdStatus?.valid ? (
              <div>
                <h3 className="text-xl font-bold mb-4 text-zayro-primary">
                  Good News: Your Time Slot Is Still Reserved
                </h3>
                <p className="text-lg text-zayro-gray mb-6">
                  Your 15-minute hold is still valid. You can return to complete your booking.
                </p>
                <Link href="/booking" className="button button-primary inline-block">
                  Return to Checkout →
                </Link>
              </div>
            ) : (
              <div>
                <h3 className="text-xl font-bold mb-4 text-red-900">
                  Booking Hold Expired
                </h3>
                <p className="text-lg text-zayro-gray mb-6">
                  Your 15-minute hold has expired. Please select a new time slot to continue.
                </p>
                <Link href="/booking" className="button button-primary inline-block">
                  Book Again →
                </Link>
              </div>
            )}
          </div>

          <div className="space-y-8">
            <div>
              <h3 className="text-xl font-bold mb-4">What Happened?</h3>
              <p className="text-lg text-zayro-gray">
                You cancelled the Stripe checkout flow. This might happen if:
              </p>
              <ul className="list-disc list-inside text-lg text-zayro-gray mt-4 space-y-2">
                <li>You clicked the back button in the payment form</li>
                <li>You closed the payment window</li>
                <li>You encountered an issue during checkout</li>
              </ul>
            </div>

            <div>
              <h3 className="text-xl font-bold mb-4">Need Help?</h3>
              <p className="text-lg text-zayro-gray">
                If you experienced any issues, please contact us:
              </p>
              <p className="text-lg mt-4">
                <a href="mailto:hello@zayro.studio" className="text-zayro-primary font-bold hover:underline">
                  hello@zayro.studio
                </a>
              </p>
            </div>
          </div>

          <div className="mt-16">
            <Link href="/" className="text-zayro-primary hover:text-zayro-dark transition-colors text-lg font-medium">
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
