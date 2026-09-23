import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/adminAuth';
import { getGoogleConfigStatus } from '@/lib/googleAuth';
import { checkCalendarConnection } from '@/lib/googleCalendar';
import { checkSheetsConnection } from '@/lib/googleSheets';

export const dynamic = 'force-dynamic';

// Admin-only, read-only diagnostics for the Google integrations. Returns
// yes/no configuration flags and, with ?check=1, a live metadata read of
// the calendar and spreadsheet. Never returns credentials, tokens or IDs.
export async function GET(request: NextRequest) {
  if (!getAdminSession()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = getGoogleConfigStatus();
  if (request.nextUrl.searchParams.get('check') !== '1') {
    return NextResponse.json({ config });
  }

  const [calendar, sheets] = await Promise.all([checkCalendarConnection(), checkSheetsConnection()]);
  return NextResponse.json({ config, calendar, sheets });
}
