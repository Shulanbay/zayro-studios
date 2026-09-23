import { NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
