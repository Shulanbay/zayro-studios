'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { PublicAnalyticsConfig } from '@/lib/analytics/server/config';
import { isTrackablePath } from '@/lib/analytics/attribution';
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, CONSENT_VERSION, choiceFor, serializeConsent, type ConsentAction, type ConsentState } from '@/lib/analytics/consent';
import { browserGpc, getConsent, initAnalytics, readStoredConsent, replayPageViewToVendors, setConsent, trackEvent } from '@/lib/analytics/browser/tracker';
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
const SCROLL_MARKS = [25, 50, 75, 90] as const;

/** UI text → a short analytics label (allowlisted characters only; UI copy, never user input). */
export function analyticsLabel(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/[^A-Za-z0-9 _.:/&+()'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function placementOf(el: HTMLElement): string {
  return analyticsLabel(
    el.dataset.analyticsPlacement ||
      el.closest('[data-analytics-section]')?.getAttribute('data-analytics-section') ||
      (el.closest('header') ? 'header' : el.closest('footer') ? 'footer' : el.closest('section[id]')?.id || 'page')
  ).slice(0, 40);
}

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

  // Clicks by delegation — components stay vendor-agnostic. Order matters:
  // the most specific meaning wins and each click sends one interaction event.
  useEffect(() => {
    if (!ready) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a, button, [data-analytics-event]') as HTMLElement | null;
      if (!a) return;
      const placement = placementOf(a);
      const href = a.getAttribute('href') || '';
      const pkg = /^\/packages\/buy\?(?:.*&)?package=(\d{1,7})/.exec(href);
      const service = /^\/booking\?(?:.*&)?service=(\d{1,7})/.exec(href);
      if (a.dataset.analyticsEvent === 'tour_cta_clicked' || /[?&]category=tour(&|$)/.test(href)) trackEvent('tour_cta_clicked', { placement });
      else if (href.startsWith('tel:')) trackEvent('phone_clicked', { placement });
      else if (href.startsWith('mailto:')) trackEvent('email_clicked', { placement });
      else if (/^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple\.com)/.test(href)) trackEvent('directions_clicked', { placement });
      else if (/^https:\/\/(www\.)?instagram\.com\//.test(href)) trackEvent('click_instagram', { placement });
      else if (/^https:\/\/(wa\.me|api\.whatsapp\.com|(www\.)?whatsapp\.com)\//.test(href)) trackEvent('click_whatsapp', { placement });
      else if (pkg) trackEvent('select_package', { package_id: Number(pkg[1]), package_name: analyticsLabel(a.getAttribute('aria-label') || a.textContent).replace(/^Buy Monthly Package: /, '') || undefined });
      else if (href === '/booking' || href.startsWith('/booking?')) trackEvent('click_book_now', { button_location: placement, ...(service ? { service_id: Number(service[1]) } : {}) });
      else if (a.dataset.analyticsCta || a.classList.contains('button') || a.classList.contains('crm-btn')) {
        const name = analyticsLabel(a.dataset.analyticsCta || a.getAttribute('aria-label') || a.textContent);
        if (name) trackEvent('click_cta', { button_name: name, button_location: placement, ...(href.startsWith('/') ? { target: analyticsLabel(href.split('?')[0]) } : {}) });
      }
    };
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, [ready]);

  // Scroll depth (25 / 50 / 75 / 90 %), each mark once per page.
  useEffect(() => {
    if (!ready || !pathname || !isTrackablePath(pathname)) return;
    const sent = new Set<number>();
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      const pct = (window.scrollY / max) * 100;
      for (const mark of SCROLL_MARKS) {
        if (pct >= mark && !sent.has(mark)) {
          sent.add(mark);
          trackEvent('scroll_depth', { percent: mark });
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [ready, pathname]);

  // Section, package and gallery views: once per element per page, when half visible.
  useEffect(() => {
    if (!ready || !pathname || !isTrackablePath(pathname) || typeof IntersectionObserver === 'undefined') return;
    const seen = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || seen.has(entry.target)) continue;
          seen.add(entry.target);
          observer.unobserve(entry.target);
          const el = entry.target as HTMLElement;
          if (el.dataset.analyticsGallery) trackEvent('view_gallery', { gallery_name: analyticsLabel(el.dataset.analyticsGallery) });
          else if (el.dataset.analyticsPackage) trackEvent('view_package', { package_id: Number(el.dataset.analyticsPackage) || undefined, package_name: analyticsLabel(el.dataset.analyticsPackageName) || undefined });
          else {
            const name = analyticsLabel(el.dataset.analyticsSection || el.id || el.getAttribute('aria-labelledby'));
            if (name) trackEvent('view_section', { section_name: name });
          }
        }
      },
      { threshold: 0.5 }
    );
    // Wait a tick so the new route's content is in the DOM.
    const t = setTimeout(() => {
      document.querySelectorAll('main section[id], main [data-analytics-section], main [data-analytics-gallery], main [data-analytics-package]').forEach((el) => observer.observe(el));
    }, 300);
    return () => {
      clearTimeout(t);
      observer.disconnect();
    };
  }, [ready, pathname]);

  // Video plays (any <video> on the site), once per video per page.
  useEffect(() => {
    if (!ready) return;
    const played = new WeakSet<EventTarget>();
    const onPlay = (e: Event) => {
      const v = e.target as HTMLVideoElement | null;
      if (!v || v.tagName !== 'VIDEO' || played.has(v)) return;
      played.add(v);
      trackEvent('play_video', { video_name: analyticsLabel(v.dataset.analyticsVideo || v.getAttribute('aria-label') || v.title || 'video') });
    };
    document.addEventListener('play', onPlay, { capture: true });
    return () => document.removeEventListener('play', onPlay, { capture: true });
  }, [ready]);

  const decide = useCallback((action: ConsentAction, custom?: { analytics: boolean; advertising: boolean }) => {
    const previous = getConsent();
    const choice = choiceFor(action, custom);
    // Global Privacy Control: advertising stays off whatever was clicked.
    if (browserGpc()) choice.advertising = false;
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
  return <ConsentBanner consent={consent} gpc={browserGpc()} open={open || !consent} onDecide={decide} onClose={() => setOpen(false)} canClose={!!consent} />;
}
