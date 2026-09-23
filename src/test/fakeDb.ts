/**
 * Minimal in-memory stand-in for the drizzle `db` object — just the calls
 * integrationSync / postConfirmation / the admin retry route make. Where
 * clauses are rendered to SQL so the fake can honour the id filter and the
 * update-if-null guard. Transactions are serialised, which is what the
 * per-booking advisory lock guarantees in Postgres.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { bookings, integrationLogs, services } from '@/lib/db/schema';
import type { Booking, Service } from '@/lib/db/schema';

const dialect = new PgDialect();

function render(cond: SQL | undefined) {
  return cond ? dialect.sqlToQuery(cond) : { sql: '', params: [] as unknown[] };
}

export function createFakeDb() {
  const state = {
    bookings: new Map<string, Booking>(),
    services: new Map<number, Service>(),
    logs: [] as any[],
    executed: [] as string[],
  };

  let queue: Promise<unknown> = Promise.resolve();

  const api = {
    query: {
      bookings: {
        findFirst: async ({ where }: { where: SQL }) => {
          const { params } = render(where);
          const b = state.bookings.get(String(params[0]));
          return b ? { ...b } : undefined;
        },
      },
      services: {
        findFirst: async ({ where }: { where: SQL }) => {
          const { params } = render(where);
          const s = state.services.get(Number(params[0]));
          return s ? { ...s } : undefined;
        },
      },
    },
    insert: (table: unknown) => ({
      values: async (values: any) => {
        if (table === integrationLogs) state.logs.push(values);
        else throw new Error('fakeDb: unsupported insert');
      },
    }),
    update: (table: unknown) => ({
      set: (values: Partial<Booking>) => ({
        where: (cond: SQL) => {
          if (table !== bookings) throw new Error('fakeDb: unsupported update');
          const { sql, params } = render(cond);
          const current = state.bookings.get(String(params[0]));
          let changed: Booking[] = [];
          const guardedNull = /"google_calendar_event_id" is null/.test(sql);
          if (current && !(guardedNull && current.google_calendar_event_id)) {
            const next = { ...current, ...values };
            state.bookings.set(current.id, next);
            changed = [next];
          }
          return Object.assign(Promise.resolve(changed), { returning: async () => changed });
        },
      }),
    }),
    execute: async (query: SQL) => {
      state.executed.push(render(query).sql);
      return [];
    },
  };

  const db = {
    ...api,
    state,
    transaction: async <T>(fn: (tx: typeof api) => Promise<T>): Promise<T> => {
      const run = queue.then(() => fn(api));
      queue = run.catch(() => undefined);
      return run;
    },
  };
  return db;
}

export type FakeDb = ReturnType<typeof createFakeDb>;

export { bookings, services };
