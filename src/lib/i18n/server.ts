/**
 * Admin language for server components and route handlers.
 * Profile → cookie → role default (Marketing Analyst: Russian) → English.
 * Before sign-in: cookie → the browser's languages → English.
 */
import { cookies, headers } from 'next/headers';
import { ADMIN_LOCALE_COOKIE, FALLBACK_LOCALE, isAdminLocale, localeFromAcceptLanguage, resolveAdminLocale, type AdminLocale } from './config';
import { i18nFor, type AdminI18n } from './index';

export function adminLocaleFor(admin: { locale?: string | null; roleName?: string | null } | null | undefined): AdminLocale {
  const cookieLocale = cookies().get(ADMIN_LOCALE_COOKIE)?.value ?? null;
  if (admin) return resolveAdminLocale({ profileLocale: admin.locale, cookieLocale, roleName: admin.roleName });
  if (isAdminLocale(cookieLocale)) return cookieLocale;
  return localeFromAcceptLanguage(headers().get('accept-language')) ?? FALLBACK_LOCALE;
}

/** The translator + formatters for this request's admin (or visitor of the sign-in page). */
export function getAdminI18n(admin: { locale?: string | null; roleName?: string | null } | null | undefined): AdminI18n {
  return i18nFor(adminLocaleFor(admin));
}
