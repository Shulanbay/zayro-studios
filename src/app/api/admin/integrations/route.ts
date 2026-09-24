import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/crm/auth';
import { getGoogleConfigStatus } from '@/lib/googleAuth';
import { checkCalendarConnection } from '@/lib/googleCalendar';
import { checkSheetsConnection } from '@/lib/googleSheets';

export const dynamic = 'force-dynamic';

// Admin-only, read-only diagnostics for the Google integrations. Returns
// yes/no configuration flags and, with ?check=1, a live metadata read of
// the calendar and spreadsheet. Never returns credentials, tokens or IDs.
export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, 'integrations.read');
  if (!guard.ok) return guard.response;

  const config = getGoogleConfigStatus();
  if (request.nextUrl.searchParams.get('check') !== '1') {
    return NextResponse.json({ config });
  }

  const [calendar, sheets] = await Promise.all([checkCalendarConnection(), checkSheetsConnection()]);
  return NextResponse.json({ config, calendar, sheets });
}
