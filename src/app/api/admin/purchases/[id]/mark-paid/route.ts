import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { errorResponse } from '@/lib/crm/errors';
import { markPurchasePaid } from '@/lib/crm/bookings';
import { uuid } from '@/lib/crm/validation';

export const dynamic = 'force-dynamic';

const schema = z.object({ method: z.enum(['cash', 'card_terminal', 'bank_transfer', 'other']) }).strict();

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'purchases.create');
  if (!guard.ok) return guard.response;
  try {
    const id = uuid.parse(params.id);
    const { method } = schema.parse(await readJsonObject(request));
    await markPurchasePaid(id, method, actorOf(guard.admin));
    return NextResponse.json({ message: 'Marked as paid' });
  } catch (error) {
    return errorResponse(error, 'mark purchase paid');
  }
}
