import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { applyMigrations } from '../../../scripts/migrationRunner.mjs';

// Real Postgres (PGlite, in-process) — verifies the SQL itself, including
// the enum-value-then-use sequence that only works when each migration
// commits separately.

function clientFor(db: PGlite) {
  return {
    exec: async (text: string, params: unknown[] = []) => (await db.query(text, params as any[])).rows as any[],
    transaction: (fn: (exec: (text: string, params?: unknown[]) => Promise<any[]>) => Promise<void>) =>
      db.transaction(async (tx) => {
        await fn(async (text, params = []) => (await tx.query(text, params as any[])).rows as any[]);
      }),
  };
}

const PROD_PODCAST_SEED = `
  INSERT INTO services (name, description, base_price, duration_minutes, category, features) VALUES
  ('Single Podcaster', '1 camera, 1 microphone, Recording Only', 170, 60, 'podcast', '["1 camera","1 microphone","Recording Only"]'),
  ('Podcast Pro', '3 cameras, 2 microphones, Recording Only', 200, 60, 'podcast', '["3 cameras","2 microphones","Recording Only"]'),
  ('Full Podcast Package', 'Recording + Professional Editing', 450, 60, 'podcast', '["Recording","Professional Editing"]');
`;

/** A database in the state production is in today: 0000 + 0001 applied, three podcast services. */
async function productionLikeDb() {
  const db = new PGlite();
  const all = readMigrationFiles({ migrationsFolder: './drizzle' });
  await db.exec('CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)');
  for (const m of all.slice(0, 2)) {
    for (const stmt of m.sql) if (stmt.trim()) await db.exec(stmt);
    await db.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [m.hash, m.folderMillis]);
  }
  await db.exec(PROD_PODCAST_SEED);
  return db;
}

async function services(db: PGlite) {
  const res = await db.query<any>(
    'SELECT name, base_price::float AS price, duration_minutes, category::text, is_active, badge, session_count, validity_days, package_type, package_base_service_id, features FROM services ORDER BY id'
  );
  return res.rows;
}

describe('migrations 0002 + 0003 on a production-like database', () => {
  it('adds photography, packages and the tour without touching existing prices', async () => {
    const db = await productionLikeDb();
    const applied = await applyMigrations(clientFor(db), { migrationsFolder: './drizzle' });
    // 0002, 0003, 0004 (admin audit log enum value) and the CRM migrations 0005-0008.
    expect(applied).toHaveLength(7);

    const rows = await services(db);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

    // Existing podcast prices preserved
    expect(byName['Single Podcaster'].price).toBe(170);
    expect(byName['Podcast Pro'].price).toBe(200);
    expect(byName['Full Podcast Package'].price).toBe(450);
    expect(byName['Single Podcaster'].features).toEqual(['1 camera', '1 microphone', 'Recording Only']);
    expect(byName['Full Podcast Package'].features).toEqual(['Recording', 'Professional Editing']);
    expect(byName['Podcast Pro'].features).toContain('Up to 3 cameras');

    // Photography
    expect(byName['Headshot Session']).toMatchObject({ price: 250, duration_minutes: 45, category: 'photography' });
    expect(byName['Studio Photoshoot']).toMatchObject({ price: 350, duration_minutes: 90, category: 'photography' });
    expect(byName['Brand Content Session']).toMatchObject({
      price: 550,
      duration_minutes: 120,
      category: 'photography',
      badge: 'Most Popular',
    });

    // Tour
    expect(byName['Free Studio Tour']).toMatchObject({ price: 0, duration_minutes: 30, category: 'tour', is_active: true });

    // Packages
    const podcastProId = (await db.query<any>("SELECT id FROM services WHERE name = 'Podcast Pro'")).rows[0].id;
    const fullId = (await db.query<any>("SELECT id FROM services WHERE name = 'Full Podcast Package'")).rows[0].id;
    expect(byName['2 Sessions per Month']).toMatchObject({ price: 360, session_count: 2, validity_days: 30, package_type: 'studio_recording', package_base_service_id: podcastProId, category: 'package' });
    expect(byName['4 Sessions per Month']).toMatchObject({ price: 680, session_count: 4, badge: 'Most Popular' });
    expect(byName['8 Sessions per Month']).toMatchObject({ price: 1280, session_count: 8 });
    expect(byName['2 Full Production Sessions']).toMatchObject({ price: 810, session_count: 2, package_type: 'full_production', package_base_service_id: fullId });
    expect(byName['4 Full Production Sessions']).toMatchObject({ price: 1530, session_count: 4, badge: 'Best Value' });
    expect(byName['8 Full Production Sessions']).toMatchObject({ price: 2880, session_count: 8 });

    const enumValues = (await db.query<any>('SELECT enum_range(null::service_category)::text AS v')).rows[0].v;
    expect(enumValues).toBe('{podcast,video,livestream,editing,tour,photography,package}');
  });

  it('is idempotent: a second run applies nothing and duplicates nothing', async () => {
    const db = await productionLikeDb();
    await applyMigrations(clientFor(db), { migrationsFolder: './drizzle' });
    const before = await services(db);
    const again = await applyMigrations(clientFor(db), { migrationsFolder: './drizzle' });
    expect(again).toEqual([]);
    expect(await services(db)).toEqual(before);
    expect(before).toHaveLength(13);
  });

  it('re-running the SQL of 0002/0003 directly is also harmless (owner edits are kept)', async () => {
    const db = await productionLikeDb();
    await applyMigrations(clientFor(db), { migrationsFolder: './drizzle' });
    await db.query("UPDATE services SET base_price = 275, features = '[\"custom\"]' WHERE name = 'Headshot Session'");
    for (const file of ['0002_service_catalog_columns.sql', '0003_pricing_catalog.sql']) {
      for (const stmt of readFileSync(`drizzle/${file}`, 'utf8').split('--> statement-breakpoint')) {
        if (stmt.trim()) await db.exec(stmt);
      }
    }
    const rows = await services(db);
    expect(rows).toHaveLength(13);
    expect(rows.find((r) => r.name === 'Headshot Session')).toMatchObject({ price: 275, features: ['custom'] });
  });

  it('works on an empty database (packages simply have no base service yet)', async () => {
    const db = new PGlite();
    const applied = await applyMigrations(clientFor(db), { migrationsFolder: './drizzle' });
    expect(applied).toHaveLength(9);
    const rows = await services(db);
    expect(rows.filter((r) => r.category === 'package').every((r) => r.package_base_service_id === null)).toBe(true);
    expect(rows.filter((r) => r.category === 'photography')).toHaveLength(3);
  });

  it('0004 adds the admin integration type so cancellations can be audited', async () => {
    const db = await productionLikeDb();
    await applyMigrations(clientFor(db), { migrationsFolder: './drizzle' });
    const res = await db.query<{ v: string }>("SELECT unnest(enum_range(NULL::integration_type))::text AS v");
    expect(res.rows.map((r) => r.v)).toEqual(['stripe', 'google_calendar', 'google_sheets', 'email', 'admin']);
    await db.query("INSERT INTO integration_logs (integration_type, status) VALUES ('admin', 'success')");
  });
});
