import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { purchases } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { CrmError, errorResponse } from '@/lib/crm/errors';
import { issueRefund } from '@/lib/crm/refunds';
import { uuid } from '@/lib/crm/validation';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    amountCents: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1000),
    expectedAvailableCents: z.number().int().min(0),
    bookingId: uuid.optional().nullable(),
    cancelBooking: z.boolean().optional(),
    notifyCustomer: z.boolean().optional(),
    /** The order number, repeated as an explicit server-side confirmation. */
    confirmOrderNumber: z.string().trim(),
  })
  .strict();

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'bookings.refund');
  if (!guard.ok) return guard.response;
  try {
    const purchaseId = uuid.parse(params.id);
    const v = schema.parse(await readJsonObject(request));
    const purchase = await db.query.purchases.findFirst({ where: eq(purchases.id, purchaseId) });
    if (!purchase) throw new CrmError('Purchase not found', 404);
    if (v.confirmOrderNumber !== purchase.order_number) throw new CrmError('Confirmation does not match this purchase');
    if (v.cancelBooking && !guard.admin.can('bookings.cancel')) throw new CrmError('Your role cannot cancel bookings', 403);
    const result = await issueRefund(
      {
        purchaseId,
        amountCents: v.amountCents,
        reason: v.reason,
        bookingId: v.bookingId ?? null,
        expectedAvailableCents: v.expectedAvailableCents,
        cancelBooking: v.cancelBooking,
        notifyCustomer: v.notifyCustomer,
      },
      actorOf(guard.admin)
    );
    return NextResponse.json({
      refund: { id: result.refund.id, status: result.refund.status, failure_reason: result.refund.failure_reason, stripe_refund_id: result.refund.stripe_refund_id },
      cancelled: result.cancellation?.ok ?? false,
      email: result.email?.status ?? 'not_requested',
    });
  } catch (error) {
    return errorResponse(error, 'refund');
  }
}
