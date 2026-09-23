import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { blockedTimes } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getAdminSession } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = await db.query.blockedTimes.findMany({ orderBy: (b, { desc }) => [desc(b.start_datetime)] });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = getAdminSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { start_datetime, end_datetime, reason } = await request.json();
  if (!start_datetime || !end_datetime) {
    return NextResponse.json({ error: 'Missing start_datetime or end_datetime' }, { status: 400 });
  }

  const start = new Date(start_datetime);
  const end = new Date(end_datetime);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }

  const inserted = await db
    .insert(blockedTimes)
    .values({ start_datetime: start, end_datetime: end, reason: reason || null, created_by: session.email })
    .returning();

  return NextResponse.json(inserted[0]);
}

export async function DELETE(request: NextRequest) {
  if (!getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }
  await db.delete(blockedTimes).where(eq(blockedTimes.id, id));
  return NextResponse.json({ success: true });
}
