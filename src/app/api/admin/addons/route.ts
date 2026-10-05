import { NextRequest, NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { serviceAddons } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { diffFields, writeAudit } from '@/lib/crm/audit';
import { pgErrorCode } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

const fields = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  price: z.number().min(0).max(100000),
  unit: z.enum(['session', 'hour']),
  max_quantity: z.number().int().min(1).max(20),
  active: z.boolean(),
  sort_order: z.number().int().min(-1000).max(10000),
};
const createSchema = z.object({ ...fields, active: fields.active.optional(), sort_order: fields.sort_order.optional(), max_quantity: fields.max_quantity.optional() });
const patchSchema = z.object({ id: z.number().int().positive() }).merge(z.object(fields).partial());

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'addon';
}

/** Add-ons (extras) sold with bookings. Price changes apply to new bookings only. */
export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, 'services.manage');
  if (!guard.ok) return guard.response;
  return NextResponse.json(await db.query.serviceAddons.findMany({ orderBy: [asc(serviceAddons.sort_order), asc(serviceAddons.id)] }));
}

export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'services.manage');
  if (!guard.ok) return guard.response;
  const parsed = createSchema.safeParse(await readJsonObject(request));
  if (!parsed.success) return NextResponse.json({ error: `Invalid ${String(parsed.error.issues[0]?.path[0] ?? 'input')}` }, { status: 400 });
  const v = parsed.data;
  try {
    const [created] = await db
      .insert(serviceAddons)
      .values({
        slug: `${slugify(v.name)}-${Date.now().toString(36)}`,
        name: v.name,
        description: v.description || null,
        price_cents: Math.round(v.price * 100),
        unit: v.unit,
        max_quantity: v.max_quantity ?? 1,
        active: v.active ?? true,
        sort_order: v.sort_order ?? 500,
      })
      .returning();
    await writeAudit({
      actor: actorOf(guard.admin),
      operation: 'addon.create',
      entityType: 'addon',
      entityId: created.id,
      after: { name: created.name, priceCents: created.price_cents, unit: created.unit, active: created.active },
    });
    return NextResponse.json(created);
  } catch (error) {
    if (pgErrorCode(error) === '23505') return NextResponse.json({ error: 'An add-on with this name already exists' }, { status: 409 });
    throw error;
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await requirePermission(request, 'services.manage');
  if (!guard.ok) return guard.response;
  const parsed = patchSchema.safeParse(await readJsonObject(request));
  if (!parsed.success) return NextResponse.json({ error: `Invalid ${String(parsed.error.issues[0]?.path[0] ?? 'input')}` }, { status: 400 });
  const { id, price, ...rest } = parsed.data;
  const existing = await db.query.serviceAddons.findFirst({ where: eq(serviceAddons.id, id) });
  if (!existing) return NextResponse.json({ error: 'Add-on not found' }, { status: 404 });

  const values: Record<string, unknown> = { ...rest };
  if (price !== undefined) values.price_cents = Math.round(price * 100);
  if (values.description === '') values.description = null;
  if (Object.keys(values).length === 0) return NextResponse.json(existing);

  const [updated] = await db
    .update(serviceAddons)
    .set({ ...values, updated_at: new Date() })
    .where(eq(serviceAddons.id, id))
    .returning();
  // Purchases keep their own line-item snapshots, so past bookings never change.
  const changes = diffFields(existing as Record<string, unknown>, values);
  await writeAudit({
    actor: actorOf(guard.admin),
    operation: 'price_cents' in changes.after ? 'addon.price_change' : 'addon.update',
    entityType: 'addon',
    entityId: id,
    before: changes.before,
    after: changes.after,
    metadata: { name: existing.name },
  });
  return NextResponse.json(updated);
}
