import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { services } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getAdminSession } from '@/lib/adminAuth';
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

export async function GET() {
  if (!getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = await db.query.services.findMany({ orderBy: (s, { asc }) => [asc(s.display_order), asc(s.id)] });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  if (!getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  return NextResponse.json(inserted[0]);
}

export async function PATCH(request: NextRequest) {
  if (!getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  return NextResponse.json(updated[0]);
}
