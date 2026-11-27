import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads } from '@/lib/db/schema';
import { readJsonObject, requirePermission } from '@/lib/crm/auth';
import { addLeadNote } from '@/lib/marketing/leads';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'leads.manage');
  if (!guard.ok) return guard.response;
  const id = Number(params.id);
  const body = await readJsonObject(request);
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!text) return NextResponse.json({ error: 'A note cannot be empty' }, { status: 400 });
  if (!(await db.query.leads.findFirst({ where: eq(leads.id, id) }))) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  await addLeadNote(id, text, guard.admin.email);
  return NextResponse.json({ message: 'Note added' });
}
