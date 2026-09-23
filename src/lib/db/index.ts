import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Optional pool cap (e.g. DATABASE_POOL_MAX=1 for single-session local test
// databases). Unset keeps the postgres-js default.
const poolMax = parseInt(process.env.DATABASE_POOL_MAX || '', 10);

const client = postgres(process.env.DATABASE_URL || '', {
  prepare: false,
  ...(Number.isInteger(poolMax) && poolMax > 0 ? { max: poolMax } : {}),
});
export const db = drizzle(client, { schema });
