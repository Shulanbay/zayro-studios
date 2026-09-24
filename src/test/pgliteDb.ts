/**
 * A real Postgres for tests: PGlite (in-process, WASM) with btree_gist,
 * every migration in ./drizzle applied, wrapped in drizzle's node-postgres
 * driver so application code runs unmodified against it.
 *
 * PGlite is a single connection. To keep concurrent callers from running
 * statements inside someone else's transaction, every transaction (and
 * every statement outside one) takes a mutex; statements issued from inside
 * a transaction callback bypass it via AsyncLocalStorage. That is the same
 * serialisation a pool + row/advisory locks give in production, so tests
 * about "two requests at once" still exercise the real constraints.
 *
 * Driver value shapes mirror postgres-js in production: date, timestamp,
 * numeric and int8 come back as raw strings.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { PGlite, types } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/lib/db/schema';
import { applyMigrations } from '../../scripts/migrationRunner.mjs';

const raw = (v: string) => v;
const PARSERS = {
  [types.DATE]: raw,
  [types.TIMESTAMP]: raw,
  [types.TIMESTAMPTZ]: raw,
  [types.NUMERIC]: raw,
  [types.INT8]: raw,
};

export async function createTestDb() {
  const pg = new PGlite({ extensions: { btree_gist } });

  await applyMigrations(
    {
      exec: async (text: string, params: unknown[] = []) => (await pg.query(text, params as any[])).rows as any[],
      transaction: (fn: (exec: (text: string, params?: unknown[]) => Promise<any[]>) => Promise<void>) =>
        pg.transaction(async (tx) => {
          await fn(async (text, params = []) => (await tx.query(text, params as any[])).rows as any[]);
        }),
    },
    { migrationsFolder: './drizzle' }
  );

  const inTx = new AsyncLocalStorage<true>();
  let chain: Promise<unknown> = Promise.resolve();
  const serialised = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  const client = {
    async query(config: string | { text: string; rowMode?: string }, params?: unknown[]) {
      const text = typeof config === 'string' ? config : config.text;
      const rowMode = typeof config === 'object' && config.rowMode === 'array' ? 'array' : 'object';
      const run = () => pg.query(text, (params ?? []) as any[], { rowMode, parsers: PARSERS });
      const res = inTx.getStore() ? await run() : await serialised(run);
      return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length, fields: res.fields };
    },
  };

  const db = drizzle(client as any, { schema });
  const baseTransaction = db.transaction.bind(db);
  (db as any).transaction = (fn: any, config?: any) =>
    inTx.getStore() ? baseTransaction(fn, config) : serialised(() => inTx.run(true, () => baseTransaction(fn, config)));

  return { db, pg };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>['db'];

/** Rows from db.execute(): postgres-js returns an array, node-postgres a result object. */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

/**
 * On an empty database migration 0003 already created the tour, the
 * photography services and the packages. Add the three podcast services
 * (which production had before 0003) and open every day 08:00–22:00.
 * Returns service ids by name.
 */
export async function seedCatalog(pg: PGlite): Promise<Record<string, number>> {
  await pg.exec(`
    INSERT INTO services (id, name, base_price, duration_minutes, category, display_order) VALUES
      (101, 'Single Podcaster', 170, 60, 'podcast', 10),
      (102, 'Podcast Pro', 200, 60, 'podcast', 20),
      (103, 'Full Podcast Package', 450, 60, 'podcast', 30)
    ON CONFLICT (id) DO NOTHING;
    SELECT setval(pg_get_serial_sequence('services', 'id'), 200);
    INSERT INTO availability (day_of_week, start_time, end_time, is_available)
      SELECT d::day_of_week, '08:00', '22:00', true
        FROM unnest(ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']) d
       WHERE NOT EXISTS (SELECT 1 FROM availability);
    INSERT INTO business_settings (setting_key, setting_value) VALUES ('tax_rate', '0.08875')
      ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;
  `);
  const res = await pg.query<{ id: number; name: string }>('SELECT id, name FROM services');
  return Object.fromEntries(res.rows.map((r) => [r.name, r.id]));
}
