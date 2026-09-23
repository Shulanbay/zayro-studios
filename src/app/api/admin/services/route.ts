import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { services } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getAdminSession } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = await db.query.services.findMany({ orderBy: (s, { asc }) => [asc(s.id)] });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  if (!getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, description, base_price, duration_minutes, category } = await request.json();

  if (!name || base_price === undefined || !duration_minutes) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const price = parseFloat(base_price);
  if (isNaN(price) || price < 0) {
    return NextResponse.json({ error: 'Invalid base_price' }, { status: 400 });
  }

  const inserted = await db
    .insert(services)
    .values({
      name,
      description: description || null,
      base_price: price.toFixed(2),
      duration_minutes: parseInt(duration_minutes, 10),
      category: category || 'podcast',
      is_active: true,
    })
    .returning();

  return NextResponse.json(inserted[0]);
}

export async function PATCH(request: NextRequest) {
  if (!getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, is_active, base_price, duration_minutes, name, description } = await request.json();
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date() };

  if (typeof is_active === 'boolean') updates.is_active = is_active;

  if (base_price !== undefined) {
    const price = parseFloat(base_price);
    if (isNaN(price) || price < 0) {
      return NextResponse.json({ error: 'Invalid base_price' }, { status: 400 });
    }
    updates.base_price = price.toFixed(2);
  }

  if (duration_minutes !== undefined) {
    const duration = parseInt(duration_minutes, 10);
    if (isNaN(duration) || duration <= 0) {
      return NextResponse.json({ error: 'Invalid duration_minutes' }, { status: 400 });
    }
    updates.duration_minutes = duration;
  }

  if (typeof name === 'string' && name.trim()) updates.name = name.trim();
  if (typeof description === 'string') updates.description = description;

  await db.update(services).set(updates).where(eq(services.id, id));
  return NextResponse.json({ success: true });
}
