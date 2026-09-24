import { db } from '@/lib/db';
import { decimalToCents } from './money';

/** Bookable single-session services for staff forms (active, not packages, not archived). */
export async function bookableServiceOptions() {
  const rows = await db.query.services.findMany({ orderBy: (s, { asc }) => [asc(s.category), asc(s.display_order), asc(s.id)] });
  return rows
    .filter((s) => s.is_active && s.category !== 'package' && !s.archived_at)
    .map((s) => ({ id: s.id, name: s.name, category: s.category, duration: s.duration_minutes, priceCents: decimalToCents(s.base_price) }));
}
