import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { utmLinks } from '@/lib/db/schema';
import { readJsonObject, requirePermission } from '@/lib/crm/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().trim().min(1).max(150),
  url: z.string().trim().max(2000).url().refine((u) => /^https:\/\//.test(u), 'https only'),
  platform: z.string().trim().max(30).nullable().optional(),
  utm_campaign: z.string().trim().max(150).nullable().optional(),
});

/** Saved tracking links (UTM builder library). */
export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'analytics.read');
  if (!guard.ok) return guard.response;
  const parsed = schema.safeParse(await readJsonObject(request));
  if (!parsed.success) return NextResponse.json({ error: `Invalid ${String(parsed.error.issues[0]?.path[0] ?? 'input')}` }, { status: 400 });
  const [link] = await db.insert(utmLinks).values({ ...parsed.data, created_by: guard.admin.email }).returning();
  return NextResponse.json({ id: link.id, message: 'Link saved' });
}

export async function DELETE(request: NextRequest) {
  const guard = await requirePermission(request, 'analytics.read');
  if (!guard.ok) return guard.response;
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  await db.delete(utmLinks).where(eq(utmLinks.id, id));
  return NextResponse.json({ message: 'Deleted' });
}
