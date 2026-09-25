import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { customers } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { diffFields, writeAudit } from '@/lib/crm/audit';
import { CrmError, errorResponse } from '@/lib/crm/errors';
import { uuid } from '@/lib/crm/validation';

export const dynamic = 'force-dynamic';

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

const schema = z
  .object({
    first_name: nullableText(255),
    last_name: nullableText(255),
    phone: nullableText(20),
    company: nullableText(255),
    internal_notes: nullableText(5000),
    marketing_consent: z.boolean().optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .strict();

/**
 * Edits contact details / notes / status. The email is the customer's
 * identity (bookings and Stripe refer to it) and is not editable here —
 * use merge for duplicates.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await readJsonObject(request);
  const onlyNotes = body !== null && Object.keys(body).every((k) => k === 'internal_notes');
  const guard = await requirePermission(request, onlyNotes ? 'notes.write' : 'customers.update');
  if (!guard.ok) return guard.response;
  try {
    const id = uuid.parse(params.id);
    const values = schema.parse(body);
    const before = await db.query.customers.findFirst({ where: eq(customers.id, id) });
    if (!before) throw new CrmError('Customer not found', 404);
    if (before.status === 'merged') throw new CrmError('This customer was merged into another record', 409);
    const [updated] = await db.update(customers).set({ ...values, updated_at: new Date() }).where(eq(customers.id, id)).returning();
    const changes = diffFields(before as Record<string, unknown>, values as Record<string, unknown>);
    await writeAudit({ actor: actorOf(guard.admin), operation: 'customer.update', entityType: 'customer', entityId: id, before: changes.before, after: changes.after });
    return NextResponse.json({ id: updated.id, message: 'Customer saved' });
  } catch (error) {
    return errorResponse(error, 'update customer');
  }
}
