import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rowsOf } from '@/lib/db/types';
import { RETENTION } from './config';

/**
 * Analytics retention (docs/analytics.md → Retention). Idempotent, batched
 * (small deletes, no long locks) and analytics-only: it never touches
 * bookings, purchases, refunds, customers or any other business table.
 *
 *  - raw browser events: 13 months (ANALYTICS_RETENTION_EVENTS_MONTHS);
 *  - server conversion events with a booking/purchase and every attribution
 *    snapshot: kept with the financial record (not deleted here);
 *  - failed / dead / skipped deliveries: 90 days;
 *  - sessions and visitors not referenced by an attribution: 25 months;
 *  - consent records: 25 months.
 *
 * Logs and returns counts only.
 */
const BATCH = 2000;
const MAX_BATCHES = 50;

async function deleteInBatches(statement: () => ReturnType<typeof sql>): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const rows = rowsOf<{ id: string }>(await db.execute(statement()));
    total += rows.length;
    if (rows.length < BATCH) break;
  }
  return total;
}

export async function cleanupAnalytics(now = new Date()) {
  const eventsBefore = new Date(now);
  eventsBefore.setUTCMonth(eventsBefore.getUTCMonth() - RETENTION.rawEventsMonths());
  const sessionsBefore = new Date(now);
  sessionsBefore.setUTCMonth(sessionsBefore.getUTCMonth() - RETENTION.sessionsMonths());
  const consentBefore = new Date(now);
  consentBefore.setUTCMonth(consentBefore.getUTCMonth() - RETENTION.consentRecordsMonths());
  const deliveriesBefore = new Date(now.getTime() - RETENTION.failedDeliveriesDays() * 86_400_000);

  const deliveries = await deleteInBatches(
    () => sql`DELETE FROM analytics_deliveries WHERE id IN (
                SELECT id FROM analytics_deliveries WHERE status IN ('failed', 'dead', 'skipped') AND updated_at < ${deliveriesBefore} LIMIT ${BATCH}) RETURNING id`
  );
  const events = await deleteInBatches(
    () => sql`DELETE FROM analytics_events WHERE id IN (
                SELECT id FROM analytics_events WHERE occurred_at < ${eventsBefore} AND booking_id IS NULL AND purchase_id IS NULL LIMIT ${BATCH}) RETURNING id`
  );
  const sessions = await deleteInBatches(
    () => sql`DELETE FROM analytics_sessions WHERE id IN (
                SELECT s.id FROM analytics_sessions s
                 WHERE s.last_seen_at < ${sessionsBefore}
                   AND NOT EXISTS (SELECT 1 FROM analytics_attributions a WHERE a.session_id = s.id)
                 LIMIT ${BATCH}) RETURNING id`
  );
  const visitors = await deleteInBatches(
    () => sql`DELETE FROM analytics_visitors WHERE id IN (
                SELECT v.id FROM analytics_visitors v
                 WHERE v.last_seen_at < ${sessionsBefore}
                   AND NOT EXISTS (SELECT 1 FROM analytics_sessions s WHERE s.visitor_id = v.id)
                   AND NOT EXISTS (SELECT 1 FROM analytics_attributions a WHERE a.visitor_id = v.id)
                 LIMIT ${BATCH}) RETURNING id`
  );
  const consents = await deleteInBatches(
    () => sql`DELETE FROM analytics_consents WHERE id IN (SELECT id FROM analytics_consents WHERE created_at < ${consentBefore} LIMIT ${BATCH}) RETURNING id`
  );
  const result = { deliveries, events, sessions, visitors, consents };
  console.log(`[analytics] retention cleanup: ${JSON.stringify(result)}`);
  return result;
}
