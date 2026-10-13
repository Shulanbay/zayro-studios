'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import BookingFlow from '@/components/booking/BookingFlow';
import { formatTimeLabel } from '@/lib/crm/time';

interface PackageData {
  id: string; name: string; serviceId: number; durationMinutes: number; remaining: number; total: number; expiresAt: string; expiresOn: string; canBook: boolean; orderNumber: string; privateLink: string;
  customer: { firstName: string; lastName: string; email: string; phone: string; company: string; notes: string };
  sessions: { bookingId: string; date: string; start: string; end: string; status: string }[];
}
export default function PackageManager() {
  const [pkg, setPkg] = useState<PackageData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [booking, setBooking] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    setError(''); setBusy(true);
    try {
      const query = new URLSearchParams(window.location.search);
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = fragment.get('access'); const sessionId = query.get('session_id');
      if (token || sessionId) {
        const r = await fetch('/api/packages/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(token ? { token } : { sessionId }) });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Could not verify payment.');
        window.history.replaceState(null, '', '/packages/manage');
      }
      const r = await fetch('/api/packages/status', { cache: 'no-store' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not load your package.');
      setPkg(data);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (booking && pkg) return <BookingFlow packageBooking={{ id: pkg.id, name: pkg.name, serviceId: pkg.serviceId, expiresOn: pkg.expiresOn, expiresAt: pkg.expiresAt, customer: pkg.customer }} onPackageBooked={(id) => { setBooking(false); setConfirmation(`Session confirmed — ${id}`); void load(); }} onPackageExit={() => setBooking(false)} />;
  return <div className="container py-12 md:py-20 max-w-4xl">
    <h1 className="text-4xl md:text-5xl font-black text-zayro-dark mb-6">Your monthly package</h1>
    {busy && <p role="status">Checking your package…</p>}
    {error && <div className="card"><p className="form-error-banner mb-5" role="alert">{error}</p><button className="button button-secondary" onClick={() => void load()}>Try again</button><Link href="/contact" className="text-zayro-primary font-semibold ml-4">Contact the studio</Link></div>}
    {confirmation && <p className="card mb-6 text-zayro-primary font-semibold" role="status">{confirmation}. Your confirmation email includes the date and time.</p>}
    {pkg && !error && <>
      <div className="card mb-8"><h2 className="text-2xl font-black mb-4">{pkg.name}</h2>
        <p className="text-3xl font-black text-zayro-primary mb-2">{pkg.remaining} of {pkg.total} sessions remaining</p>
        <p className="text-zayro-gray">Valid until {new Date(pkg.expiresAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET · Order {pkg.orderNumber}</p>
        {pkg.canBook ? <button className="button button-primary mt-6 w-full sm:w-auto" onClick={() => setBooking(true)}>Choose a session date</button> : <p className="mt-5 font-semibold">{pkg.remaining === 0 ? 'All sessions have been used.' : 'This package is no longer available for booking.'}</p>}
        <p className="text-sm text-zayro-gray mt-5">Book one session at a time. Sessions must take place within the package validity period.</p>
        <button className="text-zayro-primary font-semibold mt-4 underline" onClick={async () => { try { await navigator.clipboard.writeText(new URL(pkg.privateLink, window.location.origin).href); setCopied(true); } catch { setError('Could not copy the link. Open your confirmation email to find it.'); } }}>{copied ? 'Private link copied' : 'Copy my private package link'}</button>
      </div>
      <h2 className="text-2xl font-bold mb-4">Your sessions</h2>
      {pkg.sessions.length === 0 ? <p className="text-zayro-gray mb-8">No dates selected yet. Choose your first session whenever you&apos;re ready.</p> : <ul className="space-y-4 mb-8">{pkg.sessions.map((s) => <li className="card" key={s.bookingId}><p className="font-bold">{s.date} · {formatTimeLabel(s.start)} – {formatTimeLabel(s.end)} ET</p><p className="text-zayro-gray mt-1">{s.bookingId} · {s.status.replace('_', ' ')}</p></li>)}</ul>}
      <p className="text-zayro-gray">Need to change or cancel a date? <Link href="/contact" className="text-zayro-primary font-semibold underline">Contact the studio</Link>.</p>
      <Link href="/pricing#monthly" className="button button-secondary mt-6">Explore Monthly Packages</Link>
    </>}
  </div>;
}
