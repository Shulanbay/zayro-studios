'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/components/crm/i18n';
import { useApiMessage } from '@/components/crm/client';

/**
 * Read-only integration diagnostics used on Admin → Integrations. Neither
 * ever shows a secret: Stripe's list API doesn't return signing secrets, and
 * the Google check only reports yes/no plus Google's own error text.
 */

export function StripeWebhookStatus() {
  const { t } = useI18n();
  const apiMessage = useApiMessage();
  const [status, setStatus] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [detail, setDetail] = useState<string>('');
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);

  const addEvents = async () => {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/stripe-webhook-status', { method: 'POST' });
      const data = await res.json();
      setMessage(res.ok ? apiMessage(data.message) : data.error ? apiMessage(data.error, res.status) : t('integrations.stripe.updateFailed'));
      if (res.ok) setReload((n) => n + 1);
    } catch {
      setMessage(t('integrations.stripe.serverUnreachable'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    fetch('/api/admin/stripe-webhook-status')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setStatus('error');
          setDetail(apiMessage(data.error));
          return;
        }
        const live = (data.endpoints || []).find((e: { url: string }) => e.url.endsWith('/api/payment/webhook'));
        if (live) {
          setStatus('ok');
          setMissing(live.missing_events || []);
          setDetail(t('integrations.stripe.detail', { status: live.status, mode: data.livemode ? t('integrations.stripe.live') : t('integrations.stripe.test'), events: live.enabled_events.join(', ') }));
        } else {
          setStatus('missing');
          setDetail(t('integrations.stripe.noEndpoint'));
        }
      })
      .catch(() => {
        setStatus('error');
        setDetail(t('integrations.stripe.unreachable'));
      });
    // Text is re-derived on the next check; the request depends only on `reload`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const color = status === 'ok' ? 'text-emerald-700' : status === 'loading' ? 'text-zayro-gray' : 'text-red-700';

  return (
    <section className="card">
      <h2 className="text-base font-semibold mb-3 text-zayro-dark">{t('integrations.stripe.title')}</h2>
      <p className={`text-sm font-medium ${color}`} aria-live="polite">
        {status === 'loading' && t('integrations.stripe.checking')}
        {status === 'ok' && t('integrations.stripe.ok')}
        {status === 'missing' && t('integrations.stripe.missing')}
        {status === 'error' && t('integrations.stripe.error')}
      </p>
      {detail && <p className="text-xs text-zayro-gray mt-2 break-words">{detail}</p>}
      {missing.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-amber-800">{t('integrations.stripe.missingEvents', { events: missing.join(', ') })}</p>
          <button type="button" className="crm-btn crm-btn-sm mt-2" onClick={addEvents} disabled={busy}>
            {busy ? t('integrations.stripe.updating') : t('integrations.stripe.addEvents')}
          </button>
        </div>
      )}
      {message && <p className="text-xs mt-2" role="status">{message}</p>}
      <p className="text-xs text-zayro-gray mt-3 break-words">{t('integrations.stripe.recommended')}</p>
    </section>
  );
}

interface IntegrationCheck {
  ok: boolean;
  message: string;
  tabs?: { sheetName: string; ok: boolean; message: string }[];
}

export function GoogleConnectionTest() {
  const { t } = useI18n();
  const apiMessage = useApiMessage();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ calendar?: IntegrationCheck; sheets?: IntegrationCheck; error?: string } | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/integrations?check=1');
      const data = await response.json();
      setResult(response.ok ? data : { error: data.error ? apiMessage(data.error, response.status) : t('integrations.test.failed') });
    } catch {
      setResult({ error: t('integrations.test.unreachable') });
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
        {check.tabs?.map((tab) => (
          <div key={tab.sheetName} className="ml-4 mt-1">
            <span className={tab.ok ? 'text-emerald-700' : 'text-red-700'}>{tab.ok ? '✓' : '✗'}</span>{' '}
            <span className="text-zayro-gray">
              {tab.sheetName}: {tab.message}
            </span>
          </div>
        ))}
      </div>
    );

  return (
    <div className="mt-4" aria-live="polite">
      <button type="button" onClick={run} disabled={loading} className="crm-btn crm-btn-sm">
        {loading ? t('integrations.test.checking') : t('integrations.test.run')}
      </button>
      {result?.error && <p className="text-xs text-red-700 mt-2">{result.error}</p>}
      {line(t('integrations.test.calendar'), result?.calendar)}
      {line(t('integrations.test.sheets'), result?.sheets)}
    </div>
  );
}
