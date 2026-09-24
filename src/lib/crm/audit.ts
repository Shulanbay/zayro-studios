import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/types';

/**
 * Audit trail for every sensitive admin action. Payloads are sanitised:
 * secret-looking keys are dropped, long strings truncated and nesting
 * bounded, so an audit row can never leak a credential or a whole raw
 * provider payload.
 */

export interface AuditActor {
  id?: string | null;
  email?: string | null;
}

export interface AuditEntry {
  actor: AuditActor | null;
  operation: string;
  entityType: string;
  entityId?: string | number | null;
  outcome?: 'success' | 'denied' | 'failed';
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

const SECRET_KEY = /secret|token|password|passwd|private|api[_-]?key|authorization|signature|card|cvc|cvv|iban|ssn|client_secret/i;
const MAX_STRING = 1000;
const MAX_DEPTH = 5;
const MAX_ARRAY = 50;

export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((v) => sanitizeForAudit(v, depth + 1));
    if (value.length > MAX_ARRAY) items.push(`[+${value.length - MAX_ARRAY} more]`);
    return items;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) continue;
      if (typeof v === 'function') continue;
      out[k] = sanitizeForAudit(v, depth + 1);
    }
    return out;
  }
  return null;
}

/** Only the fields that changed (for before/after pairs on updates). */
export function diffFields<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    const prev = before[key];
    const next = after[key];
    const same =
      prev instanceof Date && next instanceof Date
        ? prev.getTime() === next.getTime()
        : JSON.stringify(prev) === JSON.stringify(next);
    if (!same) {
      b[key] = prev;
      a[key] = next as T[keyof T];
    }
  }
  return { before: b, after: a };
}

/**
 * Writes one audit row. Never throws: an audit failure is logged to the
 * server console but must not undo the action that was already committed.
 * Pass `exec` to write inside the caller's transaction.
 */
export async function writeAudit(entry: AuditEntry, exec: Executor = db): Promise<void> {
  try {
    await exec.insert(auditLogs).values({
      actor_id: entry.actor?.id ?? null,
      actor_email: entry.actor?.email ?? null,
      operation: entry.operation.slice(0, 80),
      entity_type: entry.entityType.slice(0, 60),
      entity_id: entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId).slice(0, 120),
      outcome: entry.outcome ?? 'success',
      before_data: entry.before === undefined ? null : (sanitizeForAudit(entry.before) as object),
      after_data: entry.after === undefined ? null : (sanitizeForAudit(entry.after) as object),
      metadata: entry.metadata ? (sanitizeForAudit(entry.metadata) as object) : null,
    });
  } catch (error) {
    console.error('[audit] failed to write audit log:', (error as Error)?.message || error);
  }
}
