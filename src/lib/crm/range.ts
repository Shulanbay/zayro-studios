import { addDays, isDateString, todayInTz } from './time';

/** Reads ?from=&to= (studio dates) with a default of the last `defaultDays` days. */
export function parseRange(params: { from?: string; to?: string }, defaultDays = 30): { from: string; to: string } {
  const today = todayInTz();
  let to = isDateString(params.to) ? params.to : today;
  let from = isDateString(params.from) ? params.from : addDays(to, -(defaultDays - 1));
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

export function parsePage(value: string | undefined): number {
  const n = parseInt(value ?? '1', 10);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 10000) : 1;
}
