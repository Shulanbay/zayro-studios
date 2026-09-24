import { NextRequest, NextResponse } from 'next/server';
import { actorOf, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { loadBookingWithService, syncGoogleIntegrations } from '@/lib/integrationSync';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin retry for the Google Calendar + Sheets sync of one confirmed
 * booking. Idempotent: an existing event is reused and an existing sheet
 * row is updated in place. It never touches Stripe, payment state or the
 * booking's status, and doesn't resend emails.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'integrations.retry');
  if (!guard.ok) return guard.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid booking id' }, { status: 400 });
  }

  const loaded = await loadBookingWithService(params.id);
  if (!loaded) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  if (loaded.booking.status !== 'confirmed') {
    return NextResponse.json(
      { error: `Only confirmed bookings can be synced (this one is ${loaded.booking.status})` },
      { status: 409 }
    );
  }

  const { calendar, sheets } = await syncGoogleIntegrations(loaded.booking, loaded.service);
  await writeAudit({
    actor: actorOf(guard.admin),
    operation: 'integration.retry_google',
    entityType: 'booking',
    entityId: loaded.booking.id,
    outcome: calendar.status === 'failed' || sheets.status === 'failed' ? 'failed' : 'success',
    metadata: { calendar: calendar.status, sheets: sheets.status },
  });
  return NextResponse.json({
    calendar: { status: calendar.status, message: calendar.message },
    sheets: { status: sheets.status, sheet: sheets.sheetName, range: sheets.rowId, message: sheets.message },
  });
}
