/**
 * Admin-panel localisation: dictionaries, translator, formatting, language
 * resolution, and a static check that every key used in the admin source
 * exists (so no raw "analytics.kpi.x" can ever reach the screen).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { ADMIN_LOCALES, defaultLocaleForRole, isAdminLocale, localeFromAcceptLanguage, resolveAdminLocale, type AdminLocale } from './config';
import { createTranslator, isPlural, lookup, type MessageTree } from './core';
import { createFormatters } from './format';
import { MESSAGES } from './messages';
import { API_MESSAGES, translateApiMessage } from './messages/apiErrors';
import { i18nFor } from './index';

type Leaf = { key: string; value: string | { $plural: Record<string, string> } };

function leaves(tree: unknown, prefix = ''): Leaf[] {
  const out: Leaf[] = [];
  for (const [k, v] of Object.entries(tree as MessageTree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' || isPlural(v)) out.push({ key, value: v as Leaf['value'] });
    else out.push(...leaves(v, key));
  }
  return out;
}
const texts = (v: Leaf['value']) => (typeof v === 'string' ? [v] : Object.values(v.$plural));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const EN = leaves(MESSAGES.en);

describe('dictionaries', () => {
  it('Russian and Kazakh translate every English key (no gaps, no extra keys)', () => {
    for (const locale of ['ru', 'kk'] as const) {
      const own = new Set(leaves(MESSAGES[locale]).map((l) => l.key));
      const missing = EN.filter((l) => !own.has(l.key)).map((l) => l.key);
      const extra = [...own].filter((k) => !EN.some((l) => l.key === k));
      expect(missing, `${locale} missing`).toEqual([]);
      expect(extra, `${locale} extra`).toEqual([]);
    }
  });

  it('every translation keeps the same {placeholders} as English', () => {
    for (const locale of ['ru', 'kk'] as const) {
      for (const l of EN) {
        const other = lookup(MESSAGES[locale], l.key);
        if (other === undefined) continue;
        const want = [...new Set(texts(l.value).flatMap(placeholders))].sort();
        for (const s of texts(other as Leaf['value'])) {
          const got = [...new Set(placeholders(s))].sort();
          // Plural forms may omit {count} only if English does too.
          expect(got.filter((p) => p !== 'count'), `${locale} ${l.key}: "${s}"`).toEqual(want.filter((p) => p !== 'count'));
        }
      }
    }
  });

  it('Russian plurals have one/few/many; plural objects exist in every language', () => {
    for (const l of EN.filter((x) => typeof x.value !== 'string')) {
      const ru = lookup(MESSAGES.ru, l.key);
      const kk = lookup(MESSAGES.kk, l.key);
      expect(isPlural(ru) && isPlural(kk), l.key).toBe(true);
      if (isPlural(ru)) expect(Object.keys(ru.$plural).sort(), l.key).toEqual(expect.arrayContaining(['one', 'few', 'many', 'other']));
    }
  });

  it('no word mixes Latin and Cyrillic letters (a typical typo, e.g. a Latin "e" in a Kazakh word)', () => {
    for (const locale of ['ru', 'kk'] as const) {
      for (const l of leaves(MESSAGES[locale])) {
        for (const s of texts(l.value)) {
          const bad = s.split(/[^\p{L}]+/u).filter((w) => /[A-Za-z]/.test(w) && /[Ѐ-ӿ]/.test(w));
          expect(bad, `${locale} ${l.key}`).toEqual([]);
        }
      }
    }
  });

  it('the Kazakh text is not a copy of the Russian one (shared loanwords excepted)', () => {
    // Single loanwords (Клиент, Платформа, Студия, Конверсия…) are the same in both
    // languages; an identical phrase of three or more words means it was not translated.
    const copies: string[] = [];
    for (const l of leaves(MESSAGES.kk)) {
      const ru = lookup(MESSAGES.ru, l.key);
      const kkText = texts(l.value).join('|');
      const ruText = ru === undefined ? '' : texts(ru as Leaf['value']).join('|');
      const cyrillicWords = kkText.split(/\s+/).filter((w) => /[Ѐ-ӿ]{2,}/.test(w)).length;
      if (kkText === ruText && cyrillicWords >= 3) copies.push(`${l.key}: ${kkText}`);
    }
    expect(copies).toEqual([]);
  });

  it('Kazakh uses Kazakh letters, not Russian-only phrasing, in long texts', () => {
    // Every Kazakh sentence of 8+ words should contain at least one letter specific to Kazakh (ә ғ қ ң ө ұ ү һ і).
    const offenders = leaves(MESSAGES.kk)
      .flatMap((l) => texts(l.value).map((s) => ({ key: l.key, s })))
      .filter(({ s }) => s.split(/\s+/).filter((w) => /[Ѐ-ӿ]/.test(w)).length >= 8 && !/[әғқңөұүһіӘҒҚҢӨҰҮҺІ]/.test(s));
    expect(offenders.map((o) => `${o.key}: ${o.s}`)).toEqual([]);
  });
});

describe('translator', () => {
  const dict = {
    en: { a: { hello: 'Hello {name}', only: 'English only', n: { $plural: { one: '{count} item', other: '{count} items' } } } },
    ru: { a: { hello: 'Привет, {name}', n: { $plural: { one: '{count} позиция', few: '{count} позиции', many: '{count} позиций', other: '{count} позиции' } } } },
    kk: { a: { hello: 'Сәлем, {name}' } },
  };

  it('switches between the three languages', () => {
    expect(createTranslator('en', dict)('a.hello', { name: 'Ann' })).toBe('Hello Ann');
    expect(createTranslator('ru', dict)('a.hello', { name: 'Ann' })).toBe('Привет, Ann');
    expect(createTranslator('kk', dict)('a.hello', { name: 'Ann' })).toBe('Сәлем, Ann');
  });

  it('falls back to English for a missing key and reports it', () => {
    const onMissing = vi.fn();
    const t = createTranslator('kk', dict, onMissing);
    expect(t('a.only')).toBe('English only');
    expect(onMissing).toHaveBeenCalledWith('a.only', 'kk');
    expect(t('a.n', { count: 2 })).toBe('2 items');
  });

  it('a key missing everywhere returns the key (and dynamic() returns the given fallback)', () => {
    const onMissing = vi.fn();
    const t = createTranslator('ru', dict, onMissing);
    expect(t('a.nope')).toBe('a.nope');
    expect(onMissing).toHaveBeenCalledWith('a.nope', 'ru');
    expect(t.dynamic('a.nope', 'Readable')).toBe('Readable');
    expect(t.has('a.hello')).toBe(true);
    expect(t.has('a.nope')).toBe(false);
  });

  it('Russian plural forms and locale-formatted numbers', () => {
    const t = createTranslator('ru', dict);
    expect(t('a.n', { count: 1 })).toBe('1 позиция');
    expect(t('a.n', { count: 3 })).toBe('3 позиции');
    expect(t('a.n', { count: 5 })).toBe('5 позиций');
    expect(t('a.n', { count: 21 })).toBe('21 позиция');
    expect(t('a.n', { count: 1500 })).toBe('1 500 позиций');
  });

  it('real dictionaries: same key, three languages, plurals', () => {
    expect(i18nFor('en').t('common.nav.analytics')).toBe('Analytics');
    expect(i18nFor('ru').t('common.nav.analytics')).toBe('Аналитика');
    expect(i18nFor('kk').t('common.nav.team')).toBe('Команда және рөлдер');
    expect(i18nFor('ru').t('customers.count', { count: 4 })).toBe('4 клиента');
    expect(i18nFor('ru').t('customers.count', { count: 11 })).toBe('11 клиентов');
    expect(i18nFor('en').t('customers.count', { count: 1 })).toBe('1 customer');
    expect(i18nFor('kk').label('card_terminal')).toBe('Карта терминалы');
    expect(i18nFor('ru').label('payment_pending')).toBe('Ожидает оплаты');
    expect(i18nFor('ru').label('something_new')).toBe('Something new');
  });
});

describe('formatting (ru-RU / kk-KZ / en-US)', () => {
  // Exact strings: the output must not depend on the runtime's ICU data, or the
  // server (Node) and the browser render different text and hydration breaks.
  const sp = (s: string) => s.replace(/\u00a0/g, ' ');
  it('dates, times and month names', () => {
    expect(createFormatters('en').date('2026-10-05')).toBe('Mon, Oct 5, 2026');
    expect(createFormatters('ru').date('2026-10-05')).toBe('пн, 5 окт. 2026 г.');
    expect(createFormatters('kk').date('2026-10-05')).toBe('дс, 5 қаз. 2026 ж.');
    expect(createFormatters('ru').date('2026-05-09')).toBe('сб, 9 мая 2026 г.');
    expect(createFormatters('en').time('14:30')).toBe('2:30 PM');
    expect(createFormatters('en').time('00:15')).toBe('12:15 AM');
    expect(createFormatters('ru').time('14:30')).toBe('14:30');
    expect(createFormatters('kk').time('09:05')).toBe('09:05');
    expect(createFormatters('ru').month('2026-11')).toBe('ноябрь 2026 г.');
    expect(createFormatters('kk').month('2026-11')).toBe('2026 ж. қараша');
    expect(createFormatters('en').month('2026-11-20')).toBe('November 2026');
    // Instants are shown in studio time (New York), whatever the server's time zone.
    expect(createFormatters('en').instant('2026-10-05T18:30:00Z')).toBe('Oct 5, 2026, 2:30 PM ET');
    expect(createFormatters('ru').instant('2026-10-05T18:30:00Z')).toBe('5 окт. 2026 г., 14:30 ET');
    expect(createFormatters('kk').instant('2026-01-01T03:00:00Z')).toBe('31 жел. 2025 ж., 22:00 ET');
    expect(createFormatters('kk').instantDate(new Date('2026-03-08T12:00:00Z'))).toBe('8 нау. 2026 ж.');
    expect(createFormatters('ru').date(null)).toBe('—');
  });

  it('numbers and percentages', () => {
    expect(createFormatters('en').number(1234567.8)).toBe('1,234,567.8');
    expect(sp(createFormatters('ru').number(1234567.8))).toBe('1 234 567,8');
    expect(sp(createFormatters('kk').number(1234567.8))).toBe('1 234 567,8');
    expect(createFormatters('ru').number(-1500)).toBe('-1\u00a0500');
    expect(createFormatters('en').percent(0.123)).toBe('12.3%');
    expect(sp(createFormatters('ru').percent(0.123))).toBe('12,3 %');
    expect(createFormatters('kk').percent(0.123)).toBe('12,3%');
    expect(createFormatters('en').percent(0.5, 0)).toBe('50%');
    expect(createFormatters('en').signedPercent(0.25)).toBe('+25%');
    expect(sp(createFormatters('ru').signedPercent(-0.1))).toBe('-10 %');
    expect(createFormatters('kk').signedPercent(0)).toBe('0%');
    expect(createFormatters('ru').percent(null)).toBe('—');
  });

  it('money keeps the data currency (USD) and never converts the amount', () => {
    for (const locale of ADMIN_LOCALES) {
      const s = sp(createFormatters(locale).money(123450));
      expect(s, locale).toContain('$');
      expect(s.replace(/[^\d]/g, ''), locale).toBe('123450');
    }
    expect(createFormatters('en').money(123450)).toBe('$1,234.50');
    expect(sp(createFormatters('ru').money(123450))).toBe('1 234,50 $');
    expect(sp(createFormatters('kk').money(21775))).toBe('217,75 $');
    expect(createFormatters('en').money(-500)).toBe('-$5.00');
    expect(createFormatters('en').moneyWhole(15000)).toBe('$150');
    expect(sp(createFormatters('ru').moneyWhole(1550000))).toBe('15 500 $');
  });

  it('period labels and weekdays', () => {
    expect(createFormatters('en').dateRange('2026-10-01', '2026-10-31')).toBe('Oct 1 – 31, 2026');
    expect(createFormatters('en').dateRange('2026-10-22', '2026-11-20')).toBe('Oct 22 – Nov 20, 2026');
    expect(createFormatters('en').dateRange('2025-12-30', '2026-01-05')).toBe('Dec 30, 2025 – Jan 5, 2026');
    expect(createFormatters('ru').dateRange('2026-10-22', '2026-11-20')).toBe('22 окт. – 20 нояб. 2026 г.');
    expect(createFormatters('ru').dateRange('2026-10-01', '2026-10-31')).toBe('1–31 окт. 2026 г.');
    expect(createFormatters('kk').dateRange('2026-10-22', '2026-11-20')).toBe('22 қаз. – 20 қар. 2026 ж.');
    expect(createFormatters('kk').dateRange('2026-11-20', '2026-11-20')).toBe('20 қар. 2026 ж.');
    expect(createFormatters('ru').weekday(1)).toBe('пн');
    expect(createFormatters('en').weekday(0, 'long')).toBe('Sunday');
    expect(createFormatters('kk').weekday(1, 'long')).toBe('дүйсенбі');
    expect(createFormatters('kk').weekday(7)).toBe('жс');
  });

  it('does not use the runtime’s ru/kk locale data (hydration-safe)', () => {
    const src = readFileSync('src/lib/i18n/format.ts', 'utf8');
    expect(src).not.toMatch(/Intl\.(NumberFormat|DateTimeFormat)\(\s*(tag|intl|INTL_LOCALE|'ru|'kk)/);
  });
});

describe('language resolution', () => {
  it('profile → cookie → role default (Marketing Analyst = Russian) → English', () => {
    expect(resolveAdminLocale({ profileLocale: 'kk', cookieLocale: 'en', roleName: 'Marketing Analyst' })).toBe('kk');
    expect(resolveAdminLocale({ profileLocale: null, cookieLocale: 'en', roleName: 'Marketing Analyst' })).toBe('en');
    expect(resolveAdminLocale({ profileLocale: null, cookieLocale: null, roleName: 'Marketing Analyst' })).toBe('ru');
    expect(resolveAdminLocale({ profileLocale: null, cookieLocale: null, roleName: 'Owner' })).toBe('en');
    expect(resolveAdminLocale({ profileLocale: 'xx', cookieLocale: 'de', roleName: 'Owner' })).toBe('en');
    expect(defaultLocaleForRole('Marketing Analyst')).toBe('ru');
    expect(isAdminLocale('kk')).toBe(true);
    expect(isAdminLocale('kz')).toBe(false);
  });

  it('sign-in page: the browser’s languages', () => {
    expect(localeFromAcceptLanguage('kk-KZ,kk;q=0.9,ru;q=0.8')).toBe('kk');
    expect(localeFromAcceptLanguage('ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru');
    expect(localeFromAcceptLanguage('de-DE,fr;q=0.8')).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });
});

describe('API messages', () => {
  it('known API messages are translated; unknown ones stay in English', () => {
    expect(translateApiMessage('ru', 'Booking not found')).toBe('Бронирование не найдено');
    expect(translateApiMessage('kk', 'Customer saved')).toBe('Клиент сақталды');
    expect(translateApiMessage('en', 'Customer saved')).toBe('Customer saved');
    expect(translateApiMessage('ru', 'Something brand new')).toBe('Something brand new');
  });

  it('every static error/success message of the admin API has a Russian and Kazakh translation', () => {
    const files = [...walk('src/app/api/admin'), ...walk('src/lib/crm')].filter((f) => f.endsWith('.ts') && !f.includes('.test.'));
    const found = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:error|message): '([^']+)'|new CrmError\('([^']+)'|conflict\('([^']+)'/g)) found.add(m[1] ?? m[2] ?? m[3]);
      for (const m of src.matchAll(/notFound\('([^']+)'\)/g)) found.add(`${m[1]} not found`);
    }
    const missing = [...found].filter((msg) => !API_MESSAGES.ru[msg] || !API_MESSAGES.kk[msg]);
    expect(missing).toEqual([]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('no untranslated keys in the admin UI (static check)', () => {
  const ADMIN_SOURCES = [
    ...walk('src/app/admin'),
    ...walk('src/components/crm'),
    'src/components/admin/AdminControls.tsx',
    'src/components/admin/AdminServicesManager.tsx',
    'src/components/admin/AdminAddonsManager.tsx',
    'src/app/api/admin/analytics/export/route.ts',
  ].filter((f) => /\.(tsx?|ts)$/.test(f) && !f.includes('.test.'));
  const enKeys = new Set(EN.map((l) => l.key));

  it('every literal key passed to t(...) exists in English', () => {
    const bad: string[] = [];
    for (const f of ADMIN_SOURCES) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'/g)) if (!enKeys.has(m[1])) bad.push(`${f}: ${m[1]}`);
      // t(cond ? 'a.b' : 'c.d') — both branches.
      for (const m of src.matchAll(/\bt\(\s*[^'`()]+\?\s*'([a-zA-Z0-9_.-]+)'\s*:\s*'([a-zA-Z0-9_.-]+)'/g)) for (const k of [m[1], m[2]]) if (!enKeys.has(k)) bad.push(`${f}: ${k}`);
    }
    expect(bad).toEqual([]);
  });

  it('every template key prefix t(`ns.${x}`) points at an existing group', () => {
    const bad: string[] = [];
    for (const f of ADMIN_SOURCES) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt(?:\.dynamic)?\(\s*`([a-zA-Z0-9_.-]+)\.\$\{/g)) {
        const prefix = `${m[1]}.`;
        if (![...enKeys].some((k) => k.startsWith(prefix))) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('switching language refreshes the same URL (filters, period and page are kept) and never navigates', () => {
    const src = readFileSync('src/components/crm/i18n.tsx', 'utf8');
    expect(src).toContain('router.refresh()');
    expect(src).not.toMatch(/router\.(push|replace)\(/);
    const route = readFileSync('src/app/api/admin/locale/route.ts', 'utf8');
    expect(route).not.toMatch(/redirect/i);
  });

  it('no online translation service is used at runtime', () => {
    const all = [...walk('src/lib/i18n'), 'src/components/crm/i18n.tsx'].filter((f) => !f.includes('.test.')).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(all).not.toMatch(/fetch\(\s*['`]https?:|translate\.googleapis|deepl|api\.openai/i);
  });
});

describe('every language renders every key', () => {
  it.each(ADMIN_LOCALES as unknown as AdminLocale[])('%s: no key resolves to itself', (locale) => {
    const t = i18nFor(locale).t;
    const raw = EN.filter((l) => (t as (k: string, v?: Record<string, number>) => string)(l.key, { count: 2 }) === l.key).map((l) => l.key);
    expect(raw).toEqual([]);
  });
});
