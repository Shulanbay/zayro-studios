'use client';

/**
 * Admin language on the client: the provider (seeded with the language the
 * server resolved for this admin) and the switcher. Switching saves the
 * choice (profile + cookie), re-renders client text at once and refreshes
 * the server-rendered parts in place — same URL, so filters, period and
 * page survive.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ADMIN_LOCALES, ADMIN_LOCALE_COOKIE, ADMIN_LOCALE_COOKIE_MAX_AGE, LOCALE_NAMES, i18nFor, isAdminLocale, type AdminI18n, type AdminLocale } from '@/lib/i18n';

interface I18nContextValue extends AdminI18n {
  setLocale(locale: AdminLocale): Promise<void>;
  switching: boolean;
}

const I18nContext = createContext<I18nContextValue>({ ...i18nFor('en'), setLocale: async () => undefined, switching: false });

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

function writeCookie(locale: AdminLocale) {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${ADMIN_LOCALE_COOKIE}=${locale}; Max-Age=${ADMIN_LOCALE_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

export function I18nProvider({ locale: initial, children }: { locale: AdminLocale; children: React.ReactNode }) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<AdminLocale>(initial);
  const [refreshing, startTransition] = useTransition();
  // From the click until the server-rendered parts arrive in the new language.
  const [saving, setSaving] = useState(false);
  const wasRefreshing = useRef(false);
  const switching = saving || refreshing;

  // The server is the source of truth after a refresh / navigation.
  useEffect(() => setLocaleState(initial), [initial]);

  useEffect(() => {
    if (wasRefreshing.current && !refreshing) setSaving(false);
    wasRefreshing.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    async (next: AdminLocale) => {
      if (!isAdminLocale(next)) return;
      setSaving(true);
      setLocaleState(next);
      try {
        writeCookie(next);
      } catch {
        // cookies blocked: the profile (if signed in) still stores it
      }
      try {
        await fetch('/api/admin/locale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ locale: next }),
        });
      } catch {
        // offline: the cookie keeps the choice for this browser
      }
      startTransition(() => router.refresh());
    },
    [router]
  );

  const value = useMemo<I18nContextValue>(() => ({ ...i18nFor(locale), setLocale, switching }), [locale, setLocale, switching]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale, switching, t } = useI18n();
  return (
    <label className={`inline-flex items-center gap-2 text-xs text-zayro-gray ${className}`}>
      <span aria-hidden="true">🌐</span>
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={locale}
        onChange={(e) => void setLocale(e.target.value as AdminLocale)}
        aria-busy={switching}
        data-testid="locale-switcher"
        className="!w-auto !py-1 !pl-2 !pr-7 !text-sm !min-h-0 rounded-lg"
      >
        {ADMIN_LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
