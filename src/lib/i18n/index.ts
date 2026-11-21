/**
 * Admin-panel i18n: one translator + formatter bundle per language, used the
 * same way by server components (`getAdminI18n`) and client components
 * (`useI18n`).
 */
import { createTranslator, type Translator } from './core';
import { createFormatters, type Formatters } from './format';
import { MESSAGES, type AdminMessageKey } from './messages';
import { translateApiMessage } from './messages/apiErrors';
import type { AdminLocale } from './config';

export * from './config';
export type { AdminMessageKey } from './messages';

export interface AdminI18n {
  locale: AdminLocale;
  t: Translator<AdminMessageKey>;
  f: Formatters;
  /** An admin API message (English) in this language. */
  apiMessage(message: string | null | undefined): string;
  /** A stored enum value ("card_terminal", "payment_pending") in this language; readable English if unknown. */
  label(value: string | null | undefined): string;
}

const readable = (value: string) => value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const bundles = new Map<AdminLocale, AdminI18n>();

const reportMissing = (key: string, locale: AdminLocale) => {
  if (process.env.NODE_ENV !== 'production') console.warn(`[i18n] missing ${locale} translation: ${key}`);
};

export function i18nFor(locale: AdminLocale): AdminI18n {
  let b = bundles.get(locale);
  if (!b) {
    const quiet = createTranslator<AdminMessageKey>(locale, MESSAGES);
    b = {
      locale,
      t: createTranslator<AdminMessageKey>(locale, MESSAGES, reportMissing),
      f: createFormatters(locale),
      apiMessage: (message) => translateApiMessage(locale, message),
      label: (value) => {
        if (!value) return '—';
        return quiet.dynamic(`values.${value}`, quiet.dynamic(`common.status.${value}`, readable(value)));
      },
    };
    bundles.set(locale, b);
  }
  return b;
}
