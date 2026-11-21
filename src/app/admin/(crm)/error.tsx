'use client';

import { useI18n } from '@/components/crm/i18n';

export default function CrmError({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="card max-w-lg">
      <h1 className="text-lg font-semibold text-zayro-dark">{t('common.errorPage.title')}</h1>
      <p className="text-sm text-zayro-gray mt-1">{t('common.errorPage.body')}</p>
      <button type="button" className="crm-btn crm-btn-primary mt-4" onClick={reset}>
        {t('common.actions.tryAgain')}
      </button>
    </div>
  );
}
