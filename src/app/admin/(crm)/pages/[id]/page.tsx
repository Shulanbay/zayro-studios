import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { landingPages, services } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { Forbidden, PageHeader } from '@/components/crm/ui';
import { getAdminI18n } from '@/lib/i18n/server';
import { readBlocks } from '@/lib/marketing/blocks';
import { builtInTags } from '@/lib/marketing/settings';
import PageEditor from '@/components/marketing/admin/PageEditor';

export const dynamic = 'force-dynamic';

export default async function EditLandingPage({ params }: { params: { id: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('pages.manage')) return <Forbidden what="landing pages" />;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const page = await db.query.landingPages.findFirst({ where: eq(landingPages.id, params.id) });
  if (!page) notFound();
  const { t } = getAdminI18n(admin);
  const catalog = await db
    .select({ id: services.id, name: services.name, category: services.category })
    .from(services)
    .where(eq(services.is_active, true))
    .orderBy(asc(services.category), asc(services.display_order), asc(services.id));
  return (
    <>
      <PageHeader
        title={page.title}
        description={t('pages.editorDescription')}
        actions={
          <Link href="/admin/pages" className="crm-btn">
            ← {t('pages.allPages')}
          </Link>
        }
      />
      <PageEditor
        page={{
          id: page.id,
          slug: page.slug,
          title: page.title,
          meta_description: page.meta_description ?? '',
          og_image_url: page.og_image_url ?? '',
          noindex: page.noindex,
          is_published: page.is_published,
          content_blocks: readBlocks(page.content_blocks),
          head_scripts: page.head_scripts ?? '',
          body_scripts: page.body_scripts ?? '',
          scripts_consent: page.scripts_consent as 'necessary' | 'analytics' | 'advertising',
        }}
        services={catalog}
        canEditCode={admin.can('marketing.scripts')}
        builtIn={builtInTags()}
      />
    </>
  );
}
