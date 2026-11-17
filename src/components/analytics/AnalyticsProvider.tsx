'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { PublicAnalyticsConfig } from '@/lib/analytics/server/config';
import { isTrackablePath } from '@/lib/analytics/attribution';
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, CONSENT_VERSION, choiceFor, serializeConsent, type ConsentAction, type ConsentState } from '@/lib/analytics/consent';
import { getConsent, initAnalytics, readStoredConsent, replayPageViewToVendors, setConsent, trackEvent } from '@/lib/analytics/browser/tracker';
import ConsentBanner from './ConsentBanner';

export const OPEN_PREFERENCES_EVENT = 'zayro:open-cookie-preferences';

function randomId() {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...Array.from(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function writeConsentCookie(state: ConsentState) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(serializeConsent(state))}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

const SERVICE_PAGES = /^\/(podcast-studio-nyc|video-production-studio-nyc|studio)(\/|$)/;

/**
 * Site-wide analytics: page views on every App Router navigation (once per
 * route), automatic view / contact-click events, engagement, and the
 * consent banner. Renders nothing on admin and Manage Booking pages.
 */
export default function AnalyticsProvider({ config }: { config: PublicAnalyticsConfig }) {
  const pathname = usePathname();
  const [consent, setConsentState] = useState<ConsentState | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const lastTracked = useRef<string | null>(null);
  const trackable = isTrackablePath(pathname);

  useEffect(() => {
    initAnalytics(config);
    const stored = readStoredConsent();
    setConsentState(stored);
    setReady(true);
    const openPrefs = () => setOpen(true);
    window.addEventListener(OPEN_PREFERENCES_EVENT, openPrefs);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, openPrefs);
  }, [config]);

  // One page_view per navigation (pathname change), plus view events derived from the route.
  useEffect(() => {
    if (!ready || !pathname || !isTrackablePath(pathname) || lastTracked.current === pathname) return;
    lastTracked.current = pathname;
    trackEvent('page_view', { title: document.title.slice(0, 120) });
    if (pathname === '/pricing' || pathname === '/packages') trackEvent('pricing_viewed');
    if (pathname === '/contact') trackEvent('contact_viewed');
    const m = SERVICE_PAGES.exec(pathname);
    if (m) trackEvent('view_item', { service_name: m[1] });
  }, [pathname, ready]);

  // Engaged: 10 seconds visible on the page (once per page load).
  useEffect(() => {
    if (!ready) return;
    let sent = false;
    const timer = setTimeout(() => {
      if (!sent && document.visibilityState === 'visible') {
        sent = true;
        trackEvent('engaged', { seconds: 10 });
      }
    }, 10_000);
    return () => clearTimeout(timer);
  }, [ready]);

  // Contact clicks and tour CTAs, by delegation — components stay vendor-agnostic.
  useEffect(() => {
    if (!ready) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a, [data-analytics-event]') as HTMLElement | null;
      if (!a) return;
      const placement = (a.dataset.analyticsPlacement || (a.closest('header') ? 'header' : a.closest('footer') ? 'footer' : 'page')).slice(0, 40);
      const href = a.getAttribute('href') || '';
      if (a.dataset.analyticsEvent === 'tour_cta_clicked' || /[?&]category=tour(&|$)/.test(href)) trackEvent('tour_cta_clicked', { placement });
      else if (href.startsWith('tel:')) trackEvent('phone_clicked', { placement });
      else if (href.startsWith('mailto:')) trackEvent('email_clicked', { placement });
      else if (/^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple\.com)/.test(href)) trackEvent('directions_clicked', { placement });
    };
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, [ready]);

  const decide = useCallback((action: ConsentAction, custom?: { analytics: boolean; advertising: boolean }) => {
    const previous = getConsent();
    const choice = choiceFor(action, custom);
    const next: ConsentState = {
      version: CONSENT_VERSION,
      consentId: previous?.consentId ?? randomId(),
      analytics: choice.analytics,
      advertising: choice.advertising,
      decidedAt: Math.floor(Date.now() / 1000),
    };
    try {
      writeConsentCookie(next);
    } catch {
      // cookies blocked: the choice applies to this page only
    }
    setConsent(next);
    setConsentState(next);
    setOpen(false);
    const narrowed = previous && ((previous.analytics && !next.analytics) || (previous.advertising && !next.advertising));
    void fetch('/api/analytics/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ action: narrowed && !next.analytics && !next.advertising ? 'withdraw' : action }),
    }).catch(() => undefined);
    // Tags that just became allowed get the current page view (first-party events were held until the choice).
    if ((next.analytics && !previous?.analytics) || (next.advertising && !previous?.advertising)) replayPageViewToVendors();
  }, []);

  if (!ready || !trackable) return null;
  return <ConsentBanner consent={consent} open={open || !consent} onDecide={decide} onClose={() => setOpen(false)} canClose={!!consent} />;
}
