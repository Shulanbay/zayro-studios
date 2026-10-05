import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * A jsonb column as an object in SQL, whichever way the row was written.
 * Older rows hold the JSON as a string (double-encoded by the driver);
 * `#>> '{}'` unwraps that string so ->> and friends work on every row.
 */
export function jsonObject(column: AnyPgColumn): SQL {
  return sql`(CASE WHEN jsonb_typeof(${column}) = 'string' THEN (${column} #>> '{}')::jsonb ELSE ${column} END)`;
}
