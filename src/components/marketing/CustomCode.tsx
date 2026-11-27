'use client';

/**
 * Runs the marketer's custom tracking code (Admin → Tracking, and each
 * landing page's own code) on public pages — only after the visitor allowed
 * the snippet's consent category, and never in the admin or booking flow.
 * Each snippet runs at most once per page load (SPA navigations included).
 */
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { isTrackablePath } from '@/lib/analytics/attribution';
import { getConsent, onConsentChange, readStoredConsent } from '@/lib/analytics/browser/tracker';
import { CUSTOM_CODE_EXCLUDED, parseScripts } from '@/lib/marketing/scripts';
import type { ConsentState } from '@/lib/analytics/consent';

type Category = 'necessary' | 'analytics' | 'advertising';
interface Snippet {
  head: string;
  body: string;
  consent: Category;
}
interface TagsResponse {
  enabled: boolean;
  global?: Snippet;
  page?: Snippet | null;
}

const allowed = (consent: ConsentState | null, category: Category) => category === 'necessary' || (category === 'analytics' ? !!consent?.analytics : !!consent?.advertising);

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function inject(code: string, target: HTMLElement, key: string) {
  for (const [i, s] of parseScripts(code).entries()) {
    const el = document.createElement('script');
    for (const [name, value] of Object.entries(s.attributes)) el.setAttribute(name, value);
    el.setAttribute('data-zayro-custom', `${key}-${i}`);
    if (s.src) el.src = s.src;
    else if (s.inline) el.text = s.inline;
    target.appendChild(el);
  }
}

export default function CustomCode() {
  const pathname = usePathname() || '/';
  const ran = useRef(new Set<string>());

  useEffect(() => {
    if (!isTrackablePath(pathname) || CUSTOM_CODE_EXCLUDED.test(pathname)) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const run = (tags: TagsResponse, consent: ConsentState | null) => {
      if (!tags.enabled) return;
      const snippets: [string, Snippet | null | undefined][] = [
        ['global', tags.global],
        [`page:${pathname}`, tags.page],
      ];
      for (const [scope, snippet] of snippets) {
        if (!snippet || !allowed(consent, snippet.consent)) continue;
        const key = `${scope}:${hash(snippet.head + snippet.body)}`;
        if (ran.current.has(key)) continue;
        ran.current.add(key);
        try {
          inject(snippet.head, document.head, `${key}-h`);
          inject(snippet.body, document.body, `${key}-b`);
        } catch (error) {
          console.warn('[custom code] a snippet could not be added', error);
        }
      }
    };

    fetch(`/api/marketing/tags?path=${encodeURIComponent(pathname)}`, { credentials: 'omit' })
      .then((r) => (r.ok ? (r.json() as Promise<TagsResponse>) : { enabled: false }))
      .then((tags) => {
        if (cancelled || !tags.enabled) return;
        run(tags, getConsent() ?? readStoredConsent());
        // Snippets waiting for consent run as soon as the visitor allows their category.
        unsubscribe = onConsentChange((c) => run(tags, c));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [pathname]);

  return null;
}
