import type { AuditLog } from '@/lib/db/schema';
import { formatInstantEt } from '@/lib/crm/time';
import { StatusBadge } from './ui';

function summarize(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

/** Compact audit history for detail pages. */
export function AuditTrail({ rows }: { rows: AuditLog[] }) {
  if (rows.length === 0) return <p className="text-sm text-zayro-gray">No recorded changes.</p>;
  return (
    <ol className="text-xs grid gap-3">
      {rows.map((r) => (
        <li key={r.id} className="border-l-2 border-zayro-border pl-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zayro-dark">{r.operation}</span>
            {r.outcome !== 'success' && <StatusBadge status={r.outcome} />}
          </div>
          <div className="text-zayro-gray">
            {formatInstantEt(r.created_at)} · {r.actor_email ?? 'system'}
          </div>
          {r.before_data !== null && <div className="text-zayro-gray break-words">Before: {summarize(r.before_data)}</div>}
          {r.after_data !== null && <div className="text-zayro-gray break-words">After: {summarize(r.after_data)}</div>}
          {r.metadata !== null && <div className="text-zayro-gray break-words">{summarize(r.metadata)}</div>}
        </li>
      ))}
    </ol>
  );
}
