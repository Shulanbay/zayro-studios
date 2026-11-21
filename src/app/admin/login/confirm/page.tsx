import type { Metadata } from 'next';
import { getAdminI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getAdminI18n(null).t('login.confirmMetaTitle'), robots: { index: false, follow: false } };
}

export default function ConfirmSignInPage({ searchParams }: { searchParams: { token?: string } }) {
  const { t } = getAdminI18n(null);
  const token = typeof searchParams.token === 'string' ? searchParams.token : '';
  return (
    <div className="min-h-screen flex items-center justify-center surface-soft px-4">
      <div className="card max-w-md w-full">
        <h1 className="text-2xl font-black mb-1 text-zayro-dark">{t('login.confirm.title')}</h1>
        <p className="text-zayro-gray mb-8 text-sm">{t('login.subtitle')}</p>
        {token ? (
          <form method="post" action="/api/admin/verify">
            <input type="hidden" name="token" value={token} />
            <button type="submit" className="button button-primary w-full py-3">
              {t('login.confirm.continue')}
            </button>
            <p className="text-xs text-zayro-gray mt-4">{t('login.confirm.note')}</p>
          </form>
        ) : (
          <p className="field-error" role="alert">
            {t('login.confirm.incomplete')} <a href="/admin/login">{t('login.confirm.requestNew')}</a>
          </p>
        )}
      </div>
    </div>
  );
}
