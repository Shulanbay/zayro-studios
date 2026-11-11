'use client';

import { useState } from 'react';
import Link from 'next/link';

/** Ask for a new Manage Booking link (sent only to the email on the booking). Inherits noindex from /booking/manage. */
export default function RequestLinkPage() {
  const [reference, setReference] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!reference.trim() || !email.trim()) return setError('Please enter your booking reference and email.');
    setBusy(true);
    try {
      const res = await fetch('/api/booking/manage/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, email, website: (document.getElementById('website') as HTMLInputElement | null)?.value || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.message) setMessage(data.message);
      else setError(data.error || 'Something went wrong. Please try again in a few minutes.');
    } catch {
      setError('We could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container py-16 md:py-24 max-w-2xl">
      <h1 className="text-[clamp(2rem,9vw,3rem)] font-black text-zayro-dark mb-4">Request a new link</h1>
      <p className="text-zayro-gray mb-8">
        Enter your booking reference (for example ZAY-…) and the email you booked with. We&apos;ll email a secure link to manage your booking.
      </p>
      <div aria-live="polite">
        {message && (
          <p className="card mb-6 font-semibold text-zayro-dark" role="status">
            {message}
          </p>
        )}
      </div>
      {!message && (
        <form onSubmit={submit} className="card space-y-5" noValidate>
          <div>
            <label htmlFor="reference" className="field-label">
              Booking reference
            </label>
            <input id="reference" name="reference" autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="email" className="field-label">
              Email used for the booking
            </label>
            <input id="email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {/* Honeypot: hidden from people, filled in by bots. */}
          <input id="website" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
          <div aria-live="assertive">
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <button type="submit" disabled={busy} className={`button button-primary w-full sm:w-auto ${busy ? 'is-loading' : ''}`}>
            Email me a link
          </button>
        </form>
      )}
      <p className="mt-8 text-sm text-zayro-gray">
        Need help?{' '}
        <a href="mailto:hello@zayro.studio" className="text-zayro-primary font-semibold">
          hello@zayro.studio
        </a>
        {' · '}
        <Link href="/booking" className="text-zayro-primary font-semibold">
          Book a session
        </Link>
      </p>
    </div>
  );
}
