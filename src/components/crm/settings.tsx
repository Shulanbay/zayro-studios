'use client';

import { useState } from 'react';
import { FormError, useJsonSubmit } from './client';

export function TaxRateForm({ initialPercent }: { initialPercent: number }) {
  const [percent, setPercent] = useState(String(initialPercent));
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/settings', method: 'PATCH', successMessage: 'Tax rate saved — applies to new purchases' });
  const value = parseFloat(percent);
  const valid = Number.isFinite(value) && value >= 0 && value <= 25;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) submit({ taxRate: Math.round(value * 1000) / 100000 });
      }}
      className="grid gap-2 max-w-sm"
    >
      <label className="field-label" htmlFor="tax">
        Sales tax (%)
      </label>
      <input id="tax" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
      <p className="text-xs text-zayro-gray">New York City combined rate is 8.875%. Changing it affects new bookings only; existing purchases keep the tax they were charged.</p>
      <FormError error={error} />
      <div>
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy || !valid}>
          {busy ? 'Saving…' : 'Save tax rate'}
        </button>
      </div>
    </form>
  );
}
