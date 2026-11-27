import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { landingPages } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { PAGE_TEMPLATES, templateBlocks } from '@/lib/marketing/blocks';
import { slugProblem, slugify } from '@/lib/marketing/pages';

export const dynamic = 'force-dynamic';

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(80).optional(),
  template: z.enum(PAGE_TEMPLATES).default('blank'),
});

/** New landing page (a draft) from a template. */
export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'pages.manage');
  if (!guard.ok) return guard.response;
  const parsed = schema.safeParse(await readJsonObject(request));
  if (!parsed.success) return NextResponse.json({ error: 'Add a page name' }, { status: 400 });
  const { title, template } = parsed.data;
  const slug = (parsed.data.slug || slugify(title)).toLowerCase();
  const problem = slugProblem(slug);
  if (problem) return NextResponse.json({ error: problem === 'reserved' ? 'This address is used by the site' : 'Use lowercase letters, numbers and hyphens', field: 'slug' }, { status: 400 });
  if (await db.query.landingPages.findFirst({ where: eq(landingPages.slug, slug) })) return NextResponse.json({ error: 'A page with this address exists', field: 'slug' }, { status: 409 });
  const [page] = await db
    .insert(landingPages)
    .values({ slug, title, content_blocks: templateBlocks(template), is_published: false, created_by: guard.admin.email, updated_by: guard.admin.email })
    .returning();
  await writeAudit({ actor: actorOf(guard.admin), operation: 'page.create', entityType: 'landing_page', entityId: page.id, after: { slug, title, template } });
  return NextResponse.json({ id: page.id, slug, message: 'Page created' });
}
