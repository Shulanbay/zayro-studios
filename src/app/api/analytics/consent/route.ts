import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/crm/rateLimit';
import { CONSENT_COOKIE, currentConsent } from '@/lib/analytics/consent';
import { applyConsentToVisitor, recordConsent, SESSION_COOKIE, VISITOR_COOKIE } from '@/lib/analytics/server/store';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ action: z.enum(['accept_all', 'reject_all', 'custom', 'withdraw']) }).strict();

/**
 * Records a consent choice the banner already stored in the `zayro_consent`
 * cookie (version, categories, time, random consent ID) as proof of
 * consent, and applies a withdrawal: without Analytics the first-party
 * identifier cookies are deleted; without Advertising, pending ad-platform
 * deliveries for this browser are skipped and stored click IDs removed.
 * Best effort — the choice itself already works in the browser.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'analytics-consent', 30, 600);
  if (limited) return limited;
  let action: z.infer<typeof bodySchema>['action'];
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    action = parsed.data.action;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const consent = currentConsent(request.cookies.get(CONSENT_COOKIE)?.value);
  if (!consent) return NextResponse.json({ error: 'No consent choice found' }, { status: 400 });

  const response = NextResponse.json({ recorded: true, analytics: consent.analytics, advertising: consent.advertising });
  try {
    await recordConsent(consent, action);
    await applyConsentToVisitor(request.cookies.get(VISITOR_COOKIE)?.value, consent);
  } catch (error) {
    console.error('[analytics] consent record failed:', ((error as Error)?.message || String(error)).slice(0, 200));
  }
  if (!consent.analytics) {
    response.cookies.set(VISITOR_COOKIE, '', { path: '/', maxAge: 0 });
    response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  }
  return response;
}
