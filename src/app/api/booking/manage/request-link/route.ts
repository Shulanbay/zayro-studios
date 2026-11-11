import { NextRequest, NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/crm/auth';
import { clientIp, isHoneypotTripped } from '@/lib/crm/rateLimit';
import { REQUEST_LINK_RESPONSE, requestManageLink } from '@/lib/manageLinkRequest';

export const dynamic = 'force-dynamic';

/** Every answer takes at least this long, so response time doesn't reveal whether an email was sent. */
const MIN_RESPONSE_MS = 1200;
const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/**
 * "Request a new link". Always the same 200 answer (except a malformed
 * request), whether or not the booking exists or the email matches.
 */
export async function POST(request: NextRequest) {
  const started = Date.now();
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Invalid request' }, { status: 403, headers: HEADERS });
  let body: Record<string, unknown> = {};
  try {
    const raw = await request.json();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: HEADERS });
  }
  if (!isHoneypotTripped(body)) {
    try {
      await requestManageLink({ reference: body.reference, email: body.email }, clientIp(request));
    } catch (error) {
      console.error('[manage-link] request failed:', (error as Error)?.message || error);
    }
  }
  const wait = MIN_RESPONSE_MS - (Date.now() - started);
  if (wait > 0 && process.env.NODE_ENV !== 'test') await new Promise((r) => setTimeout(r, wait));
  return NextResponse.json({ message: REQUEST_LINK_RESPONSE }, { headers: HEADERS });
}
