import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { customerNotes, customers } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { CrmError, errorResponse } from '@/lib/crm/errors';
import { uuid } from '@/lib/crm/validation';

export const dynamic = 'force-dynamic';

const schema = z.object({ body: z.string().trim().min(1).max(5000) }).strict();

/** Adds a timestamped staff note to a customer. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'notes.write');
  if (!guard.ok) return guard.response;
  try {
    const id = uuid.parse(params.id);
    const { body } = schema.parse(await readJsonObject(request));
    const customer = await db.query.customers.findFirst({ where: eq(customers.id, id) });
    if (!customer) throw new CrmError('Customer not found', 404);
    const [note] = await db
      .insert(customerNotes)
      .values({ customer_id: id, body, author_id: guard.admin.id, author_email: guard.admin.email })
      .returning();
    await writeAudit({ actor: actorOf(guard.admin), operation: 'customer.add_note', entityType: 'customer', entityId: id, after: { noteId: note.id, length: body.length } });
    return NextResponse.json({ id: note.id, message: 'Note added' });
  } catch (error) {
    return errorResponse(error, 'add customer note');
  }
}
