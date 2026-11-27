/** Pure helpers for ad spend (safe for the browser): platforms and the CSV paste parser. */

/** Paid platforms spend can be entered for (keys match analytics platforms). */
export const SPEND_PLATFORMS = ['google', 'meta', 'instagram', 'tiktok', 'reddit', 'pinterest', 'x', 'chatgpt', 'other'] as const;
export type SpendPlatform = (typeof SPEND_PLATFORMS)[number];

export interface SpendRow {
  date: string;
  platform: (typeof SPEND_PLATFORMS)[number];
  campaign: string;
  amount: number;
  clicks: number | null;
  impressions: number | null;
}

const ALIASES: Record<string, SpendPlatform> = {
  google: 'google', 'google ads': 'google', adwords: 'google', youtube: 'google',
  meta: 'meta', facebook: 'meta', fb: 'meta', 'meta ads': 'meta',
  instagram: 'instagram', ig: 'instagram',
  tiktok: 'tiktok', reddit: 'reddit', pinterest: 'pinterest',
  x: 'x', twitter: 'x', 'x ads': 'x',
  chatgpt: 'chatgpt', openai: 'chatgpt', 'chatgpt ads': 'chatgpt',
  other: 'other',
};

/** A real calendar day in YYYY-MM-DD form (2026-02-30 is not). */
export function isSpendDate(v: string | undefined): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const num = (s: string | undefined) => {
  const v = (s ?? '').replace(/[$\s,]/g, '');
  return v === '' ? null : Number(v);
};

/** Parses pasted CSV/TSV; returns rows and the 1-based line numbers that could not be read. */
export function parseSpendCsv(text: string): { rows: SpendRow[]; bad: number[] } {
  const rows: SpendRow[] = [];
  const bad: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const cells = (line.includes('\t') ? line.split('\t') : line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)).map((c) => c.trim().replace(/^"|"$/g, ''));
    const [date, platform, campaign, amount, clicks, impressions] = cells;
    if (i === 0 && !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return; // header
    const p = ALIASES[(platform ?? '').toLowerCase()];
    const a = num(amount);
    const c = num(clicks);
    const im = num(impressions);
    if (!isSpendDate(date) || !p || a === null || !Number.isFinite(a) || a < 0 || (c !== null && !Number.isInteger(c)) || (im !== null && !Number.isInteger(im))) {
      bad.push(i + 1);
      return;
    }
    rows.push({ date, platform: p, campaign: campaign ?? '', amount: a, clicks: c, impressions: im });
  });
  return { rows, bad };
}

