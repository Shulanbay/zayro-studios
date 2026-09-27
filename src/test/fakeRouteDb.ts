/**
 * Scriptable stand-in for the drizzle `db` object used by route tests.
 * Reads come from per-table resolver functions (given the rendered where
 * clause), and every write is recorded so tests can assert on it.
 */
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();

export interface RenderedWhere {
  sql: string;
  params: unknown[];
}

type Resolver = (where: RenderedWhere) => any;

export interface RouteDbScript {
  findFirst?: Record<string, Resolver>;
  findMany?: Record<string, Resolver>;
  /** Rows returned by update(...).returning() per table (default: one row echoing the values). */
  updateReturning?: Record<string, Resolver>;
  /** Rows returned by select().from(table).where(...) per table (default: none). */
  select?: Record<string, Resolver>;
}

export function render(where: SQL | undefined): RenderedWhere {
  return where ? (dialect.sqlToQuery(where) as RenderedWhere) : { sql: '', params: [] };
}

export function createRouteDb() {
  const script: RouteDbScript = {};
  const log = {
    reads: [] as { table: string; kind: 'findFirst' | 'findMany'; where: RenderedWhere }[],
    inserts: [] as { table: string; values: any }[],
    updates: [] as { table: string; values: any; where: RenderedWhere }[],
    executed: [] as string[],
    transactions: 0,
  };

  const query = new Proxy(
    {},
    {
      get(_target, table: string) {
        return {
          findFirst: async (opts: { where?: SQL } = {}) => {
            const where = render(opts.where);
            log.reads.push({ table, kind: 'findFirst', where });
            return script.findFirst?.[table]?.(where) ?? undefined;
          },
          findMany: async (opts: { where?: SQL } = {}) => {
            const where = render(opts.where);
            log.reads.push({ table, kind: 'findMany', where });
            return script.findMany?.[table]?.(where) ?? [];
          },
        };
      },
    }
  );

  const api = {
    query,
    insert: (table: any) => ({
      values: (values: any) => {
        const name = getTableName(table);
        log.inserts.push({ table: name, values });
        const rows = [{ id: `${name}-${log.inserts.length}`, ...values }];
        return Object.assign(Promise.resolve(rows), { returning: async () => rows });
      },
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: (cond: SQL) => {
          const name = getTableName(table);
          const where = render(cond);
          log.updates.push({ table: name, values, where });
          const rows = script.updateReturning?.[name]?.(where) ?? [{ ...values }];
          return Object.assign(Promise.resolve(rows), { returning: async () => rows });
        },
      }),
    }),
    select: (_fields?: unknown) => ({
      from: (table: any) => ({
        where: (cond: SQL) => {
          const name = getTableName(table);
          const rows = script.select?.[name]?.(render(cond)) ?? [];
          return Object.assign(Promise.resolve(rows), { limit: async (n: number) => rows.slice(0, n) });
        },
      }),
    }),
    execute: async (q: SQL) => {
      log.executed.push(render(q).sql);
      return [];
    },
  };

  return {
    ...api,
    script,
    log,
    transaction: async <T>(fn: (tx: typeof api) => Promise<T>) => {
      log.transactions++;
      return fn(api);
    },
    reset() {
      script.findFirst = {};
      script.findMany = {};
      script.updateReturning = {};
      script.select = {};
      log.reads.length = 0;
      log.inserts.length = 0;
      log.updates.length = 0;
      log.executed.length = 0;
      log.transactions = 0;
    },
  };
}

export type RouteDb = ReturnType<typeof createRouteDb>;
