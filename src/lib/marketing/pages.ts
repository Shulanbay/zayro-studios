/** Landing pages: lookup for the public site, CRUD and performance stats for the builder. */
import { revalidatePath } from 'next/cache';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rowsOf } from '@/lib/db/types';
import { landingPages, type LandingPage } from '@/lib/db/schema';
import { readBlocks, type ContentBlock } from './blocks';
import { wallTimeToUtc, addDays } from '@/lib/crm/time';

/** Slugs taken by real site routes (and a few reserved words): never usable for landing pages. */
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'booking', 'about', 'contact', 'faq', 'packages', 'pricing', 'privacy', 'studio', 'terms',
  'podcast-studio-nyc', 'video-production-studio-nyc', 'sitemap', 'robots', 'icon', 'opengraph-image', 'favicon',
  'setups', 'email', 'images', 'static', '_next', 'login', 'manage', 'success', 'cancel', 'checkout', 'l', 'p',
]);

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function slugProblem(slug: string): 'invalid' | 'reserved' | null {
  if (!SLUG_RE.test(slug) || slug.length > 80) return 'invalid';
  if (RESERVED_SLUGS.has(slug)) return 'reserved';
  return null;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'page'
  );
}

export interface PublishedLanding {
  page: LandingPage;
  blocks: ContentBlock[];
}

/** A published page for the public site (null when missing, a draft, or the DB is unavailable). */
export async function getPublishedLanding(slug: string): Promise<PublishedLanding | null> {
  if (!SLUG_RE.test(slug)) return null;
  try {
    const page = await db.query.landingPages.findFirst({ where: and(eq(landingPages.slug, slug), eq(landingPages.is_published, true)) });
    return page ? { page, blocks: readBlocks(page.content_blocks) } : null;
  } catch (error) {
    console.error('[marketing] landing page unavailable:', (error as Error)?.message || error);
    return null;
  }
}

/** Any page (drafts included) for an admin preview. */
export async function getLandingForPreview(slug: string): Promise<PublishedLanding | null> {
  if (!SLUG_RE.test(slug)) return null;
  const page = await db.query.landingPages.findFirst({ where: eq(landingPages.slug, slug) });
  return page ? { page, blocks: readBlocks(page.content_blocks) } : null;
}

export function revalidateLanding(slug: string | null | undefined) {
  try {
    if (slug) revalidatePath(slug === 'home' ? '/' : `/${slug}`);
    revalidatePath('/sitemap.xml');
  } catch {
    // outside a Next request (tests): nothing to revalidate
  }
}

export interface PageStats {
  slug: string;
  views: number;
  visitors: number;
  leads: number;
  paidLeads: number;
  revenueCents: number;
}

/**
 * Views (consented page views), leads and lead revenue per landing page for a date range (ET days).
 * Views count only visitors who allowed analytics; leads count everyone.
 */
export async function pageStats(range: { from: string; to: string }): Promise<Map<string, PageStats>> {
  const start = wallTimeToUtc(range.from, '00:00');
  const end = wallTimeToUtc(addDays(range.to, 1), '00:00');
  const [views, leadRows] = await Promise.all([
    db.execute(sql`
      SELECT substring(e.page_path from 2) AS slug, count(*)::int AS views, count(DISTINCT e.visitor_id)::int AS visitors
        FROM analytics_events e
       WHERE e.event_name = 'page_view' AND e.occurred_at >= ${start} AND e.occurred_at < ${end}
         AND e.page_path IN (SELECT '/' || slug FROM landing_pages)
       GROUP BY 1`),
    db.execute(sql`
      SELECT landing_page_slug AS slug, count(*)::int AS leads, count(*) FILTER (WHERE status = 'paid')::int AS paid, coalesce(sum(revenue_cents), 0)::int AS revenue
        FROM leads WHERE created_at >= ${start} AND created_at < ${end} AND landing_page_slug IS NOT NULL GROUP BY 1`),
  ]);
  const out = new Map<string, PageStats>();
  const get = (slug: string) => {
    let s = out.get(slug);
    if (!s) out.set(slug, (s = { slug, views: 0, visitors: 0, leads: 0, paidLeads: 0, revenueCents: 0 }));
    return s;
  };
  for (const r of rowsOf<{ slug: string; views: number; visitors: number }>(views)) Object.assign(get(r.slug), { views: Number(r.views), visitors: Number(r.visitors) });
  for (const r of rowsOf<{ slug: string; leads: number; paid: number; revenue: number }>(leadRows)) Object.assign(get(r.slug), { leads: Number(r.leads), paidLeads: Number(r.paid), revenueCents: Number(r.revenue) });
  return out;
}

export async function listPages() {
  return db.query.landingPages.findMany({ orderBy: [desc(landingPages.updated_at)] });
}

export async function publishedSlugs(): Promise<{ slug: string; updated_at: Date; noindex: boolean }[]> {
  try {
    return await db
      .select({ slug: landingPages.slug, updated_at: landingPages.updated_at, noindex: landingPages.noindex })
      .from(landingPages)
      .where(eq(landingPages.is_published, true));
  } catch {
    return [];
  }
}
