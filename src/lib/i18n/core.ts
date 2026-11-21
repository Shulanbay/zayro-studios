/**
 * The translation engine: typed message trees, an English fallback for any
 * missing key, `{name}` interpolation and plural forms (Intl.PluralRules).
 * No network calls — every string comes from the local message files.
 */
import { FALLBACK_LOCALE, INTL_LOCALE, type AdminLocale } from './config';
import { createFormatters } from './format';

/** A pluralised message: `{ $plural: { one: '{count} booking', other: '{count} bookings' } }`. */
export interface Plural {
  $plural: { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string };
}
export type MessageValue = string | Plural;
export interface MessageTree {
  [key: string]: MessageValue | MessageTree;
}

/** The same shape with every leaf optional (translations may lag behind English). */
export type PartialMessages<T> = {
  [K in keyof T]?: T[K] extends string ? string : T[K] extends Plural ? Plural : PartialMessages<T[K]>;
};

/** Every dotted path to a leaf ("analytics.kpi.visitors"). */
export type MessageKeys<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | Plural ? `${P}${K}` : MessageKeys<T[K], `${P}${K}.`>;
}[keyof T & string];

/** One namespace with its three translations side by side. English defines the shape. */
export function defineMessages<T extends MessageTree>(messages: { en: T; ru: PartialMessages<T>; kk: PartialMessages<T> }) {
  return messages;
}

export type Vars = Record<string, string | number | null | undefined>;

export function isPlural(value: unknown): value is Plural {
  return !!value && typeof value === 'object' && '$plural' in (value as object);
}

export function lookup(tree: unknown, key: string): MessageValue | undefined {
  let node: unknown = tree;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || isPlural(node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' || isPlural(node) ? node : undefined;
}

const pluralRules = new Map<string, Intl.PluralRules>();

/** Numbers in messages use the same deterministic formatter as the rest of the UI (hydration-safe). */
function interpolate(template: string, vars: Vars | undefined, locale: AdminLocale): string {
  if (!vars) return template;
  const f = createFormatters(locale);
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null) return match;
    return typeof v === 'number' ? f.number(v) : v;
  });
}

export interface Translator<K extends string = string> {
  locale: AdminLocale;
  /** Translated text; English when this language lacks the key; the key itself only if English lacks it too. */
  (key: K, vars?: Vars): string;
  /** For keys built at runtime (statuses, platform names): `fallback` when no language has the key. */
  dynamic(key: string, fallback: string, vars?: Vars): string;
  has(key: string): boolean;
}

export type MissingKeyHandler = (key: string, locale: AdminLocale) => void;

export function createTranslator<K extends string>(
  locale: AdminLocale,
  dictionaries: Record<AdminLocale, unknown>,
  onMissing?: MissingKeyHandler
): Translator<K> {
  const resolve = (key: string): { value: MessageValue; locale: AdminLocale } | undefined => {
    const own = lookup(dictionaries[locale], key);
    if (own !== undefined) return { value: own, locale };
    if (locale !== FALLBACK_LOCALE) {
      const fallback = lookup(dictionaries[FALLBACK_LOCALE], key);
      if (fallback !== undefined) {
        onMissing?.(key, locale);
        return { value: fallback, locale: FALLBACK_LOCALE };
      }
    }
    return undefined;
  };
  const render = (found: { value: MessageValue; locale: AdminLocale }, vars?: Vars) => {
    const tag = INTL_LOCALE[found.locale];
    if (isPlural(found.value)) {
      const count = Number(vars?.count ?? 0);
      let rules = pluralRules.get(tag);
      if (!rules) pluralRules.set(tag, (rules = new Intl.PluralRules(tag)));
      const forms = found.value.$plural;
      const form = (count === 0 && forms.zero) || forms[rules.select(count) as keyof Plural['$plural']] || forms.other;
      return interpolate(form, vars, locale);
    }
    return interpolate(found.value, vars, locale);
  };
  const translate = (key: string, vars?: Vars) => {
    const found = resolve(key);
    if (!found) {
      onMissing?.(key, locale);
      return key;
    }
    return render(found, vars);
  };
  return Object.assign(translate, {
    locale,
    dynamic: (key: string, fallback: string, vars?: Vars) => {
      const found = resolve(key);
      return found ? render(found, vars) : interpolate(fallback, vars, locale);
    },
    has: (key: string) => resolve(key) !== undefined,
  }) as Translator<K>;
}
