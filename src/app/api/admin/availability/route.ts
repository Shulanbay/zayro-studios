import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { availability } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getAdminSession } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = await db.query.availability.findMany();
  return NextResponse.json(rows);
}

export async function PATCH(request: NextRequest) {
  if (!getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, start_time, end_time, is_available } = await request.json();
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  if (start_time && !/^\d{2}:\d{2}$/.test(start_time)) {
    return NextResponse.json({ error: 'Invalid start_time' }, { status: 400 });
  }
  if (end_time && !/^\d{2}:\d{2}$/.test(end_time)) {
    return NextResponse.json({ error: 'Invalid end_time' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (start_time) updates.start_time = start_time;
  if (end_time) updates.end_time = end_time;
  if (typeof is_available === 'boolean') updates.is_available = is_available;

  await db.update(availability).set(updates).where(eq(availability.id, id));
  return NextResponse.json({ success: true });
}
