import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { businessSettings } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { CrmError, errorResponse } from '@/lib/crm/errors';
import { BOOKING_RULE_KEYS } from '@/lib/availability';

export const dynamic = 'force-dynamic';

const rulesSchema = z
  .object({
    bufferBefore: z.number().int().min(0).max(240),
    bufferAfter: z.number().int().min(0).max(240),
    increment: z.number().int().min(5).max(240),
    minAdvanceHours: z.number().min(0).max(720),
    horizonDays: z.number().int().min(1).max(730),
  })
  .partial()
  .strict();

const schema = z
  .object({
    bookingRules: rulesSchema.optional(),
    /** Sales tax as a decimal fraction, e.g. 0.08875. Applies to new purchases only. */
    taxRate: z.number().min(0).max(0.25).optional(),
  })
  .strict();

async function upsert(key: string, value: string) {
  await db
    .insert(businessSettings)
    .values({ setting_key: key, setting_value: value })
    .onConflictDoUpdate({ target: businessSettings.setting_key, set: { setting_value: value, updated_at: new Date() } });
}

export async function PATCH(request: NextRequest) {
  const body = await readJsonObject(request);
  const guard = await requirePermission(request, body && 'taxRate' in body ? 'settings.manage' : 'availability.manage');
  if (!guard.ok) return guard.response;
  try {
    const v = schema.parse(body);
    if (v.bookingRules && !guard.admin.can('availability.manage')) throw new CrmError('Your role cannot change booking rules', 403);
    const keys = [...Object.values(BOOKING_RULE_KEYS), 'tax_rate'];
    const before = Object.fromEntries(
      (await db.query.businessSettings.findMany({ where: inArray(businessSettings.setting_key, keys) })).map((r) => [r.setting_key, r.setting_value])
    );
    const after: Record<string, string> = {};
    for (const [k, value] of Object.entries(v.bookingRules ?? {})) {
      const key = BOOKING_RULE_KEYS[k as keyof typeof BOOKING_RULE_KEYS];
      after[key] = String(value);
      await upsert(key, String(value));
    }
    if (v.taxRate !== undefined) {
      after.tax_rate = String(v.taxRate);
      await upsert('tax_rate', String(v.taxRate));
    }
    await writeAudit({
      actor: actorOf(guard.admin),
      operation: v.taxRate !== undefined ? 'settings.update' : 'availability.update_rules',
      entityType: 'business_settings',
      before: Object.fromEntries(Object.keys(after).map((k) => [k, before[k] ?? null])),
      after,
    });
    return NextResponse.json({ message: 'Settings saved' });
  } catch (error) {
    return errorResponse(error, 'update settings');
  }
}
