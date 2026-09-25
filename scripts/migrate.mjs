// Applies pending SQL migrations from ./drizzle (see migrationRunner.mjs).
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
import postgres from 'postgres';
import { applyMigrations } from './migrationRunner.mjs';

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

// NOTICEs (e.g. "constraint skipped: overlapping bookings exist") go to the build log.
const client = postgres(url, {
  prepare: false,
  max: 1,
  onnotice: (n) => {
    if (!/skipping$/.test(n.message)) console.log(`[migrate] notice: ${n.message}`);
  },
});

// Counts only — never row contents — so the build log can be used to
// reconcile what the migrations did (see docs/crm-migration-and-rollback.md).
async function report(label) {
  try {
    const exists = async (t) => (await client.unsafe(`SELECT to_regclass($1) AS t`, [`public.${t}`]))[0].t !== null;
    const count = async (q) => Number((await client.unsafe(q))[0].n);
    const out = {
      bookings: await count('SELECT count(*) AS n FROM bookings'),
      customers: await count('SELECT count(*) AS n FROM customers'),
      services: await count('SELECT count(*) AS n FROM services'),
      payments: await count('SELECT count(*) AS n FROM payments'),
      blocked_times: await count('SELECT count(*) AS n FROM blocked_times'),
    };
    if (await exists('purchases')) {
      out.purchases = await count('SELECT count(*) AS n FROM purchases');
      out.bookings_without_purchase = await count('SELECT count(*) AS n FROM bookings WHERE purchase_id IS NULL');
      out.purchase_total_mismatches = await count(
        `SELECT count(*) AS n FROM purchases p JOIN bookings b ON b.purchase_id = p.id WHERE p.total_cents <> round(b.total_amount * 100)::int`
      );
      out.overlap_constraint = await count(`SELECT count(*) AS n FROM pg_constraint WHERE conname = 'bookings_no_overlap'`);
      out.roles = await count('SELECT count(*) AS n FROM roles');
    }
    console.log(`[migrate] ${label}: ${JSON.stringify(out)}`);
  } catch (error) {
    console.log(`[migrate] ${label}: report unavailable (${error?.message || error})`);
  }
}

try {
  await report('before');
  const applied = await applyMigrations(
    {
      exec: (text, params = []) => client.unsafe(text, params),
      transaction: (fn) => client.begin((tx) => fn((text, params = []) => tx.unsafe(text, params))),
    },
    { migrationsFolder: './drizzle', log: console.log }
  );
  console.log(`[migrate] Database migrations are up to date (${applied.length} applied in this run).`);
  await report('after');
} catch (error) {
  // Only the message — never the connection string.
  console.error('[migrate] Migration failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
