/** Pure helpers for admin pages (usable from server and client components). */

/** "payment_pending" → "Payment pending" — last resort when no translation exists. */
export function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Builds a link to the same page with some query params replaced. */
export function withParams(base: string, params: Record<string, string | undefined>, changes: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...changes })) {
    if (v !== undefined && v !== null && String(v) !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
