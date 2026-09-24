import { NextRequest, NextResponse } from 'next/server';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { errorResponse } from '@/lib/crm/errors';
import { notesSchema, uuid } from '@/lib/crm/validation';
import { updateBookingNotes } from '@/lib/crm/bookings';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'notes.write');
  if (!guard.ok) return guard.response;
  try {
    const id = uuid.parse(params.id);
    const { internalNotes } = notesSchema.parse(await readJsonObject(request));
    await updateBookingNotes(id, internalNotes, actorOf(guard.admin));
    return NextResponse.json({ message: 'Notes saved' });
  } catch (error) {
    return errorResponse(error, 'update notes');
  }
}
