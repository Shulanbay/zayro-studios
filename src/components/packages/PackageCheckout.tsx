'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDuration } from '@/lib/catalog';

interface Offer { name: string; sessions: number; validityDays: number; service: string; durationMinutes: number; subtotal: number; tax: number; total: number }
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export default function PackageCheckout() {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serviceId, setServiceId] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const requestId = useRef('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get('package'));
    setServiceId(id);
    setCancelled(params.has('cancelled'));
    requestId.current = crypto.randomUUID();
    fetch(`/api/packages/offer?package=${id}`).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'This package is unavailable.');
      setOffer(data);
    }).catch((e) => setError(e.message));
  }, []);
  async function checkout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/packages/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestId.current, serviceId, ...Object.fromEntries(form) }) });
      const data = await r.json();
      if (data.alreadyPaid && data.sessionId) { window.location.assign(`/packages/manage?session_id=${encodeURIComponent(data.sessionId)}`); return; }
      if (!r.ok || !data.checkoutUrl) {
        if (r.status === 410) requestId.current = crypto.randomUUID();
        throw new Error(data.error || 'Could not start payment. Please try again.');
      }
      window.location.assign(data.checkoutUrl);
    } catch (e) { setError((e as Error).message); setLoading(false); }
  }
  return <div className="container py-12 md:py-20 max-w-3xl">
    <Link href="/pricing#monthly" className="text-zayro-primary font-semibold">← Monthly Packages</Link>
    <h1 className="text-4xl md:text-5xl font-black text-zayro-dark mt-6 mb-4">Buy now. Choose dates later.</h1>
    {cancelled && <p className="text-zayro-gray mb-6">Checkout was cancelled. Your package will only be activated after payment.</p>}
    {error && <p className="form-error-banner mb-6" role="alert">{error}</p>}
    {!offer && !error && <p role="status">Loading your package…</p>}
    {offer && <>
      <div className="card mb-8">
        <h2 className="text-2xl font-black text-zayro-dark mb-3">{offer.name}</h2>
        <p className="text-zayro-gray">{offer.sessions} {offer.service} sessions · {formatDuration(offer.durationMinutes)} each</p>
        <p className="text-zayro-gray mt-3">Valid for {offer.validityDays} days from payment. Book each session separately after purchase, subject to availability. One-time payment with no automatic renewal.</p>
        <dl className="mt-6 space-y-2"><div className="flex justify-between"><dt>Package</dt><dd>{money(offer.subtotal)}</dd></div>{offer.tax > 0 && <div className="flex justify-between"><dt>Tax</dt><dd>{money(offer.tax)}</dd></div>}<div className="flex justify-between text-2xl font-black"><dt>Total</dt><dd>{money(offer.total)}</dd></div></dl>
      </div>
      <form onSubmit={checkout} className="card space-y-5">
        <h2 className="text-xl font-bold">Your details</h2>
        <div className="grid sm:grid-cols-2 gap-5"><div><label htmlFor="firstName" className="field-label">First name</label><input id="firstName" name="firstName" autoComplete="given-name" maxLength={100} required /></div><div><label htmlFor="lastName" className="field-label">Last name</label><input id="lastName" name="lastName" autoComplete="family-name" maxLength={100} required /></div></div>
        <div><label htmlFor="email" className="field-label">Email</label><input id="email" name="email" type="email" autoComplete="email" maxLength={255} required /><p className="text-sm text-zayro-gray mt-2">We&apos;ll email your private link to choose dates and view remaining sessions.</p></div>
        <div><label htmlFor="phone" className="field-label">Phone</label><input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={20} required /></div>
        <div><label htmlFor="company" className="field-label">Company / show name (optional)</label><input id="company" name="company" autoComplete="organization" maxLength={255} /></div>
        <div className="hidden" aria-hidden="true"><input name="website" tabIndex={-1} autoComplete="off" /></div>
        <button className="button button-primary w-full" type="submit" disabled={loading}>{loading ? 'Opening secure checkout…' : `Pay ${money(offer.total)} with Stripe`}</button>
        <p className="text-sm text-zayro-gray">You&apos;ll choose your dates after payment. Each booking uses one session from your package.</p>
      </form>
    </>}
  </div>;
}
