import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PACKAGE_COOKIE, packageAccessToken, purchaseIdFromToken } from '@/lib/packageAccess';
import { fulfillPackageSession, packageForAccess } from '@/lib/publicPackages';
import { getStripe } from '@/lib/crm/refunds';
import { CrmError, errorResponse } from '@/lib/crm/errors';
import { enforceRateLimit } from '@/lib/crm/rateLimit';
export const dynamic = 'force-dynamic';
const schema = z.object({ token: z.string().max(150).optional(), sessionId: z.string().regex(/^cs_(live|test)_[A-Za-z0-9]+$/).max(255).optional() });
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'package-access', 30, 600);
  if (limited) return limited;
  try {
    const body = schema.parse(await request.json());
    let purchaseId = body.token ? purchaseIdFromToken(body.token) : null;
    if (body.sessionId) {
      const stripe = getStripe();
      if (!stripe) throw new CrmError('Payment verification is temporarily unavailable', 503);
      const session = await stripe.checkout.sessions.retrieve(body.sessionId);
      const result = await fulfillPackageSession(session);
      purchaseId = result.purchaseId;
    }
    if (!purchaseId) throw new CrmError('Open the private package link from your confirmation email.', 403);
    await packageForAccess(purchaseId);
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(PACKAGE_COOKIE, packageAccessToken(purchaseId), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/packages', maxAge: 90 * 86400 });
    return response;
  } catch (error) { return errorResponse(error, 'package access'); }
}
