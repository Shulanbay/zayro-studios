import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Optional pool cap (e.g. DATABASE_POOL_MAX=1 for single-session local test
// databases). Unset keeps the postgres-js default.
const poolMax = parseInt(process.env.DATABASE_POOL_MAX || '', 10);

function createClient() {
  return postgres(process.env.DATABASE_URL || '', {
    prepare: false,
    ...(Number.isInteger(poolMax) && poolMax > 0 ? { max: poolMax } : {}),
  });
}

// `next dev` re-evaluates this module on every hot reload; without reusing
// the client each reload would open a new pool and leak connections until
// Postgres refuses more ("too many clients"). Production loads it once.
const globalForDb = globalThis as unknown as { __zayroSql?: ReturnType<typeof postgres> };
const client = globalForDb.__zayroSql ?? createClient();
if (process.env.NODE_ENV !== 'production') globalForDb.__zayroSql = client;

export const db = drizzle(client, { schema });
