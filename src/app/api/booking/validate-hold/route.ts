import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { temporaryHolds } from '@/lib/db/schema';
import { enforceRateLimit } from '@/lib/crm/rateLimit';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ hold_id: z.string().trim().uuid() });

/**
 * Is this hold still reserving its slot? Returns only the status and expiry
 * — never the email or other details the hold was created with.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'validate-hold', 60, 600);
  if (limited) return limited;

  let holdId: string;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ valid: false, reason: 'hold_not_found' });
    holdId = parsed.data.hold_id;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const hold = await db.query.temporaryHolds.findFirst({ where: eq(temporaryHolds.id, holdId) });
    if (!hold) return NextResponse.json({ valid: false, reason: 'hold_not_found' });

    if (new Date(hold.hold_expires_at) <= new Date()) {
      await db
        .update(temporaryHolds)
        .set({ status: 'expired' })
        .where(and(eq(temporaryHolds.id, holdId), eq(temporaryHolds.status, 'active')));
      return NextResponse.json({ valid: false, reason: 'hold_expired' });
    }

    if (hold.status !== 'active') {
      return NextResponse.json({ valid: false, reason: hold.status === 'converted_to_booking' ? 'hold_converted' : 'hold_released' });
    }

    return NextResponse.json({ valid: true, reason: 'valid', hold_expires_at: new Date(hold.hold_expires_at).toISOString() });
  } catch (error) {
    console.error('Error validating hold:', (error as Error)?.message || error);
    return NextResponse.json({ error: 'Please try again in a moment.' }, { status: 503 });
  }
}
