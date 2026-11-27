/** Period presets for the marketing pages (studio-time days). */
import { addDays, isDateString, todayInTz } from '@/lib/crm/time';

export const RANGE_PRESETS = ['7d', '30d', '90d', 'month', 'prev'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number] | 'custom';

export interface MarketingRange {
  from: string;
  to: string;
  key: RangePreset;
}

export function presetRange(key: (typeof RANGE_PRESETS)[number], today = todayInTz()): { from: string; to: string } {
  const monthStart = `${today.slice(0, 8)}01`;
  const prevEnd = addDays(monthStart, -1);
  switch (key) {
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'month':
      return { from: monthStart, to: today };
    case 'prev':
      return { from: `${prevEnd.slice(0, 8)}01`, to: prevEnd };
  }
}

export function parseMarketingRange(sp: { range?: string; from?: string; to?: string }): MarketingRange {
  const preset = (RANGE_PRESETS as readonly string[]).includes(sp.range ?? '') ? (sp.range as (typeof RANGE_PRESETS)[number]) : null;
  if (preset) return { ...presetRange(preset), key: preset };
  if (isDateString(sp.from) && isDateString(sp.to)) {
    let [from, to] = [sp.from, sp.to];
    if (from > to) [from, to] = [to, from];
    if (from < addDays(to, -400)) from = addDays(to, -400);
    return { from, to, key: 'custom' };
  }
  return { ...presetRange('30d'), key: '30d' };
}

/** Same-length period right before (for "vs previous period"). */
export function previousOf(range: { from: string; to: string }) {
  const days = Math.round((Date.parse(`${range.to}T12:00:00Z`) - Date.parse(`${range.from}T12:00:00Z`)) / 86_400_000) + 1;
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

/** Each day of a range ("YYYY-MM-DD"). */
export function daysOf(range: { from: string; to: string }): string[] {
  const out: string[] = [];
  for (let d = range.from; d <= range.to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
