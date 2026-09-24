/**
 * Presentational building blocks for the admin CRM. Server-safe (no hooks),
 * so pages can render them directly.
 */
import Link from 'next/link';
import { formatCents } from '@/lib/crm/money';

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="text-sm text-zayro-gray hover:text-zayro-dark inline-flex items-center gap-1 mb-2">
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-[1.7rem] font-bold text-zayro-dark leading-tight break-words">{title}</h1>
          {description && <div className="text-sm text-zayro-gray mt-1">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          {title && <h2 className="text-base font-semibold text-zayro-dark">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, hint, tone = 'default' }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default' | 'warn' | 'bad' | 'good' }) {
  const toneClass = { default: 'text-zayro-dark', warn: 'text-amber-700', bad: 'text-red-700', good: 'text-emerald-700' }[tone];
  return (
    <div className="card !p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zayro-gray">{label}</div>
      <div className={`text-xl md:text-2xl font-bold mt-1 tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="text-xs text-zayro-gray mt-1">{hint}</div>}
    </div>
  );
}

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'violet';
const TONES: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  amber: 'bg-amber-50 text-amber-800 border-amber-100',
  red: 'bg-red-50 text-red-800 border-red-100',
  blue: 'bg-blue-50 text-blue-800 border-blue-100',
  gray: 'bg-slate-100 text-slate-700 border-slate-200',
  violet: 'bg-violet-50 text-violet-800 border-violet-100',
};

export function Badge({ tone = 'gray', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className={`crm-badge ${TONES[tone]}`} title={title}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  confirmed: 'green',
  completed: 'blue',
  no_show: 'violet',
  cancelled: 'gray',
  refunded: 'gray',
  payment_pending: 'amber',
  pending: 'amber',
  paid: 'green',
  approved: 'blue',
  partially_refunded: 'amber',
  failed: 'red',
  succeeded: 'green',
  requires_action: 'amber',
  canceled: 'gray',
  processed: 'green',
  processing: 'amber',
  received: 'amber',
  sent: 'green',
  skipped: 'amber',
  active: 'green',
  invited: 'amber',
  disabled: 'gray',
  expired: 'gray',
  exhausted: 'blue',
  merged: 'gray',
  archived: 'gray',
  success: 'green',
  denied: 'red',
};

export function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'gray'}>{label ?? humanize(status)}</Badge>;
}

export function Money({ cents, className = '' }: { cents: number | null | undefined; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatCents(cents ?? 0)}</span>;
}

export function EmptyState({ title, body, action }: { title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <p className="font-semibold text-zayro-dark">{title}</p>
      {body && <p className="text-sm text-zayro-gray mt-1 max-w-md mx-auto">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'amber', title, children }: { tone?: 'amber' | 'red' | 'blue' | 'green'; title?: string; children: React.ReactNode }) {
  const cls = {
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    red: 'bg-red-50 border-red-200 text-red-900',
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  }[tone];
  return (
    <div className={`border rounded-xl px-4 py-3 text-sm ${cls}`} role={tone === 'red' ? 'alert' : 'status'}>
      {title && <p className="font-semibold mb-0.5">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function DefinitionList({ items }: { items: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-[minmax(120px,190px)_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([label, value], i) => (
        <div key={i} className="contents">
          <dt className="text-zayro-gray">{label}</dt>
          <dd className="text-zayro-dark break-words min-w-0">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
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

export function Pagination({
  base,
  params,
  page,
  pageSize,
  total,
}: {
  base: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm" aria-label="Pagination">
      <span className="text-zayro-gray">
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className="crm-btn crm-btn-sm" href={withParams(base, params, { page: page - 1 })} rel="prev">
            Previous
          </Link>
        ) : (
          <span className="crm-btn crm-btn-sm opacity-40" aria-disabled="true">
            Previous
          </span>
        )}
        <span className="px-2 py-1 text-zayro-gray" aria-current="page">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link className="crm-btn crm-btn-sm" href={withParams(base, params, { page: page + 1 })} rel="next">
            Next
          </Link>
        ) : (
          <span className="crm-btn crm-btn-sm opacity-40" aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}

export function Forbidden({ what }: { what: string }) {
  return (
    <div className="card max-w-lg">
      <h1 className="text-lg font-semibold text-zayro-dark">No access</h1>
      <p className="text-sm text-zayro-gray mt-1">Your role doesn&apos;t include {what}. Ask the studio owner if you need it.</p>
    </div>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-zayro-gray mt-1">{hint}</p>}
    </div>
  );
}
