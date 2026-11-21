/**
 * Locale-aware formatting for the admin panel (ru-RU / kk-KZ / en-US).
 *
 * Deterministic on purpose: the server (Node) and the browser ship different
 * ICU/CLDR data (e.g. Chrome writes USD in kk-KZ as "$ 217.75", Node as
 * "217,75 $"), and any difference breaks React hydration. So Intl is only
 * used in en-US mode — for digits, rounding and time-zone conversion, which
 * are identical everywhere — and the locale-specific parts (separators,
 * month and weekday names, word order) come from the tables below.
 *
 * Money keeps the data's own currency (USD): switching language changes how
 * a value is written, never the value or the currency. Studio times are
 * shown in the studio's time zone (America/New_York).
 */
import { INTL_LOCALE, type AdminLocale } from './config';

export const STUDIO_TIME_ZONE = 'America/New_York';
export const DATA_CURRENCY = 'USD';

const NBSP = ' ';
const DASH = '—';

interface LocaleData {
  group: string;
  decimal: string;
  /** Text between the number and "%" ("" in en/kk, NBSP in ru). */
  percentGap: string;
  money(amount: string, symbol: string): string;
  monthsShort: string[];
  monthsLong: string[];
  weekdaysShort: string[];
  weekdaysLong: string[];
  /** "Mon, Oct 5, 2026" */
  date(p: DateParts): string;
  /** "Oct 5" */
  dayMonth(p: DateParts): string;
  /** "Oct 5, 2026" */
  dayMonthYear(p: DateParts): string;
  /** "October 2026" */
  monthYear(p: DateParts): string;
  time(h: number, m: number): string;
  /** "Oct 1 – 31, 2026" / "Oct 5 – Nov 3, 2026" */
  range(a: DateParts, b: DateParts): string;
}

