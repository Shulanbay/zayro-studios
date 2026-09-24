import type { db } from './index';

/** An open drizzle transaction. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The db handle or an open transaction. */
export type Executor = typeof db | Tx;

/** Rows from db.execute(): postgres-js returns an array, node-postgres a result object. */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] })?.rows ?? [])) as T[];
}

/** Postgres error code of a driver error (e.g. 23505 unique, 23P01 exclusion). */
export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === 'string' ? code : undefined;
}
