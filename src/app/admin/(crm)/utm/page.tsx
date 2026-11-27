import { redirect } from 'next/navigation';
import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { utmLinks } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { Forbidden, PageHeader } from '@/components/crm/ui';
import { getAdminI18n } from '@/lib/i18n/server';
import { SITE_URL } from '@/lib/seo';
import { publishedSlugs } from '@/lib/marketing/pages';
import UtmBuilder from '@/components/marketing/admin/UtmBuilder';

export const dynamic = 'force-dynamic';

export default async function UtmPage() {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('analytics.read')) return <Forbidden what="marketing analytics" />;
  const { t } = getAdminI18n(admin);
  const [slugs, saved] = await Promise.all([publishedSlugs(), db.select().from(utmLinks).orderBy(desc(utmLinks.created_at)).limit(100).catch(() => [])]);
  const paths = ['/', '/pricing', '/booking', '/booking?category=tour', '/packages', '/contact', ...slugs.filter((s) => s.slug !== 'home').map((s) => `/${s.slug}`)];
  return (
    <>
      <PageHeader title={t('common.nav.utm')} description={t('utm.description')} />
      <UtmBuilder origin={SITE_URL} paths={paths} saved={saved.map((l) => ({ id: l.id, name: l.name, url: l.url, platform: l.platform, created_by: l.created_by, created_at: l.created_at.toISOString() }))} />
    </>
  );
}