interface DateParts {
  y: number;
  /** 1–12 */
  mo: number;
  d: number;
  /** 0 = Sunday */
  wd: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const EN: LocaleData = {
  group: ',',
  decimal: '.',
  percentGap: '',
  money: (amount, symbol) => (amount.startsWith('-') ? `-${symbol}${amount.slice(1)}` : `${symbol}${amount}`),
  monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  monthsLong: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  weekdaysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  date: (p) => `${EN.weekdaysShort[p.wd]}, ${EN.monthsShort[p.mo - 1]} ${p.d}, ${p.y}`,
  dayMonth: (p) => `${EN.monthsShort[p.mo - 1]} ${p.d}`,
  dayMonthYear: (p) => `${EN.monthsShort[p.mo - 1]} ${p.d}, ${p.y}`,
  monthYear: (p) => `${EN.monthsLong[p.mo - 1]} ${p.y}`,
  time: (h, m) => `${h % 12 === 0 ? 12 : h % 12}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'}`,
  range: (a, b) =>
    a.y !== b.y
      ? `${EN.dayMonthYear(a)} – ${EN.dayMonthYear(b)}`
      : a.mo === b.mo
        ? `${EN.monthsShort[a.mo - 1]} ${a.d} – ${b.d}, ${a.y}`
        : `${EN.dayMonth(a)} – ${EN.dayMonth(b)}, ${a.y}`,
};

const RU: LocaleData = {
  group: NBSP,
  decimal: ',',
  percentGap: NBSP,
  money: (amount, symbol) => `${amount}${NBSP}${symbol}`,
  // Genitive short forms, as used after a day number ("5 мая").
  monthsShort: ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'],
  monthsLong: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
  weekdaysShort: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  weekdaysLong: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
  date: (p) => `${RU.weekdaysShort[p.wd]}, ${p.d} ${RU.monthsShort[p.mo - 1]} ${p.y} г.`,
  dayMonth: (p) => `${p.d} ${RU.monthsShort[p.mo - 1]}`,
  dayMonthYear: (p) => `${p.d} ${RU.monthsShort[p.mo - 1]} ${p.y} г.`,
  monthYear: (p) => `${RU.monthsLong[p.mo - 1]} ${p.y} г.`,
  time: (h, m) => `${pad2(h)}:${pad2(m)}`,
  range: (a, b) =>
    a.y !== b.y
      ? `${RU.dayMonthYear(a)} – ${RU.dayMonthYear(b)}`
      : a.mo === b.mo
        ? `${a.d}–${b.d} ${RU.monthsShort[a.mo - 1]} ${a.y} г.`
        : `${RU.dayMonth(a)} – ${RU.dayMonth(b)} ${a.y} г.`,
};

const KK: LocaleData = {
  group: NBSP,
  decimal: ',',
  percentGap: '',
  money: (amount, symbol) => `${amount}${NBSP}${symbol}`,
  monthsShort: ['қаң.', 'ақп.', 'нау.', 'сәу.', 'мам.', 'мау.', 'шіл.', 'там.', 'қыр.', 'қаз.', 'қар.', 'жел.'],
  monthsLong: ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'],
  weekdaysShort: ['жс', 'дс', 'сс', 'ср', 'бс', 'жм', 'сб'],
  weekdaysLong: ['жексенбі', 'дүйсенбі', 'сейсенбі', 'сәрсенбі', 'бейсенбі', 'жұма', 'сенбі'],
  date: (p) => `${KK.weekdaysShort[p.wd]}, ${p.d} ${KK.monthsShort[p.mo - 1]} ${p.y} ж.`,
  dayMonth: (p) => `${p.d} ${KK.monthsShort[p.mo - 1]}`,
  dayMonthYear: (p) => `${p.d} ${KK.monthsShort[p.mo - 1]} ${p.y} ж.`,
  monthYear: (p) => `${p.y} ж. ${KK.monthsLong[p.mo - 1]}`,
  time: (h, m) => `${pad2(h)}:${pad2(m)}`,
  range: (a, b) =>
    a.y !== b.y
      ? `${KK.dayMonthYear(a)} – ${KK.dayMonthYear(b)}`
      : a.mo === b.mo
        ? `${a.d}–${b.d} ${KK.monthsShort[a.mo - 1]} ${a.y} ж.`
        : `${KK.dayMonth(a)} – ${KK.dayMonth(b)} ${a.y} ж.`,
};

const DATA: Record<AdminLocale, LocaleData> = { en: EN, ru: RU, kk: KK };

// --- en-US Intl helpers (identical data in every runtime) ---------------------

const nfCache = new Map<string, Intl.NumberFormat>();
function enNumberParts(value: number, opts: Intl.NumberFormatOptions): Intl.NumberFormatPart[] {
  const key = JSON.stringify(opts);
  let nf = nfCache.get(key);
  if (!nf) nfCache.set(key, (nf = new Intl.NumberFormat('en-US', { ...opts, style: 'decimal', currency: undefined, currencyDisplay: undefined })));
  return nf.formatToParts(value);
}

/** Digits with this locale's separators. */
function localNumber(data: LocaleData, value: number, opts: Intl.NumberFormatOptions = {}): string {
  return enNumberParts(value, opts)
    .map((p) => (p.type === 'group' ? data.group : p.type === 'decimal' ? data.decimal : p.type === 'minusSign' ? '-' : p.value))
    .join('');
}

const tzFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: STUDIO_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** An instant's wall-clock date and time in the studio's time zone. */
function studioParts(d: Date): DateParts & { h: number; mi: number } {
  const parts = Object.fromEntries(tzFormat.formatToParts(d).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), wd: WD.indexOf(parts.weekday), h: Number(parts.hour) % 24, mi: Number(parts.minute) };
}

/** "YYYY-MM-DD" → calendar parts (no time zone involved). */
function ymdParts(ymd: string): DateParts {
  const [y, mo, d] = ymd.slice(0, 10).split('-').map(Number);
  return { y, mo, d, wd: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}

const asDate = (value: Date | string | number | null | undefined): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};
const isYmd = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}/.test(s);

