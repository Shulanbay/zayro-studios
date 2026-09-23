import { NextRequest, NextResponse } from 'next/server';
import { verifyLoginToken, createSessionToken, ADMIN_SESSION_COOKIE, ADMIN_SESSION_MAX_AGE_SECONDS } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';

  if (!token) {
    return NextResponse.redirect(`${baseUrl}/admin/login?error=missing_token`);
  }

  const verified = verifyLoginToken(token);
  if (!verified) {
    return NextResponse.redirect(`${baseUrl}/admin/login?error=invalid_or_expired`);
  }

  const response = NextResponse.redirect(`${baseUrl}/admin`);
  response.cookies.set(ADMIN_SESSION_COOKIE, createSessionToken(verified.email), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
