import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { CrmError, errorResponse } from '@/lib/crm/errors';
import { assignPackage } from '@/lib/crm/packages';
import { sendPackageAssignedEmail } from '@/lib/email';
import { dateStr, uuid } from '@/lib/crm/validation';
import { wallTimeToUtc } from '@/lib/crm/time';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    customerId: uuid,
    planId: z.coerce.number().int().positive(),
    startDate: dateStr.optional(),
    paymentMode: z.enum(['comp', 'offline_paid', 'unpaid']),
    paymentMethod: z.enum(['cash', 'card_terminal', 'bank_transfer', 'other']).optional(),
    notes: z.string().trim().max(2000).optional().nullable(),
    sendEmail: z.boolean().optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'packages.manage');
  if (!guard.ok) return guard.response;
  try {
    const v = schema.parse(await readJsonObject(request));
    if (v.paymentMode === 'offline_paid' && !guard.admin.can('purchases.create')) throw new CrmError('Your role cannot record payments', 403);
    if (v.paymentMode === 'offline_paid' && !v.paymentMethod) throw new CrmError('Choose how it was paid');
    const pkg = await assignPackage(
      {
        customerId: v.customerId,
        planId: v.planId,
        startsAt: v.startDate ? wallTimeToUtc(v.startDate, '00:00') : undefined,
        payment: { mode: v.paymentMode, method: v.paymentMethod },
        notes: v.notes,
      },
      actorOf(guard.admin)
    );
    const email = v.sendEmail ? await sendPackageAssignedEmail(pkg.id) : null;
    return NextResponse.json({ id: pkg.id, email: email?.status ?? 'not_requested', message: 'Package assigned' });
  } catch (error) {
    return errorResponse(error, 'assign package');
  }
}
