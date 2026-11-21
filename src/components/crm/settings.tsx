'use client';

import { useState } from 'react';
import { FormError, useJsonSubmit } from './client';
import { useI18n } from './i18n';

export function TaxRateForm({ initialPercent }: { initialPercent: number }) {
  const { t } = useI18n();
  const [percent, setPercent] = useState(String(initialPercent));
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/settings', method: 'PATCH', successMessage: t('system.settings.taxSaved') });
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
        {t('system.settings.taxLabel')}
      </label>
      <input id="tax" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
      <p className="text-xs text-zayro-gray">{t('system.settings.taxNote')}</p>
      <FormError error={error} />
      <div>
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy || !valid}>
          {busy ? t('system.settings.saving') : t('system.settings.saveTax')}
        </button>
      </div>
    </form>
  );
}
