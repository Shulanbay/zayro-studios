'use client';

import { useEffect, useState } from 'react';

/**
 * Read-only integration diagnostics used on Admin → Integrations. Neither
 * ever shows a secret: Stripe's list API doesn't return signing secrets, and
 * the Google check only reports yes/no plus Google's own error text.
 */

export function StripeWebhookStatus() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [detail, setDetail] = useState<string>('');

  useEffect(() => {
    fetch('/api/admin/stripe-webhook-status')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setStatus('error');
          setDetail(data.error);
          return;
        }
        const live = (data.endpoints || []).find((e: { url: string }) => e.url.endsWith('/api/payment/webhook'));
        if (live) {
          setStatus('ok');
          setDetail(`${live.status} · events: ${live.enabled_events.join(', ')}`);
        } else {
          setStatus('missing');
          setDetail('No webhook endpoint found for /api/payment/webhook in this Stripe account.');
        }
      })
      .catch(() => {
        setStatus('error');
        setDetail('Could not reach Stripe.');
      });
  }, []);

  const color = status === 'ok' ? 'text-emerald-700' : status === 'loading' ? 'text-zayro-gray' : 'text-red-700';

  return (
    <section className="card">
      <h2 className="text-base font-semibold mb-3 text-zayro-dark">Stripe webhook endpoint</h2>
      <p className={`text-sm font-medium ${color}`} aria-live="polite">
        {status === 'loading' && 'Checking…'}
        {status === 'ok' && '✓ Configured'}
        {status === 'missing' && '✗ Not configured'}
        {status === 'error' && '✗ Could not check'}
      </p>
      {detail && <p className="text-xs text-zayro-gray mt-2 break-words">{detail}</p>}
      <p className="text-xs text-zayro-gray mt-3">
        Recommended events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, payment_intent.payment_failed, charge.refunded,
        refund.updated. The signing secret is never shown here.
      </p>
    </section>
  );
}

interface IntegrationCheck {
  ok: boolean;
  message: string;
  tabs?: { sheetName: string; ok: boolean; message: string }[];
}

export function GoogleConnectionTest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ calendar?: IntegrationCheck; sheets?: IntegrationCheck; error?: string } | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/integrations?check=1');
      const data = await response.json();
      setResult(response.ok ? data : { error: data.error || 'Check failed' });
    } catch {
      setResult({ error: 'Could not reach the server.' });
    } finally {
      setLoading(false);
    }
  };

  const line = (label: string, check?: IntegrationCheck) =>
    check && (
      <div className="text-xs mt-2">
        <span className={check.ok ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
          {check.ok ? '✓' : '✗'} {label}:
        </span>{' '}
        <span className="text-zayro-gray">{check.message}</span>
        {check.tabs?.map((t) => (
          <div key={t.sheetName} className="ml-4 mt-1">
            <span className={t.ok ? 'text-emerald-700' : 'text-red-700'}>{t.ok ? '✓' : '✗'}</span>{' '}
            <span className="text-zayro-gray">
              {t.sheetName}: {t.message}
            </span>
          </div>
        ))}
      </div>
    );

  return (
    <div className="mt-4" aria-live="polite">
      <button type="button" onClick={run} disabled={loading} className="crm-btn crm-btn-sm">
        {loading ? 'Checking…' : 'Test connection (read-only)'}
      </button>
      {result?.error && <p className="text-xs text-red-700 mt-2">{result.error}</p>}
      {line('Calendar', result?.calendar)}
      {line('Sheets', result?.sheets)}
    </div>
  );
}
