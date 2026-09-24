import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { customerPackages, customers, packageCreditTransactions, packagePlanItems, packagePlans, services } from '@/lib/db/schema';
import type { CustomerPackage, PackagePlan } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/types';
import { pgErrorCode } from '@/lib/db/types';
import { writeAudit, type AuditActor } from './audit';
import { CrmError, conflict, notFound } from './errors';
import { createPurchase, generateOrderNumber } from './purchases';
import { refreshCustomerStats } from './customers';
import { taxCents } from './money';
import { getTaxRate } from '@/lib/pricing';

/**
 * Prepaid package credits. The ledger (package_credit_transactions) is
 * append-only; customer_packages.remaining_credits is the running balance,
 * changed only together with a ledger row, under a row lock. The database
 * enforces: balance ≥ 0, one redeem and one restore per booking.
 */

export interface PlanSnapshot {
  name: string;
  priceCents: number;
  totalCredits: number;
  validityDays: number;
  eligibleServiceIds: number[];
  eligible: string;
}

export async function planSnapshot(exec: Executor, plan: PackagePlan): Promise<PlanSnapshot> {
  const items = await exec
    .select({ serviceId: packagePlanItems.service_id, name: services.name })
    .from(packagePlanItems)
    .innerJoin(services, eq(services.id, packagePlanItems.service_id))
    .where(eq(packagePlanItems.plan_id, plan.id));
  return {
    name: plan.name,
    priceCents: plan.price_cents,
    totalCredits: plan.total_credits,
    validityDays: plan.validity_days,
    eligibleServiceIds: items.map((i) => i.serviceId),
    eligible: items.map((i) => i.name).join(', ') || 'Any studio session',
  };
}

async function ledger(
  tx: Executor,
  pkg: Pick<CustomerPackage, 'id'>,
  entry: { type: 'grant' | 'redeem' | 'restore' | 'expire' | 'adjustment'; credits: number; balanceAfter: number; bookingId?: string | null; actor: AuditActor | null; reason?: string | null }
) {
  await tx.insert(packageCreditTransactions).values({
    customer_package_id: pkg.id,
    booking_id: entry.bookingId ?? null,
    type: entry.type,
    credits: entry.credits,
    balance_after: entry.balanceAfter,
    actor_id: entry.actor?.id ?? null,
    actor_email: entry.actor?.email ?? null,
    reason: entry.reason ?? null,
  });
}

