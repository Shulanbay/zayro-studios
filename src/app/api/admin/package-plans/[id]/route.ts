import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { packagePlanItems, packagePlans, services } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { CrmError, errorResponse } from '@/lib/crm/errors';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    validity_days: z.number().int().min(1).max(730).optional(),
    active: z.boolean().optional(),
    eligibleServiceIds: z.array(z.number().int().positive()).max(20).optional(),
  })
  .strict();

/**
 * Plan settings. Name, price and number of sessions come from the linked
 * service (edited in Services) so the public pricing page and the CRM can't
 * disagree. Changes never affect packages already assigned — each keeps a
 * snapshot of its plan.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requirePermission(request, 'packages.manage');
  if (!guard.ok) return guard.response;
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isInteger(id)) throw new CrmError('Invalid plan', 400);
    const v = schema.parse(await readJsonObject(request));
    const plan = await db.query.packagePlans.findFirst({ where: eq(packagePlans.id, id) });
    if (!plan) throw new CrmError('Plan not found', 404);
    const beforeItems = await db.query.packagePlanItems.findMany({ where: eq(packagePlanItems.plan_id, id) });

    await db.transaction(async (tx) => {
      if (v.validity_days !== undefined || v.active !== undefined) {
        await tx
          .update(packagePlans)
          .set({ validity_days: v.validity_days ?? plan.validity_days, active: v.active ?? plan.active, updated_at: new Date() })
          .where(eq(packagePlans.id, id));
      }
      if (v.eligibleServiceIds) {
        const found = v.eligibleServiceIds.length
          ? await tx.query.services.findMany({ where: inArray(services.id, v.eligibleServiceIds) })
          : [];
        if (found.length !== v.eligibleServiceIds.length || found.some((s) => s.category === 'package')) {
          throw new CrmError('Eligible services must be existing single-session services');
        }
        const keep = new Set(v.eligibleServiceIds);
        for (const item of beforeItems) {
          if (!keep.has(item.service_id)) await tx.delete(packagePlanItems).where(and(eq(packagePlanItems.plan_id, id), eq(packagePlanItems.service_id, item.service_id)));
        }
        for (const sid of v.eligibleServiceIds) {
          await tx.insert(packagePlanItems).values({ plan_id: id, service_id: sid, credits: plan.total_credits }).onConflictDoNothing();
        }
      }
      await writeAudit(
        {
          actor: actorOf(guard.admin),
          operation: 'package_plan.update',
          entityType: 'package_plan',
          entityId: id,
          before: { validity_days: plan.validity_days, active: plan.active, eligible: beforeItems.map((i) => i.service_id) },
          after: v,
        },
        tx
      );
    });
    return NextResponse.json({ message: 'Plan saved' });
  } catch (error) {
    return errorResponse(error, 'update package plan');
  }
}
