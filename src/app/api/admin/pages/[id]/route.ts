import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/lib/db';
import { landingPages, SCRIPT_CONSENT_CATEGORIES } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { hasPermission } from '@/lib/crm/permissions';
import { writeAudit } from '@/lib/crm/audit';
import { contentBlocks, safeImage } from '@/lib/marketing/blocks';
import { revalidateLanding, slugProblem } from '@/lib/marketing/pages';
import { checkSnippet, MAX_SNIPPET_CHARS } from '@/lib/marketing/scripts';

export const dynamic = 'force-dynamic';

const schema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().toLowerCase().max(80).optional(),
  meta_description: z.string().trim().max(320).nullable().optional(),
  og_image_url: safeImage.nullable().optional(),
  noindex: z.boolean().optional(),
  is_published: z.boolean().optional(),
  content_blocks: contentBlocks.optional(),
  head_scripts: z.string().max(MAX_SNIPPET_CHARS).nullable().optional(),
  body_scripts: z.string().max(MAX_SNIPPET_CHARS).nullable().optional(),
  scripts_consent: z.enum(SCRIPT_CONSENT_CATEGORIES).optional(),
});

/** Audit fingerprint of a snippet (length + hash), not the code itself. */
const fp = (code: string | null | undefined) => (code ? `${code.length} chars · ${createHash('sha256').update(code).digest('hex').slice(0, 12)}` : null);

async function load(id: string) {
  return /^[0-9a-f-]{36}$/i.test(id) ? db.query.landingPages.findFirst({ where: eq(landingPages.id, id) }) : undefined;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'pages.manage');
  if (!guard.ok) return guard.response;
  const before = await load(params.id);
  if (!before) return NextResponse.json({ error: 'Page not found' }, { status: 404 });
  const parsed = schema.safeParse(await readJsonObject(request));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.message && issue.message !== 'Invalid input' ? issue.message : `Invalid ${issue?.path.join('.') || 'input'}`, path: issue?.path }, { status: 400 });
  }
  const v = parsed.data;
  const touchesCode = v.head_scripts !== undefined || v.body_scripts !== undefined || v.scripts_consent !== undefined;
  if (touchesCode && !hasPermission(guard.admin.permissions, 'marketing.scripts')) return NextResponse.json({ error: 'Your role cannot edit tracking code' }, { status: 403 });
  for (const code of [v.head_scripts, v.body_scripts]) {
    const err = checkSnippet(code).find((p) => p.level === 'error');
    if (err) return NextResponse.json({ error: `Tracking code: ${err.code}`, code: err.code }, { status: 400 });
  }
  if (v.slug && v.slug !== before.slug) {
    const problem = slugProblem(v.slug);
    if (problem) return NextResponse.json({ error: problem === 'reserved' ? 'This address is used by the site' : 'Use lowercase letters, numbers and hyphens', field: 'slug' }, { status: 400 });
    if (await db.query.landingPages.findFirst({ where: and(eq(landingPages.slug, v.slug), ne(landingPages.id, before.id)) })) return NextResponse.json({ error: 'A page with this address exists', field: 'slug' }, { status: 409 });
  }
  const set: Partial<typeof landingPages.$inferInsert> = { updated_at: new Date(), updated_by: guard.admin.email };
  for (const [k, val] of Object.entries(v)) if (val !== undefined) (set as Record<string, unknown>)[k] = typeof val === 'string' && k !== 'head_scripts' && k !== 'body_scripts' ? val || null : val;
  if (set.head_scripts === '') set.head_scripts = null;
  if (set.body_scripts === '') set.body_scripts = null;
  if (v.is_published && !before.is_published) set.published_at = new Date();
  const [after] = await db.update(landingPages).set(set).where(eq(landingPages.id, before.id)).returning();

  revalidateLanding(before.slug);
  if (after.slug !== before.slug) revalidateLanding(after.slug);
  const op = v.is_published !== undefined && v.is_published !== before.is_published ? (v.is_published ? 'page.publish' : 'page.unpublish') : touchesCode ? 'page.update_code' : 'page.update';
  await writeAudit({
    actor: actorOf(guard.admin),
    operation: op,
    entityType: 'landing_page',
    entityId: before.id,
    before: { slug: before.slug, published: before.is_published, blocks: (before.content_blocks as unknown[]).length, head: fp(before.head_scripts), body: fp(before.body_scripts), consent: before.scripts_consent },
    after: { slug: after.slug, published: after.is_published, blocks: (after.content_blocks as unknown[]).length, head: fp(after.head_scripts), body: fp(after.body_scripts), consent: after.scripts_consent },
  });
  return NextResponse.json({ message: 'Saved', page: { id: after.id, slug: after.slug, is_published: after.is_published, updated_at: after.updated_at } });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'pages.manage');
  if (!guard.ok) return guard.response;
  const page = await load(params.id);
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });
  if (page.is_published) return NextResponse.json({ error: 'Unpublish the page before deleting it' }, { status: 409 });
  await db.delete(landingPages).where(eq(landingPages.id, page.id));
  revalidateLanding(page.slug);
  await writeAudit({ actor: actorOf(guard.admin), operation: 'page.delete', entityType: 'landing_page', entityId: page.id, before: { slug: page.slug, title: page.title, blocks: (page.content_blocks as unknown[]).length } });
  return NextResponse.json({ message: 'Page deleted' });
}