export interface Formatters {
  locale: AdminLocale;
  intl: string;
  /** Cents → "$1,234.50" / "1 234,50 $" (always the data currency). */
  money(cents: number | null | undefined): string;
  /** Whole dollars, no decimals. */
  moneyWhole(cents: number | null | undefined): string;
  number(value: number | null | undefined, opts?: Intl.NumberFormatOptions): string;
  /** A ratio (0.123) → "12.3%" / "12,3 %". */
  percent(ratio: number | null | undefined, digits?: number): string;
  /** A relative change (0.25) → "+25%" / "-10 %". */
  signedPercent(ratio: number | null | undefined, digits?: number): string;
  /** "YYYY-MM-DD" → "Mon, Oct 5, 2026" / "пн, 5 окт. 2026 г." */
  date(ymd: string | null | undefined): string;
  /** "YYYY-MM-DD" → "Oct 5" / "5 окт." */
  dateShort(ymd: string | null | undefined): string;
  /** "YYYY-MM-DD" → "Oct 5, 2026" */
  dateMedium(ymd: string | null | undefined): string;
  /** "YYYY-MM" or a date → "October 2026" */
  month(ymdOrYm: string): string;
  /** "14:30" → "2:30 PM" / "14:30" */
  time(hhmm: string | null | undefined): string;
  /** An instant in studio time: "Oct 5, 2026, 2:30 PM ET". */
  instant(value: Date | string | number | null | undefined): string;
  /** An instant, date only, studio time. */
  instantDate(value: Date | string | number | null | undefined): string;
  /** Weekday name for 0 = Sunday … 6 = Saturday. */
  weekday(index: number, style?: 'short' | 'long'): string;
  /** "Oct 5 – Nov 3, 2026" */
  dateRange(fromYmd: string, toYmd: string): string;
}

const SYMBOL = '$'; // DATA_CURRENCY is USD; written as "$" in every admin language.

export function createFormatters(locale: AdminLocale): Formatters {
  const L = DATA[locale];
  const pct = (ratio: number, digits: number, signed: boolean) => {
    const body = localNumber(L, Math.abs(ratio) * 100, { minimumFractionDigits: signed ? 0 : digits, maximumFractionDigits: digits });
    const sign = ratio < 0 ? '-' : signed && ratio > 0 ? '+' : '';
    return `${sign}${body}${L.percentGap}%`;
  };
  return {
    locale,
    intl: INTL_LOCALE[locale],
    money: (cents) => L.money(localNumber(L, (cents ?? 0) / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), SYMBOL),
    moneyWhole: (cents) => L.money(localNumber(L, Math.round((cents ?? 0) / 100), { maximumFractionDigits: 0 }), SYMBOL),
    number: (value, opts = {}) => (value === null || value === undefined || !Number.isFinite(value) ? DASH : localNumber(L, value, opts)),
    percent: (ratio, digits = 1) => (ratio === null || ratio === undefined || !Number.isFinite(ratio) ? DASH : pct(ratio, digits, false)),
    signedPercent: (ratio, digits = 0) => (ratio === null || ratio === undefined || !Number.isFinite(ratio) ? DASH : pct(ratio, digits, true)),
    date: (ymd) => (isYmd(ymd) ? L.date(ymdParts(ymd)) : DASH),
    dateShort: (ymd) => (isYmd(ymd) ? L.dayMonth(ymdParts(ymd)) : DASH),
    dateMedium: (ymd) => (isYmd(ymd) ? L.dayMonthYear(ymdParts(ymd)) : DASH),
    month: (ymdOrYm) => L.monthYear(ymdParts(ymdOrYm.length === 7 ? `${ymdOrYm}-01` : ymdOrYm)),
    time: (hhmm) => {
      if (!hhmm || !/^\d{1,2}:\d{2}/.test(hhmm)) return DASH;
      const [h, m] = hhmm.split(':').map(Number);
      return L.time(h % 24, m);
    },
    instant: (value) => {
      const d = asDate(value);
      if (!d) return DASH;
      const p = studioParts(d);
      return `${L.dayMonthYear(p)}, ${L.time(p.h, p.mi)} ET`;
    },
    instantDate: (value) => {
      const d = asDate(value);
      return d ? L.dayMonthYear(studioParts(d)) : DASH;
    },
    weekday: (index, style = 'short') => (style === 'long' ? L.weekdaysLong : L.weekdaysShort)[((index % 7) + 7) % 7],
    dateRange: (fromYmd, toYmd) => (fromYmd === toYmd ? L.dayMonthYear(ymdParts(fromYmd)) : L.range(ymdParts(fromYmd), ymdParts(toYmd))),
  };
}
