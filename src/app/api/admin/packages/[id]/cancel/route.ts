import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { errorResponse } from '@/lib/crm/errors';
import { cancelCustomerPackage } from '@/lib/crm/packages';
import { uuid } from '@/lib/crm/validation';

export const dynamic = 'force-dynamic';

const schema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

/** Cancels a customer package (remaining credits removed). Does not refund — refund the purchase separately. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'packages.manage');
  if (!guard.ok) return guard.response;
  try {
    const id = uuid.parse(params.id);
    const { reason } = schema.parse(await readJsonObject(request));
    await cancelCustomerPackage(id, reason, actorOf(guard.admin));
    return NextResponse.json({ message: 'Package cancelled' });
  } catch (error) {
    return errorResponse(error, 'cancel package');
  }
}
