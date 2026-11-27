import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { landingPages } from '@/lib/db/schema';
import { actorOf, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { hasPermission } from '@/lib/crm/permissions';
import { newBlockId, readBlocks } from '@/lib/marketing/blocks';

export const dynamic = 'force-dynamic';

/** Copy a page as a new draft (e.g. for an A/B variant). Tracking code is copied only for roles that may edit it. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'pages.manage');
  if (!guard.ok) return guard.response;
  const page = /^[0-9a-f-]{36}$/i.test(params.id) ? await db.query.landingPages.findFirst({ where: eq(landingPages.id, params.id) }) : undefined;
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });
  let slug = `${page.slug}-copy`.slice(0, 74);
  for (let i = 2; await db.query.landingPages.findFirst({ where: eq(landingPages.slug, slug) }); i++) slug = `${page.slug}-copy-${i}`.slice(0, 80);
  const code = hasPermission(guard.admin.permissions, 'marketing.scripts');
  const [copy] = await db
    .insert(landingPages)
    .values({
      slug,
      title: `${page.title} (copy)`.slice(0, 200),
      meta_description: page.meta_description,
      og_image_url: page.og_image_url,
      noindex: page.noindex,
      is_published: false,
      content_blocks: readBlocks(page.content_blocks).map((b) => ({ ...b, id: newBlockId() })),
      head_scripts: code ? page.head_scripts : null,
      body_scripts: code ? page.body_scripts : null,
      scripts_consent: page.scripts_consent,
      created_by: guard.admin.email,
      updated_by: guard.admin.email,
    })
    .returning();
  await writeAudit({ actor: actorOf(guard.admin), operation: 'page.duplicate', entityType: 'landing_page', entityId: copy.id, after: { from: page.slug, slug } });
  return NextResponse.json({ id: copy.id, slug, message: 'Page duplicated' });
}
