import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { errorResponse } from '@/lib/crm/errors';
import { adjustCredits } from '@/lib/crm/packages';
import { uuid } from '@/lib/crm/validation';

export const dynamic = 'force-dynamic';

const schema = z.object({ delta: z.number().int().min(-100).max(100), reason: z.string().trim().min(1).max(500) }).strict();

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'packages.manage');
  if (!guard.ok) return guard.response;
  try {
    const id = uuid.parse(params.id);
    const { delta, reason } = schema.parse(await readJsonObject(request));
    const pkg = await adjustCredits(id, delta, reason, actorOf(guard.admin));
    return NextResponse.json({ remaining: pkg.remaining_credits, message: `Credits adjusted (${delta > 0 ? '+' : ''}${delta})` });
  } catch (error) {
    return errorResponse(error, 'adjust credits');
  }
}
