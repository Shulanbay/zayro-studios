import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { CrmError, errorResponse } from '@/lib/crm/errors';
import { mergeCustomers, previewMerge } from '@/lib/crm/customers';
import { uuid } from '@/lib/crm/validation';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    primaryId: uuid,
    duplicateId: uuid,
    /** Absent → preview only. Must equal the preview's confirmation phrase. */
    confirmation: z.string().max(400).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'customers.merge');
  if (!guard.ok) return guard.response;
  try {
    const v = schema.parse(await readJsonObject(request));
    if (v.confirmation === undefined) {
      const preview = await previewMerge(v.primaryId, v.duplicateId);
      if (!preview) throw new CrmError('Customer not found', 404);
      return NextResponse.json({
        primary: { id: preview.primary.id, email: preview.primary.email, name: [preview.primary.first_name, preview.primary.last_name].filter(Boolean).join(' ') },
        duplicate: { id: preview.duplicate.id, email: preview.duplicate.email, name: [preview.duplicate.first_name, preview.duplicate.last_name].filter(Boolean).join(' ') },
        emailsMatch: preview.emailsMatch,
        moves: preview.moves,
        confirmationPhrase: preview.confirmationPhrase,
        blockers: preview.blockers,
      });
    }
    const result = await mergeCustomers(v.primaryId, v.duplicateId, v.confirmation, actorOf(guard.admin));
    if (!result.ok) throw new CrmError(result.error, result.status);
    return NextResponse.json({ id: result.primary.id, moved: result.moved, message: 'Customers merged' });
  } catch (error) {
    return errorResponse(error, 'merge customers');
  }
}
