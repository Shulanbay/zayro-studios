import type { Metadata } from 'next';
import { I18nProvider } from '@/components/crm/i18n';
import { adminLocaleFor, getAdminI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getAdminI18n(null).t('login.metaTitle'), robots: { index: false, follow: false } };
}

export default function AdminLoginLayout({ children }: { children: React.ReactNode }) {
  return <I18nProvider locale={adminLocaleFor(null)}>{children}</I18nProvider>;
}
