// Shared migration logic, used by scripts/migrate.mjs (postgres-js) and by
// the test suite (PGlite). Compatible with drizzle's own bookkeeping table
// ("drizzle"."__drizzle_migrations", keyed by the journal's `when`).
//
// Unlike drizzle's built-in migrator, every migration file runs in its own
// transaction. Postgres doesn't allow a value added with
// `ALTER TYPE ... ADD VALUE` to be used in the same transaction, so a data
// migration that inserts rows with a new enum value must commit after the
// migration that adds it.
import { readMigrationFiles } from 'drizzle-orm/migrator';

const LOCK_KEY = 72_107_311; // arbitrary, identifies "zayro migrations"

/**
 * @param {{
 *   exec: (text: string, params?: unknown[]) => Promise<any[]>,
 *   transaction: (fn: (exec: (text: string, params?: unknown[]) => Promise<any[]>) => Promise<void>) => Promise<void>,
 * }} client
 * @param {{ migrationsFolder?: string, log?: (msg: string) => void }} [options]
 * @returns {Promise<string[]>} tags of the migrations applied by this run
 */
export async function applyMigrations(client, options = {}) {
  const { migrationsFolder = './drizzle', log = () => {} } = options;

  await client.exec('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await client.exec(
    'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)'
  );

  const migrations = readMigrationFiles({ migrationsFolder });
  const applied = [];

  for (const migration of migrations) {
    let ran = false;
    await client.transaction(async (exec) => {
      // Serialises concurrent builds; released at commit/rollback.
      await exec(`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
      const done = await exec(
        'SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at >= $1 LIMIT 1',
        [migration.folderMillis]
      );
      if (done.length > 0) return;

      for (const statement of migration.sql) {
        if (statement.trim()) await exec(statement);
      }
      await exec('INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)', [
        migration.hash,
        migration.folderMillis,
      ]);
      ran = true;
    });
    if (ran) {
      applied.push(String(migration.folderMillis));
      log(`[migrate] applied migration created at ${migration.folderMillis}`);
    }
  }

  return applied;
}
