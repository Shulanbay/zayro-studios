/** Integer-cent money helpers. Pure. */

export function decimalToCents(value: string | number | null | undefined): number {
  const n = typeof value === 'number' ? value : parseFloat(value ?? '');
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function taxCents(subtotalCents: number, rate: number): number {
  return Number.isFinite(rate) && rate > 0 ? Math.round(subtotalCents * rate) : 0;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatCents(cents: number | null | undefined): string {
  return usd.format((cents ?? 0) / 100);
}

/** Parses "$1,234.50" / "1234.5" typed by staff into cents; null when invalid. */
export function parseMoneyInput(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}
