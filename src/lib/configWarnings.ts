import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { integrationLogs } from './db/schema';

/**
 * A catalog/configuration problem staff must fix (e.g. a package without a
 * valid camera count). Written to integration_logs (type 'admin', no
 * booking, no personal data) and shown in Admin → Integrations. The same
 * message is written at most once an hour so a busy page can't flood the log.
 * Never throws.
 */
export async function logConfigWarning(message: string): Promise<void> {
  try {
    const text = `Configuration: ${message}`.slice(0, 500);
    const recent = await db.query.integrationLogs.findFirst({
      where: and(
        eq(integrationLogs.integration_type, 'admin'),
        isNull(integrationLogs.booking_id),
        eq(integrationLogs.error_message, text),
        gte(integrationLogs.created_at, sql`now() - interval '1 hour'`)
      ),
    });
    if (recent) return;
    await db.insert(integrationLogs).values({
      integration_type: 'admin',
      booking_id: null,
      status: 'failed',
      error_message: text,
      response_data: { kind: 'configuration', message: text, timestamp: new Date().toISOString() },
    });
  } catch (error) {
    console.error('[config] could not record a configuration warning:', (error as Error)?.message || error);
  }
}

export function cameraConfigMessage(service: { id: number; name: string }, reason: string): string {
  return `service #${service.id} "${service.name}": ${reason} (services.metadata.includedCameras must be an integer from 1 to 3). Additional Camera is switched off for it until fixed.`;
}
