import { NextRequest, NextResponse } from 'next/server';
import { isSameOrigin } from './crm/auth';
import { CrmError, errorResponse } from './crm/errors';
import { enforceRateLimit } from './crm/rateLimit';
import { ManageLinkConfigError } from './manageToken';
import { logConfigWarning } from './configWarnings';

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/**
 * Shared wrapper for the public Manage Booking API. The token travels in
 * the JSON body (never a URL or cookie), so there is no ambient credential
 * for a cross-site request to ride on; the Origin check is defence in depth.
 * Rate limited per IP. Errors never echo the token or personal data.
 */
export async function manageRoute(
  request: NextRequest,
  bucket: string,
  limit: number,
  handler: (body: Record<string, unknown>) => Promise<unknown>
): Promise<NextResponse> {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request' }, { status: 403, headers: NO_STORE });
  const limited = await enforceRateLimit(request, `manage-${bucket}`, limit, 600);
  if (limited) return limited;
  let body: Record<string, unknown>;
  try {
    const raw = await request.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object');
    body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await handler(body);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ManageLinkConfigError) {
      // Fail closed without saying why to the public.
      await logConfigWarning('BOOKING_MANAGE_SECRET is missing or shorter than 32 characters; Manage Booking links are disabled.');
      return NextResponse.json({ error: 'Booking management is temporarily unavailable. Please contact the studio.' }, { status: 503, headers: NO_STORE });
    }
    const response = error instanceof CrmError ? NextResponse.json({ error: error.message, code: error.code }, { status: error.status }) : errorResponse(error, `manage booking ${bucket}`);
    for (const [k, v] of Object.entries(NO_STORE)) response.headers.set(k, v);
    return response;
  }
}
