'use client';

import { useI18n } from '@/components/crm/i18n';

export default function Loading() {
  const { t } = useI18n();
  return (
    <div aria-busy="true" aria-label={t('common.loading')}>
      <div className="skeleton h-8 w-56 rounded-lg mb-6" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-24 rounded-2xl" />
        ))}
      </div>
      <div className="skeleton h-72 rounded-2xl" />
    </div>
  );
}
