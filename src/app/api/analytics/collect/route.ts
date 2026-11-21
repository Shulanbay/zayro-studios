import { NextRequest, NextResponse } from 'next/server';
import { clientIp, enforceRateLimit } from '@/lib/crm/rateLimit';
import { isBotUserAgent } from '@/lib/analytics/attribution';
import { CONSENT_COOKIE, applyGpc, currentConsent, gpcFromHeaders } from '@/lib/analytics/consent';
import { cleanDispatchDestinations, cleanTouch, cleanVendorIds, collectBodySchema, MAX_BODY_BYTES, validateEvent, type ValidEvent } from '@/lib/analytics/validation';
import { isInternalIp } from '@/lib/analytics/server/config';
import { recordBrowserDispatch } from '@/lib/analytics/server/deliveries';
import {
  recordBrowserEvents,
  resolveVisit,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  VISITOR_COOKIE,
  VISITOR_MAX_AGE_SECONDS,
} from '@/lib/analytics/server/store';

export const dynamic = 'force-dynamic';

const ADMIN_COOKIE = 'zayro_admin_session';

/**
 * First-party analytics intake for the public site.
 *
 * Hardened against spam and forgery: per-IP rate limit (hashed), 8 KB body
 * limit, at most 20 events per request, strict event/property allowlists,
 * trackable paths only, timestamp tolerance, PII refusal and duplicate
 * event IDs. Authoritative conversions (purchase, refund, confirmed
 * booking or extension) are server-only and always refused here; the
 * browser can never send money values.
 *
 * Not counted: bots and automated browsers, signed-in admins, configured
 * internal IPs. Without Analytics consent no identifier cookie is set and
 * events are stored without any visitor or session link.
 *
 * Always answers 204/200 quickly; analytics problems never surface to visitors.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'analytics-collect', 240, 600);
  if (limited) return limited;

  const ua = request.headers.get('user-agent');
  if (isBotUserAgent(ua) || request.cookies.get(ADMIN_COOKIE) || isInternalIp(clientIp(request))) {
    return new NextResponse(null, { status: 204 });
  }

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  let text: string;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });

  let body;
  try {
    const parsed = collectBodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid analytics payload' }, { status: 400 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (body.automated) return new NextResponse(null, { status: 204 });

  const consent = applyGpc(currentConsent(request.cookies.get(CONSENT_COOKIE)?.value), gpcFromHeaders(request.headers));
  const valid: ValidEvent[] = [];
  const rejected: Record<string, number> = {};
  for (const raw of body.events) {
    const verdict = validateEvent(raw);
    if (verdict.ok) valid.push(verdict.event);
    else rejected[verdict.reason] = (rejected[verdict.reason] ?? 0) + 1;
  }

  const response = NextResponse.json({ accepted: valid.length, rejected });
  try {
    const ownHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
    const visit = await resolveVisit({
      consent,
      visitorCookie: request.cookies.get(VISITOR_COOKIE)?.value ?? null,
      sessionCookie: request.cookies.get(SESSION_COOKIE)?.value ?? null,
      touch: cleanTouch(body.touch, ownHost),
      vendorIds: cleanVendorIds(body.vendorIds),
      userAgent: ua,
      path: valid[0]?.path ?? null,
    });
    if (valid.length) await recordBrowserEvents(valid, visit, consent);
    if (body.dispatch && consent?.advertising) await recordBrowserDispatch(body.dispatch.eventId.toLowerCase(), cleanDispatchDestinations(body.dispatch.destinations));

    const secure = process.env.NODE_ENV === 'production';
    if (visit) {
      if (visit.setVisitorCookie) response.cookies.set(VISITOR_COOKIE, visit.setVisitorCookie, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: VISITOR_MAX_AGE_SECONDS });
      if (visit.setSessionCookie) response.cookies.set(SESSION_COOKIE, visit.setSessionCookie, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_MAX_AGE_SECONDS });
    } else {
      // No Analytics consent: make sure no identifier cookie survives.
      if (request.cookies.get(VISITOR_COOKIE)) response.cookies.set(VISITOR_COOKIE, '', { path: '/', maxAge: 0 });
      if (request.cookies.get(SESSION_COOKIE)) response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    }
  } catch (error) {
    console.error('[analytics] collect failed:', ((error as Error)?.message || String(error)).slice(0, 200));
  }
  return response;
}
