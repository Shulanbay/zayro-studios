import { NextRequest, NextResponse } from 'next/server';
import { isTrackablePath, sanitizePath } from '@/lib/analytics/attribution';
import { customCodeEnvironmentAllowed, getMarketingSettings } from '@/lib/marketing/settings';
import { getPublishedLanding } from '@/lib/marketing/pages';
import { CUSTOM_CODE_EXCLUDED } from '@/lib/marketing/scripts';

export const dynamic = 'force-dynamic';

/**
 * Custom tracking code for one public page: the site-wide snippet plus the
 * landing page's own snippet. The browser runs it only after the visitor
 * allows the snippet's consent category (components/marketing/CustomCode).
 * The code is public by nature (it ends up in the page), so caching is fine.
 */
export async function GET(request: NextRequest) {
  const path = sanitizePath(request.nextUrl.searchParams.get('path')) ?? '/';
  const off = NextResponse.json({ enabled: false }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  // Never in the booking flow, where customers type their contact details (the built-in, reviewed tags still measure it).
  if (!isTrackablePath(path) || CUSTOM_CODE_EXCLUDED.test(path) || !customCodeEnvironmentAllowed()) return off;
  const settings = await getMarketingSettings();
  if (!settings.scripts_enabled) return off;

  const slug = path === '/' ? (settings.use_landing_home ? 'home' : null) : /^\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(path)?.[1] ?? null;
  const landing = slug ? await getPublishedLanding(slug) : null;
  return NextResponse.json(
    {
      enabled: true,
      global: { head: settings.global_head_scripts ?? '', body: settings.global_body_scripts ?? '', consent: settings.global_scripts_consent },
      page: landing && (landing.page.head_scripts || landing.page.body_scripts) ? { head: landing.page.head_scripts ?? '', body: landing.page.body_scripts ?? '', consent: landing.page.scripts_consent } : null,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
  );
}
