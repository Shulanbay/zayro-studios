'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LocaleSwitcher, useI18n } from '@/components/crm/i18n';

const URL_ERRORS = ['invalid_or_expired', 'already_used', 'rate_limited'] as const;

function LoginForm() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const urlError = searchParams.get('error');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch('/api/admin/request-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  const errorText = urlError
    ? (URL_ERRORS as readonly string[]).includes(urlError)
      ? t(`login.errors.${urlError as (typeof URL_ERRORS)[number]}`)
      : t('login.errors.generic')
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center surface-soft px-4">
      <div className="card max-w-md w-full">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="text-2xl font-black text-zayro-dark min-w-0 break-words">{t('login.title')}</h1>
          <LocaleSwitcher className="shrink-0 mt-1" />
        </div>
        <p className="text-zayro-gray mb-8 text-sm">{t('login.subtitle')}</p>

        {errorText && !sent && (
          <p className="field-error mb-6" role="alert">
            {errorText}
          </p>
        )}

        {sent ? (
          <div role="status">
            <p className="text-zayro-gray">{t('login.sent')}</p>
            <button type="button" className="crm-link mt-4 text-sm" onClick={() => setSent(false)}>
              {t('login.useAnother')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="admin-email" className="field-label">
                {t('login.email')}
              </label>
              <input
                id="admin-email"
                type="email"
                required
                autoComplete="email"
                placeholder={t('login.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button type="submit" disabled={loading} className={`button button-primary w-full py-3 ${loading ? 'is-loading' : ''}`}>
              {loading ? t('login.sending') : t('login.submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
