'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callApi, useToast } from './client';

/** Owner / integrations role: put failed analytics deliveries back in the queue (same event IDs). */
export function AnalyticsRetryButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    const res = await callApi('/api/admin/analytics/deliveries', 'POST', {});
    setBusy(false);
    if (!res.ok) return toast('error', res.data.error || 'Could not retry deliveries');
    toast('success', `Re-queued ${res.data.requeued ?? 0} deliveries; sent ${res.data.processed?.delivered ?? 0}`);
    router.refresh();
  };
  return (
    <button type="button" className="crm-btn crm-btn-sm" onClick={retry} disabled={busy}>
      {busy ? 'Retrying…' : 'Retry failed deliveries'}
    </button>
  );
}
