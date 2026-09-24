import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, ADMIN_SESSION_COOKIE, ADMIN_SESSION_MAX_AGE_SECONDS } from '@/lib/adminAuth';
import { getBaseUrl } from '@/lib/utils';
import { consumeLoginToken } from '@/lib/crm/login';
import { isSameOrigin } from '@/lib/crm/auth';
import { enforceRateLimit } from '@/lib/crm/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * GET (the link in the email) never signs anyone in: it only forwards to a
 * confirmation page, so an email security scanner that pre-fetches links
 * can't burn the one-time token. The page's button POSTs here.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const baseUrl = getBaseUrl(request);
  if (!token) return NextResponse.redirect(`${baseUrl}/admin/login?error=missing_token`);
  return NextResponse.redirect(`${baseUrl}/admin/login/confirm?token=${encodeURIComponent(token)}`);
}

export async function POST(request: NextRequest) {
  const baseUrl = getBaseUrl(request);
  const limited = await enforceRateLimit(request, 'admin-verify', 20, 600);
  if (limited) return NextResponse.redirect(`${baseUrl}/admin/login?error=rate_limited`, 303);
  if (!isSameOrigin(request)) return NextResponse.redirect(`${baseUrl}/admin/login?error=invalid_or_expired`, 303);

  const form = await request.formData().catch(() => null);
  const token = typeof form?.get('token') === 'string' ? String(form!.get('token')) : '';
  const result = token ? await consumeLoginToken(token) : ({ ok: false, reason: 'invalid_or_expired' } as const);
  if (!result.ok) {
    return NextResponse.redirect(`${baseUrl}/admin/login?error=${result.reason === 'already_used' ? 'already_used' : 'invalid_or_expired'}`, 303);
  }

  const response = NextResponse.redirect(`${baseUrl}/admin`, 303);
  response.cookies.set(ADMIN_SESSION_COOKIE, createSessionToken(result.email), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
