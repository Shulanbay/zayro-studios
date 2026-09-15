import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { temporaryHolds } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { hold_id } = body;

    if (!hold_id) {
      return NextResponse.json(
        { error: 'Missing hold_id' },
        { status: 400 }
      );
    }

    const hold = await db.query.temporaryHolds.findFirst({
      where: eq(temporaryHolds.id, hold_id),
    });

    if (!hold) {
      return NextResponse.json({
        valid: false,
        reason: 'hold_not_found',
      });
    }

    const now = new Date();

    // Check if hold has expired
    if (hold.hold_expires_at <= now) {
      // Mark as expired
      await db
        .update(temporaryHolds)
        .set({ status: 'expired' })
        .where(eq(temporaryHolds.id, hold_id));

      return NextResponse.json({
        valid: false,
        reason: 'hold_expired',
      });
    }

    // Check if hold is still active
    if (hold.status !== 'active') {
      return NextResponse.json({
        valid: false,
        reason: 'hold_released',
      });
    }

    // Hold is valid
    return NextResponse.json({
      valid: true,
      reason: 'valid',
      hold,
    });
  } catch (error) {
    console.error('Error validating hold:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
