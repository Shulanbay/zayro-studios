import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { errorResponse } from '@/lib/crm/errors';
import { resolveRefundReview } from '@/lib/crm/refunds';
import { uuid } from '@/lib/crm/validation';

export const dynamic = 'force-dynamic';

const schema = z.object({ note: z.string().trim().min(1).max(1000) }).strict();

/** Staff decided no refund is due; clears the review flag (audited). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'bookings.refund');
  if (!guard.ok) return guard.response;
  try {
    const id = uuid.parse(params.id);
    const { note } = schema.parse(await readJsonObject(request));
    await resolveRefundReview(id, note, actorOf(guard.admin));
    return NextResponse.json({ message: 'Marked as reviewed' });
  } catch (error) {
    return errorResponse(error, 'resolve refund review');
  }
}