async function lockPackage(tx: Executor, id: string): Promise<CustomerPackage> {
  await tx.execute(sql`SELECT id FROM customer_packages WHERE id = ${id} FOR UPDATE`);
  const pkg = await tx.query.customerPackages.findFirst({ where: eq(customerPackages.id, id) });
  if (!pkg) throw notFound('Package');
  return pkg;
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export interface AssignPackageInput {
  customerId: string;
  planId: number;
  startsAt?: Date;
  payment: { mode: 'comp' | 'offline_paid' | 'unpaid'; method?: 'cash' | 'card_terminal' | 'bank_transfer' | 'other' };
  notes?: string | null;
}

/**
 * Staff assigns a package to a customer: a purchase (type package, with
 * the plan price as an immutable snapshot), the customer package and the
 * opening "grant" ledger entry — all in one transaction.
 */
export async function assignPackage(input: AssignPackageInput, actor: AuditActor): Promise<CustomerPackage> {
  return db.transaction(async (tx) => {
    const [customer, plan] = await Promise.all([
      tx.query.customers.findFirst({ where: eq(customers.id, input.customerId) }),
      tx.query.packagePlans.findFirst({ where: eq(packagePlans.id, input.planId) }),
    ]);
    if (!customer || customer.status === 'merged') throw notFound('Customer');
    if (!plan) throw notFound('Package plan');
    if (!plan.active) throw new CrmError('This package plan is inactive');

    const snapshot = await planSnapshot(tx, plan);
    const startsAt = input.startsAt ?? new Date();
    const expiresAt = new Date(startsAt.getTime() + plan.validity_days * 86400000);

    const comp = input.payment.mode === 'comp';
    const unitPrice = comp ? 0 : plan.price_cents;
    const tax = comp ? 0 : taxCents(unitPrice, await getTaxRate(tx));
    const purchase = await createPurchase(tx, {
      orderNumber: generateOrderNumber('ZP'),
      customerId: customer.id,
      type: 'package',
      status: comp ? 'approved' : input.payment.mode === 'offline_paid' ? 'paid' : 'pending',
      taxCents: tax,
      paymentMethod: comp ? 'comp' : input.payment.method ?? 'other',
      purchasedAt: input.payment.mode === 'unpaid' ? null : new Date(),
      notes: input.notes ?? null,
      createdByAdminId: actor.id ?? null,
      items: [
        {
          itemType: 'package',
          referenceId: plan.id,
          description: `${plan.name} — ${plan.total_credits} sessions, valid ${plan.validity_days} days`,
          unitPriceCents: unitPrice,
          metadata: { listPriceCents: plan.price_cents, credits: plan.total_credits, eligibleServiceIds: snapshot.eligibleServiceIds },
        },
      ],
    });

    const [pkg] = await tx
      .insert(customerPackages)
      .values({
        customer_id: customer.id,
        package_plan_id: plan.id,
        purchase_id: purchase.id,
        total_credits: plan.total_credits,
        remaining_credits: plan.total_credits,
        starts_at: startsAt,
        expires_at: expiresAt,
        status: 'active',
        plan_snapshot: snapshot as unknown as Record<string, unknown>,
        notes: input.notes ?? null,
        assigned_by_admin_id: actor.id ?? null,
      })
      .returning();

    await ledger(tx, pkg, { type: 'grant', credits: plan.total_credits, balanceAfter: plan.total_credits, actor, reason: 'Package assigned' });
    await refreshCustomerStats(tx, customer.id);
    await writeAudit(
      {
        actor,
        operation: 'package.assign',
        entityType: 'customer_package',
        entityId: pkg.id,
        after: { customerId: customer.id, plan: plan.name, credits: plan.total_credits, expiresAt, purchase: purchase.order_number, payment: input.payment },
      },
      tx
    );
    return pkg;
  });
}

// ---------------------------------------------------------------------------
// Redeem / restore
// ---------------------------------------------------------------------------

/**
 * Uses one credit for a booking, inside the booking's transaction. Throws
 * CrmError when the package can't pay for this service. A second redeem for
 * the same booking is rejected by the database (unique index).
 */
export async function redeemCredit(
  tx: Executor,
  args: { customerPackageId: string; customerId: string; bookingId: string; serviceId: number; sessionStart: Date; actor: AuditActor | null }
): Promise<CustomerPackage> {
  const pkg = await lockPackage(tx, args.customerPackageId);
  if (pkg.customer_id !== args.customerId) throw new CrmError('This package belongs to a different customer');
  if (pkg.status !== 'active') throw new CrmError(`This package is ${pkg.status}`);
  if (pkg.expires_at <= new Date()) throw new CrmError('This package has expired');
  if (args.sessionStart > pkg.expires_at) throw new CrmError('The session is after the package expiry date');
  const eligible = ((pkg.plan_snapshot as Partial<PlanSnapshot>).eligibleServiceIds ?? []) as number[];
  if (eligible.length > 0 && !eligible.includes(args.serviceId)) {
    throw new CrmError('This package does not cover the selected service');
  }
  if (pkg.remaining_credits < 1) throw new CrmError('No credits left on this package');

  const remaining = pkg.remaining_credits - 1;
  const [updated] = await tx
    .update(customerPackages)
    .set({ remaining_credits: remaining, status: remaining === 0 ? 'exhausted' : 'active', updated_at: new Date() })
    .where(and(eq(customerPackages.id, pkg.id), gt(customerPackages.remaining_credits, 0)))
    .returning();
  if (!updated) throw conflict('No credits left on this package');

  try {
    await ledger(tx, pkg, { type: 'redeem', credits: -1, balanceAfter: remaining, bookingId: args.bookingId, actor: args.actor, reason: 'Session booked' });
  } catch (error) {
    if (pgErrorCode(error) === '23505') throw conflict('A credit was already used for this booking');
    throw error;
  }
  return updated;
}

/**
 * Gives a booking's credit back (cancellation). No-op when the booking never
 * used a credit or already got it back; not restored onto an expired or
 * cancelled package.
 */
export async function restoreCredit(
  tx: Executor,
  args: { bookingId: string; actor: AuditActor | null; reason: string }
): Promise<{ restored: boolean; message: string }> {
  const redeem = await tx.query.packageCreditTransactions.findFirst({
    where: and(eq(packageCreditTransactions.booking_id, args.bookingId), eq(packageCreditTransactions.type, 'redeem')),
  });
  if (!redeem) return { restored: false, message: 'Booking did not use a package credit' };

  // Check for an earlier restore only once the package row is locked, so two
  // concurrent cancellations can't both pass the check.
  const pkg = await lockPackage(tx, redeem.customer_package_id);
  const already = await tx.query.packageCreditTransactions.findFirst({
    where: and(eq(packageCreditTransactions.booking_id, args.bookingId), eq(packageCreditTransactions.type, 'restore')),
  });
  if (already) return { restored: false, message: 'Credit was already restored' };
  if (pkg.status === 'cancelled' || pkg.status === 'expired' || pkg.expires_at <= new Date()) {
    return { restored: false, message: `Package is ${pkg.status === 'active' || pkg.status === 'exhausted' ? 'expired' : pkg.status}; credit not restored` };
  }
  const remaining = pkg.remaining_credits + 1;
  await tx
    .update(customerPackages)
    .set({ remaining_credits: remaining, status: 'active', updated_at: new Date() })
    .where(eq(customerPackages.id, pkg.id));
  await ledger(tx, pkg, { type: 'restore', credits: 1, balanceAfter: remaining, bookingId: args.bookingId, actor: args.actor, reason: args.reason });
  return { restored: true, message: 'Package credit restored' };
}

// ---------------------------------------------------------------------------
// Manual adjustment, expiry, cancellation
// ---------------------------------------------------------------------------

export async function adjustCredits(customerPackageId: string, delta: number, reason: string, actor: AuditActor) {
  if (!Number.isInteger(delta) || delta === 0) throw new CrmError('Adjustment must be a non-zero whole number');
  if (!reason.trim()) throw new CrmError('A reason is required');
  return db.transaction(async (tx) => {
    const pkg = await lockPackage(tx, customerPackageId);
    if (pkg.status === 'cancelled') throw new CrmError('This package is cancelled');
    const remaining = pkg.remaining_credits + delta;
    if (remaining < 0) throw new CrmError(`Only ${pkg.remaining_credits} credits left; can't remove ${-delta}`);
    const expired = pkg.expires_at <= new Date();
    const [updated] = await tx
      .update(customerPackages)
      .set({
        remaining_credits: remaining,
        total_credits: delta > 0 ? pkg.total_credits + delta : pkg.total_credits,
        status: expired ? 'expired' : remaining === 0 ? 'exhausted' : 'active',
        updated_at: new Date(),
      })
      .where(eq(customerPackages.id, pkg.id))
      .returning();
    await ledger(tx, pkg, { type: 'adjustment', credits: delta, balanceAfter: remaining, actor, reason: reason.trim() });
    await writeAudit(
      { actor, operation: 'package.adjust', entityType: 'customer_package', entityId: pkg.id, before: { remaining: pkg.remaining_credits }, after: { remaining }, metadata: { delta, reason } },
      tx
    );
    return updated;
  });
}

/** Expires every active package past its date (lazily, on read and before redeeming). */
export async function expireDuePackages(now = new Date()): Promise<number> {
  const due = await db.query.customerPackages.findMany({
    where: and(inArray(customerPackages.status, ['active', 'exhausted']), lte(customerPackages.expires_at, now)),
    orderBy: [asc(customerPackages.expires_at)],
    limit: 200,
  });
  let expired = 0;
  for (const candidate of due) {
    await db.transaction(async (tx) => {
      const pkg = await lockPackage(tx, candidate.id);
      if (!['active', 'exhausted'].includes(pkg.status) || pkg.expires_at > now) return;
      await tx
        .update(customerPackages)
        .set({ remaining_credits: 0, status: 'expired', updated_at: new Date() })
        .where(eq(customerPackages.id, pkg.id));
      if (pkg.remaining_credits > 0) {
        await ledger(tx, pkg, { type: 'expire', credits: -pkg.remaining_credits, balanceAfter: 0, actor: null, reason: 'Package expired' });
      }
      expired++;
    });
  }
  return expired;
}

export async function cancelCustomerPackage(customerPackageId: string, reason: string, actor: AuditActor) {
  if (!reason.trim()) throw new CrmError('A reason is required');
  return db.transaction(async (tx) => {
    const pkg = await lockPackage(tx, customerPackageId);
    if (pkg.status === 'cancelled') throw new CrmError('Package is already cancelled');
    await tx
      .update(customerPackages)
      .set({ status: 'cancelled', remaining_credits: 0, updated_at: new Date() })
      .where(eq(customerPackages.id, pkg.id));
    if (pkg.remaining_credits > 0) {
      await ledger(tx, pkg, { type: 'adjustment', credits: -pkg.remaining_credits, balanceAfter: 0, actor, reason: `Package cancelled: ${reason.trim()}` });
    }
    await writeAudit(
      { actor, operation: 'package.cancel', entityType: 'customer_package', entityId: pkg.id, before: { status: pkg.status, remaining: pkg.remaining_credits }, after: { status: 'cancelled', remaining: 0 }, metadata: { reason } },
      tx
    );
  });
}

/** Active packages of a customer that can pay for `serviceId` (for the manual booking form). */
export async function usablePackages(customerId: string, serviceId?: number) {
  await expireDuePackages();
  const rows = await db.query.customerPackages.findMany({
    where: and(eq(customerPackages.customer_id, customerId), eq(customerPackages.status, 'active'), gt(customerPackages.remaining_credits, 0)),
    orderBy: [asc(customerPackages.expires_at)],
  });
  return rows.filter((p) => {
    const eligible = ((p.plan_snapshot as Partial<PlanSnapshot>).eligibleServiceIds ?? []) as number[];
    return serviceId === undefined || eligible.length === 0 || eligible.includes(serviceId);
  });
}
