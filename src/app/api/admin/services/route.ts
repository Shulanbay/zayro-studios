import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { packagePlanItems, packagePlans, services } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { actorOf, requirePermission } from '@/lib/crm/auth';
import { diffFields, writeAudit } from '@/lib/crm/audit';
import { parseServiceInput, type ServiceValues } from '@/lib/serviceInput';

export const dynamic = 'force-dynamic';

async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

/** A package's base service must be an existing single-session service. */
async function validateBaseService(values: ServiceValues, selfId?: number): Promise<string | null> {
  const baseId = values.package_base_service_id;
  if (baseId === undefined || baseId === null) return null;
  if (baseId === selfId) return 'A package cannot be its own base service';
  const base = await db.query.services.findFirst({ where: eq(services.id, baseId) });
  if (!base || base.category === 'package') return 'Base service must be an existing single-session service';
  return null;
}

export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, 'bookings.read');
  if (!guard.ok) return guard.response;
  const rows = await db.query.services.findMany({ orderBy: (s, { asc }) => [asc(s.display_order), asc(s.id)] });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'services.manage');
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const parsed = parseServiceInput(body, { partial: false });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const baseError = await validateBaseService(parsed.values);
  if (baseError) return NextResponse.json({ error: baseError }, { status: 400 });

  const v = parsed.values;
  const inserted = await db
    .insert(services)
    .values({
      name: v.name!,
      description: v.description ?? null,
      base_price: v.base_price!,
      duration_minutes: v.duration_minutes!,
      category: v.category ?? 'podcast',
      features: v.features ?? [],
      badge: v.badge ?? null,
      is_active: v.is_active ?? true,
      is_featured: v.is_featured ?? false,
      display_order: v.display_order ?? 0,
      session_count: v.session_count ?? null,
      validity_days: v.validity_days ?? null,
      package_type: v.package_type ?? null,
      package_base_service_id: v.package_base_service_id ?? null,
    })
    .returning();

  // A new monthly package gets its CRM plan straight away.
  const created = inserted[0];
  if (created.category === 'package' && created.session_count) {
    const [plan] = await db
      .insert(packagePlans)
      .values({
        service_id: created.id,
        name: created.name,
        slug: `package-${created.id}`,
        package_type: created.package_type,
        description: created.description,
        total_credits: created.session_count,
        validity_days: created.validity_days ?? 30,
        price_cents: Math.round(parseFloat(created.base_price) * 100),
        active: created.is_active,
        sort_order: created.display_order,
      })
      .onConflictDoNothing()
      .returning();
    if (plan && created.package_base_service_id) {
      await db.insert(packagePlanItems).values({ plan_id: plan.id, service_id: created.package_base_service_id, credits: created.session_count }).onConflictDoNothing();
    }
  }

  await writeAudit({
    actor: actorOf(guard.admin),
    operation: 'service.create',
    entityType: 'service',
    entityId: inserted[0].id,
    after: { name: inserted[0].name, price: inserted[0].base_price, category: inserted[0].category, active: inserted[0].is_active },
  });
  return NextResponse.json(inserted[0]);
}

export async function PATCH(request: NextRequest) {
  const guard = await requirePermission(request, 'services.manage');
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const id = typeof body.id === 'number' ? body.id : parseInt(String(body.id ?? ''), 10);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const existing = await db.query.services.findFirst({ where: eq(services.id, id) });
  if (!existing) return NextResponse.json({ error: 'Service not found' }, { status: 404 });

  const { id: _ignored, ...fields } = body;
  const parsed = parseServiceInput(fields, { partial: true, existingCategory: existing.category });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const baseError = await validateBaseService(parsed.values, id);
  if (baseError) return NextResponse.json({ error: baseError }, { status: 400 });

  const updated = await db
    .update(services)
    .set({ ...parsed.values, updated_at: new Date() })
    .where(eq(services.id, id))
    .returning();

  // Keep the CRM package plan in step with the package service shown on the
  // pricing page. Assigned packages keep their own snapshot.
  if (updated[0].category === 'package' && updated[0].session_count) {
    await db
      .update(packagePlans)
      .set({
        name: updated[0].name,
        price_cents: Math.round(parseFloat(updated[0].base_price) * 100),
        total_credits: updated[0].session_count,
        validity_days: updated[0].validity_days ?? 30,
        active: updated[0].is_active,
        updated_at: new Date(),
      })
      .where(eq(packagePlans.service_id, id));
  }

  // Price edits never touch purchases: every purchase keeps its own line-item snapshot.
  const changes = diffFields(existing as Record<string, unknown>, parsed.values as Record<string, unknown>);
  const operation =
    'base_price' in changes.after ? 'service.price_change' : 'is_active' in changes.after ? 'service.set_active' : 'service.update';
  await writeAudit({
    actor: actorOf(guard.admin),
    operation,
    entityType: 'service',
    entityId: id,
    before: changes.before,
    after: changes.after,
    metadata: { name: existing.name },
  });
  return NextResponse.json(updated[0]);
}
