'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import type { ConsentAction, ConsentState } from '@/lib/analytics/consent';

/**
 * Cookie consent banner and preferences. No dark patterns: "Reject
 * non-essential" is the same size, style and position weight as "Accept
 * all"; nothing is pre-ticked; closing without a choice keeps everything
 * except necessary cookies off.
 */
export default function ConsentBanner({
  consent,
  open,
  canClose,
  onDecide,
  onClose,
}: {
  consent: ConsentState | null;
  open: boolean;
  canClose: boolean;
  onDecide: (action: ConsentAction, custom?: { analytics: boolean; advertising: boolean }) => void;
  onClose: () => void;
}) {
  const [customize, setCustomize] = useState(false);
  const [analytics, setAnalytics] = useState(consent?.analytics ?? false);
  const [advertising, setAdvertising] = useState(consent?.advertising ?? false);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setAnalytics(consent?.analytics ?? false);
    setAdvertising(consent?.advertising ?? false);
    setCustomize(!!consent);
  }, [open, consent]);

  useEffect(() => {
    if (!open || !canClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLElement>('button, input')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, canClose, onClose]);

  if (!open) return null;

  const btn = 'flex-1 min-w-[9rem] rounded-full !border-2 !border-solid !border-zayro-dark px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zayro-primary focus-visible:ring-offset-2';

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4 pointer-events-none">
      <div
        ref={panel}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border border-zayro-border bg-white text-zayro-dark shadow-2xl p-4 sm:p-6 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-bold">
            Cookies and privacy choices
          </h2>
          {canClose && (
            <button type="button" onClick={onClose} className="text-zayro-gray hover:text-zayro-dark px-2 -mr-2 text-xl leading-none" aria-label="Close cookie preferences">
              ×
            </button>
          )}
        </div>
        <p className="text-sm text-zayro-gray mt-2">
          We use necessary cookies to run bookings, payments and security. With your permission we also measure visits (analytics) and the results of our ads
          (advertising: Google, Meta, Reddit, Pinterest, TikTok). You can change this any time under “Cookie preferences” in the footer.{' '}
          <Link href="/privacy#cookies" className="underline font-medium text-zayro-dark">
            Privacy Policy
          </Link>
        </p>

        {customize && (
          <fieldset className="mt-4 space-y-3">
            <legend className="sr-only">Cookie categories</legend>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked disabled className="mt-0.5 h-5 w-5 flex-shrink-0 accent-zayro-primary" aria-describedby={`${titleId}-nec`} />
              <span>
                <span className="font-semibold">Necessary</span> — always on
                <span id={`${titleId}-nec`} className="block text-zayro-gray">
                  Booking state, secure checkout with Stripe, admin sign-in, Manage Booking, fraud and spam protection.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="mt-0.5 h-5 w-5 flex-shrink-0 accent-zayro-primary" />
              <span>
                <span className="font-semibold">Analytics</span>
                <span className="block text-zayro-gray">Our own visit statistics (a random visitor ID, no name or email) and Google Analytics 4.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input type="checkbox" checked={advertising} onChange={(e) => setAdvertising(e.target.checked)} className="mt-0.5 h-5 w-5 flex-shrink-0 accent-zayro-primary" />
              <span>
                <span className="font-semibold">Advertising</span>
                <span className="block text-zayro-gray">
                  Google Ads, Meta (Facebook/Instagram), Reddit, Pinterest and TikTok tags and their server-side conversion APIs, to measure which ads lead to bookings.
                  Ad click identifiers are kept only with this permission.
                </span>
              </span>
            </label>
          </fieldset>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={`${btn} bg-zayro-dark text-white hover:bg-black`} onClick={() => onDecide('accept_all')}>
            Accept all
          </button>
          <button type="button" className={`${btn} bg-zayro-dark text-white hover:bg-black`} onClick={() => onDecide('reject_all')}>
            Reject non-essential
          </button>
          {customize ? (
            <button type="button" className={`${btn} bg-white hover:bg-zayro-bg`} onClick={() => onDecide('custom', { analytics, advertising })}>
              Save my choices
            </button>
          ) : (
            <button type="button" className={`${btn} bg-white hover:bg-zayro-bg`} onClick={() => setCustomize(true)} aria-expanded={false}>
              Customize
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
