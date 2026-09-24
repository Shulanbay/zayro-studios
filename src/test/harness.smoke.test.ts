import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, seedCatalog } from './pgliteDb';
import { bookings, customers, services } from '@/lib/db/schema';

describe('pglite harness', () => {
  it('runs drizzle against migrated postgres', async () => {
    const { db, pg } = await createTestDb();
    await seedCatalog(pg);
    const svc = await db.query.services.findFirst({ where: eq(services.id, 102) });
    expect(svc?.base_price).toBe('200.00');
    const [c] = await db.insert(customers).values({ email: 'A@x.com' }).returning();
    expect(c.normalized_email).toBe('a@x.com');
    const [b] = await db.insert(bookings).values({
      booking_id: 'ZAY-H1', customer_id: c.id, service_id: 102, booking_date: '2026-11-01', start_time: '10:00', end_time: '11:00',
      duration_minutes: 60, customer_first_name: 'a', customer_last_name: 'b', customer_email: 'a@x.com', customer_phone: '1',
      status: 'confirmed', subtotal: '200.00', tax_amount: '0', total_amount: '200.00',
    }).returning();
    expect(b.booking_date).toBe('2026-11-01');
    expect(b.starts_at?.toISOString()).toBe('2026-11-01T15:00:00.000Z'); // DST ends 2026-11-01 02:00 → EST (UTC-5)
    const r = await db.transaction(async (tx) => tx.query.bookings.findFirst({ where: eq(bookings.id, b.id) }));
    expect(r?.id).toBe(b.id);
    const constraint = await pg.query(`select count(*)::int n from pg_constraint where conname='bookings_no_overlap'`);
    expect((constraint.rows[0] as any).n).toBe(1);
  });
});
