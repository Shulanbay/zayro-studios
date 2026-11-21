/**
 * Admin-panel languages. Pure and isomorphic (server, client, tests).
 *
 * Resolution order for a signed-in admin (see `resolveAdminLocale`):
 *   1. the language saved in their admin profile (`admin_profiles.locale`);
 *   2. the `zayro_admin_locale` cookie (chosen on the sign-in page, or before
 *      the profile column existed);
 *   3. the role default — Russian for Marketing Analyst;
 *   4. English.
 */

export const ADMIN_LOCALES = ['ru', 'kk', 'en'] as const;
export type AdminLocale = (typeof ADMIN_LOCALES)[number];

export const FALLBACK_LOCALE: AdminLocale = 'en';

/** BCP 47 tags used for all Intl formatting. */
export const INTL_LOCALE: Record<AdminLocale, string> = {
  ru: 'ru-RU',
  kk: 'kk-KZ',
  en: 'en-US',
};

/** Shown in the switcher, each in its own language. */
export const LOCALE_NAMES: Record<AdminLocale, string> = {
  ru: 'Русский',
  kk: 'Қазақша',
  en: 'English',
};

export const ADMIN_LOCALE_COOKIE = 'zayro_admin_locale';
/** One year; the profile is the durable store, the cookie only bridges sign-in. */
export const ADMIN_LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** Roles whose members see Russian until they choose otherwise. */
const ROLE_DEFAULTS: Record<string, AdminLocale> = {
  'Marketing Analyst': 'ru',
};

export function isAdminLocale(value: unknown): value is AdminLocale {
  return typeof value === 'string' && (ADMIN_LOCALES as readonly string[]).includes(value);
}

export function defaultLocaleForRole(roleName: string | null | undefined): AdminLocale {
  return (roleName && ROLE_DEFAULTS[roleName]) || FALLBACK_LOCALE;
}

export function resolveAdminLocale(input: { profileLocale?: string | null; cookieLocale?: string | null; roleName?: string | null }): AdminLocale {
  if (isAdminLocale(input.profileLocale)) return input.profileLocale;
  if (isAdminLocale(input.cookieLocale)) return input.cookieLocale;
  return defaultLocaleForRole(input.roleName);
}

/** For the sign-in page (nobody is signed in yet): cookie, then the browser's languages, then English. */
export function localeFromAcceptLanguage(header: string | null | undefined): AdminLocale | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase();
    const base = tag.split('-')[0];
    if (isAdminLocale(base)) return base;
  }
  return null;
}
