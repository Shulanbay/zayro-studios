import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { adminProfiles } from '@/lib/db/schema';
import { getAdminContext, isSameOrigin } from '@/lib/crm/auth';
import { ADMIN_LOCALE_COOKIE, ADMIN_LOCALE_COOKIE_MAX_AGE, isAdminLocale } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';

/**
 * Saves the admin-panel language: in the signed-in admin's profile (kept
 * across sign-ins and devices) and in a cookie (also used on the sign-in
 * page, before anyone is signed in). Language is a personal preference, so
 * no permission beyond being an active admin is needed.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  let locale: unknown;
  try {
    locale = ((await request.json()) as { locale?: unknown })?.locale;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isAdminLocale(locale)) return NextResponse.json({ error: 'Unsupported language' }, { status: 400 });

  const admin = await getAdminContext();
  let saved: 'profile' | 'cookie' = 'cookie';
  if (admin) {
    try {
      await db.update(adminProfiles).set({ locale, updated_at: new Date() }).where(eq(adminProfiles.id, admin.id));
      saved = 'profile';
    } catch (error) {
      console.error('[admin] saving language failed:', ((error as Error)?.message || String(error)).slice(0, 200));
    }
  }
  const response = NextResponse.json({ locale, saved });
  response.cookies.set(ADMIN_LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: ADMIN_LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}
