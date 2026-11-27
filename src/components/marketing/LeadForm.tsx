'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { trackConversion, trackEvent } from '@/lib/analytics/browser/tracker';

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'] as const;
const CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'rdt_cid', 'epik', 'twclid'] as const;

/**
 * Lead capture on landing pages. Sends the page's UTM parameters (and, the
 * server decides with consent, ad click IDs) so the CRM shows where the lead
 * came from. A hidden honeypot field stops simple bots.
 */
export default function LeadForm({
  slug,
  askEmail,
  askMessage,
  submitLabel,
  successMessage,
  whatsapp,
  telegram,
}: {
  slug: string;
  askEmail: boolean;
  askMessage: boolean;
  submitLabel: string;
  successMessage: string;
  whatsapp: string | null;
  telegram: string | null;
}) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', message: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  // Captured at load: the tracker removes click IDs from the address bar shortly after.
  const touch = useRef<{ utm: Record<string, string>; clickIds: Record<string, string>; referrer: string }>({ utm: {}, clickIds: {}, referrer: '' });

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    for (const k of UTM) if (q.get(k)) touch.current.utm[k] = q.get(k)!;
    for (const k of CLICK_IDS) if (q.get(k)) touch.current.clickIds[k] = q.get(k)!;
    if (q.get('click_id')) touch.current.clickIds.custom = q.get('click_id')!;
    touch.current.referrer = document.referrer;
  }, []);

  const onFocus = () => {
    if (started.current) return;
    started.current = true;
    trackEvent('contact_started', { topic: 'general' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    setError(null);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          website: (document.getElementById(`lead-website-${slug}`) as HTMLInputElement | null)?.value || undefined,
          touch: { landingSlug: slug, pagePath: window.location.pathname, ...touch.current },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState('error');
        setError(data.error || 'Could not send. Please try again or message us.');
        return;
      }
      trackConversion(data.conversion);
      setState('sent');
    } catch {
      setState('error');
      setError('Network error. Please try again or message us.');
    }
  };

  if (state === 'sent') {
    return (
      <div className="card text-center" role="status">
        <p className="text-xl font-bold text-zayro-dark">{successMessage}</p>
      </div>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="card">
      <form onSubmit={submit} onFocus={onFocus} className="grid gap-4" noValidate={false}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label" htmlFor={`lead-name-${slug}`}>
              Name
            </label>
            <input id={`lead-name-${slug}`} required maxLength={200} autoComplete="name" value={form.name} onChange={set('name')} />
          </div>
          <div>
            <label className="field-label" htmlFor={`lead-phone-${slug}`}>
              Phone
            </label>
            <input id={`lead-phone-${slug}`} type="tel" required maxLength={40} autoComplete="tel" inputMode="tel" value={form.phone} onChange={set('phone')} />
          </div>
        </div>
        {askEmail && (
          <div>
            <label className="field-label" htmlFor={`lead-email-${slug}`}>
              Email <span className="text-zayro-gray font-normal">(optional)</span>
            </label>
            <input id={`lead-email-${slug}`} type="email" maxLength={255} autoComplete="email" value={form.email} onChange={set('email')} />
          </div>
        )}
        {askMessage && (
          <div>
            <label className="field-label" htmlFor={`lead-message-${slug}`}>
              Tell us about your project <span className="text-zayro-gray font-normal">(optional)</span>
            </label>
            <textarea id={`lead-message-${slug}`} rows={4} maxLength={3000} value={form.message} onChange={set('message')} />
          </div>
        )}
        <div className="absolute -left-[9999px] w-px h-px overflow-hidden" aria-hidden="true">
          <label htmlFor={`lead-website-${slug}`}>Website</label>
          <input id={`lead-website-${slug}`} name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={`button button-primary w-full py-3 ${state === 'sending' ? 'is-loading' : ''}`} disabled={state === 'sending'}>
          {submitLabel}
        </button>
        <p className="text-xs text-zayro-gray text-center">
          We use your details only to reply to this request. See our <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </form>
      {(whatsapp || telegram) && (
        <div className="mt-5 pt-5 border-t border-zayro-border flex flex-col sm:flex-row gap-3 justify-center">
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noopener" className="button button-secondary">
              WhatsApp
            </a>
          )}
          {telegram && (
            <a href={telegram} target="_blank" rel="noopener" className="button button-secondary">
              Telegram
            </a>
          )}
        </div>
      )}
    </div>
  );
}
