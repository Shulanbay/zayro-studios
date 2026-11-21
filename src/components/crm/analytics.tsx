'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callApi, useApiMessage, useToast } from './client';
import { useI18n } from './i18n';

/** Owner / integrations role: put failed analytics deliveries back in the queue (same event IDs). */
export function AnalyticsRetryButton() {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const apiMessage = useApiMessage();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    const res = await callApi('/api/admin/analytics/deliveries', 'POST', {});
    setBusy(false);
    if (!res.ok) return toast('error', res.data.error ? apiMessage(res.data.error, res.status) : t('analytics.destinations.retryFailed'));
    toast('success', t('analytics.destinations.retried', { requeued: res.data.requeued ?? 0, delivered: res.data.processed?.delivered ?? 0 }));
    router.refresh();
  };
  return (
    <button type="button" className="crm-btn crm-btn-sm" onClick={retry} disabled={busy}>
      {busy ? t('analytics.destinations.retrying') : t('analytics.destinations.retry')}
    </button>
  );
}
