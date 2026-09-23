// Applies pending SQL migrations from ./drizzle using drizzle's migrator.
//
// Runs automatically as part of `npm run build`, but only for Vercel
// production builds (VERCEL_ENV=production) or when RUN_DB_MIGRATIONS=1 is
// set explicitly — local and preview builds never touch the database.
// Every migration in ./drizzle is written to be idempotent (IF NOT EXISTS /
// duplicate_object guards), so applying it to a database that was created
// with `drizzle-kit push` is safe.
//
// A failure exits non-zero, which fails the build and leaves the previous
// production deployment serving traffic.
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const shouldRun = process.env.VERCEL_ENV === 'production' || process.env.RUN_DB_MIGRATIONS === '1';

if (!shouldRun) {
  console.log('[migrate] Skipping database migrations (not a production build).');
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] DATABASE_URL is not set; cannot apply migrations.');
  process.exit(1);
}

const client = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

try {
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  console.log('[migrate] Database migrations are up to date.');
} catch (error) {
  // Only the message — never the connection string.
  console.error('[migrate] Migration failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
