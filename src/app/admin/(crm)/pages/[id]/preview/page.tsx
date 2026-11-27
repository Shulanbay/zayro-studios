import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { landingPages } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { Forbidden } from '@/components/crm/ui';
import { getAdminI18n } from '@/lib/i18n/server';
import { readBlocks } from '@/lib/marketing/blocks';
import { landingContext } from '@/lib/marketing/render';
import LandingRenderer from '@/components/marketing/LandingRenderer';

export const dynamic = 'force-dynamic';

/** Saved version of a page (drafts included), for staff only. Custom tracking code never runs here. */
export default async function PreviewPage({ params }: { params: { id: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('pages.manage')) return <Forbidden what="landing pages" />;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const page = await db.query.landingPages.findFirst({ where: eq(landingPages.id, params.id) });
  if (!page) notFound();
  const { t } = getAdminI18n(admin);
  const blocks = readBlocks(page.content_blocks);
  return (
    <div className="-mx-4 md:-mx-8 -my-6 md:-my-8">
      <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900">
        <span>
          {t('pages.previewBanner')} · <span className="font-mono">/{page.slug}</span> · {page.is_published ? t('pages.published') : t('pages.draft')}
        </span>
        <Link href={`/admin/pages/${page.id}`} className="crm-btn crm-btn-sm">
          {t('pages.backToEditor')}
        </Link>
      </div>
      <div className="bg-white text-zayro-dark">
        <LandingRenderer blocks={blocks} ctx={await landingContext(page.slug, blocks)} />
      </div>
    </div>
  );
}
