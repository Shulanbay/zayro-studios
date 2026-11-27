/** Small presentational pieces shared by the marketing admin pages (server-safe; text comes translated). */
import Link from 'next/link';

export function RangeTabs({ items, active }: { items: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="group">
      {items.map((p) => (
        <Link key={p.key} href={p.href} className={`crm-btn crm-btn-sm ${active === p.key ? 'crm-btn-primary' : ''}`} aria-current={active === p.key ? 'true' : undefined}>
          {p.label}
        </Link>
      ))}
    </div>
  );
}

/** A KPI tile with the change vs the previous period. */
export function Metric({ label, value, delta, hint, invert = false }: { label: string; value: string; delta?: { ratio: number | null; text: string } | null; hint?: string; invert?: boolean }) {
  const r = delta?.ratio ?? null;
  const good = r === null || r === 0 ? null : invert ? r < 0 : r > 0;
  return (
    <div className="card !p-4 min-w-0">
      <div className="text-xs font-medium uppercase tracking-wide text-zayro-gray break-words">{label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums text-zayro-dark break-words">{value}</div>
      {delta && (
        <div className={`text-xs mt-1 ${good === null ? 'text-zayro-gray' : good ? 'text-emerald-700' : 'text-red-700'}`}>
          {r === null ? '' : r > 0 ? '▲ ' : r < 0 ? '▼ ' : '• '}
          {delta.text}
        </div>
      )}
      {hint && <div className="text-xs text-zayro-gray mt-1">{hint}</div>}
    </div>
  );
}

export function Bars({ values, labels, format, title }: { values: number[]; labels: string[]; format: (v: number) => string; title: string }) {
  const max = Math.max(1, ...values);
  return (
    <div role="img" aria-label={title} className="flex items-end gap-[2px] h-28 w-full">
      {values.map((v, i) => (
        <div key={i} className="flex-1 min-w-[2px] bg-zayro-primary/80 rounded-t-sm" style={{ height: `${Math.max(v > 0 ? 3 : 0, (v / max) * 100)}%` }} title={`${labels[i]}: ${format(v)}`} />
      ))}
    </div>
  );
}

export const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-50 text-blue-800 border-blue-200',
  in_progress: 'bg-amber-50 text-amber-800 border-amber-200',
  booked: 'bg-violet-50 text-violet-800 border-violet-200',
  paid: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  rejected: 'bg-slate-100 text-slate-600 border-slate-200',
};
