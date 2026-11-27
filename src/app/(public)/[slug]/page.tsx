import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { pageMetadata } from '@/lib/seo';
import LandingRenderer from '@/components/marketing/LandingRenderer';
import { getPublishedLanding } from '@/lib/marketing/pages';
import { landingContext } from '@/lib/marketing/render';

// Published pages are cached and refreshed on save (revalidatePath) or at least every minute.
export const revalidate = 60;

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const landing = await getPublishedLanding(params.slug);
  if (!landing) return { title: 'Page not found | ZAYRO Studios', robots: { index: false } };
  const { page } = landing;
  const meta = pageMetadata({ title: page.title, description: page.meta_description ?? '', path: `/${page.slug}`, noindex: page.noindex });
  return page.og_image_url ? { ...meta, openGraph: { ...(meta.openGraph ?? {}), images: [page.og_image_url] } } : meta;
}

/** Landing pages built in Admin → Landing pages (real routes like /pricing always take precedence). */
export default async function LandingPage({ params }: { params: { slug: string } }) {
  const landing = await getPublishedLanding(params.slug);
  if (!landing || params.slug === 'home') notFound();
  return <LandingRenderer blocks={landing.blocks} ctx={await landingContext(landing.page.slug, landing.blocks)} />;
}
