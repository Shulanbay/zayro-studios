import { randomInt } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { bookings, purchaseItems, purchases, refunds } from '@/lib/db/schema';
import type { Purchase, PurchaseItem } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/types';
import { refreshCustomerStats } from './customers';

const ORDER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Order number for a purchase made together with a booking: mirrors the booking id. */
export function orderNumberForBooking(bookingId: string): string {
  return `ZO-${bookingId.replace(/^ZAY-/, '')}`;
}

/** Order number for a purchase without a booking (package, manual sale). */
export function generateOrderNumber(prefix = 'ZP'): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += ORDER_CHARS[randomInt(ORDER_CHARS.length)];
  return `${prefix}-${s}`;
}

export interface NewLineItem {
  itemType: PurchaseItem['item_type'];
  referenceId?: string | number | null;
  description: string;
  quantity?: number;
  unitPriceCents: number;
  metadata?: Record<string, unknown>;
}

export interface NewPurchaseInput {
  orderNumber: string;
  customerId: string | null;
  type: Purchase['type'];
  status: Purchase['status'];
  taxCents: number;
  paymentMethod: Purchase['payment_method'];
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  purchasedAt?: Date | null;
  notes?: string | null;
  createdByAdminId?: string | null;
  items: NewLineItem[];
}

/**
 * Creates a purchase with its immutable line-item snapshot. Subtotal is the
 * sum of the line items; the database refuses later edits to line items.
 */
export async function createPurchase(tx: Executor, input: NewPurchaseInput): Promise<Purchase> {
  if (input.items.length === 0) throw new Error('A purchase needs at least one line item');
  const lines = input.items.map((item) => {
    const quantity = item.quantity ?? 1;
    if (!Number.isInteger(item.unitPriceCents) || !Number.isInteger(quantity) || quantity < 1) {
      throw new Error('Line item amounts must be whole cents and quantity ≥ 1');
    }
    return { ...item, quantity, totalCents: item.unitPriceCents * quantity };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.totalCents, 0);
  if (subtotal < 0 || input.taxCents < 0) throw new Error('Purchase amounts cannot be negative');

  const [purchase] = await tx
    .insert(purchases)
    .values({
      order_number: input.orderNumber,
      customer_id: input.customerId,
      type: input.type,
      status: input.status,
      subtotal_cents: subtotal,
      tax_cents: input.taxCents,
      total_cents: subtotal + input.taxCents,
      payment_method: input.paymentMethod,
      stripe_checkout_session_id: input.stripeCheckoutSessionId ?? null,
      stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
      purchased_at: input.purchasedAt ?? null,
      notes: input.notes ?? null,
      created_by_admin_id: input.createdByAdminId ?? null,
    })
    .returning();

  await tx.insert(purchaseItems).values(
    lines.map((l) => ({
      purchase_id: purchase.id,
      item_type: l.itemType,
      reference_id: l.referenceId === undefined || l.referenceId === null ? null : String(l.referenceId),
      description_snapshot: l.description,
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
      total_cents: l.totalCents,
      metadata: l.metadata ?? {},
    }))
  );

  return purchase;
}

export const COLLECTED_STATUSES = ['paid', 'partially_refunded', 'refunded'] as const;

/**
 * Re-derives refunded_cents and the refund status of a purchase from its
 * succeeded refunds (the single source of truth), and mirrors the result on
 * the linked bookings' payment_status. Idempotent — safe to call from the
 * admin refund flow and from every refund webhook.
 */
export async function recomputeRefundState(tx: Executor, purchaseId: string): Promise<Purchase | null> {
  const current = await tx.query.purchases.findFirst({ where: eq(purchases.id, purchaseId) });
  if (!current) return null;

  const [{ refunded }] = await tx
    .select({ refunded: sql<number>`coalesce(sum(${refunds.amount_cents}), 0)::int` })
    .from(refunds)
    .where(and(eq(refunds.purchase_id, purchaseId), eq(refunds.status, 'succeeded')));
  const refundedCents = Math.min(Number(refunded), current.total_cents);

  let status = current.status;
  if ((COLLECTED_STATUSES as readonly string[]).includes(current.status)) {
    status = refundedCents === 0 ? 'paid' : refundedCents >= current.total_cents ? 'refunded' : 'partially_refunded';
  }

  const [updated] = await tx
    .update(purchases)
    .set({ refunded_cents: refundedCents, status, updated_at: new Date() })
    .where(eq(purchases.id, purchaseId))
    .returning();

  if (refundedCents > 0) {
    await tx
      .update(bookings)
      .set({ payment_status: status === 'refunded' ? 'refunded' : 'partially_refunded', updated_at: new Date() })
      .where(and(eq(bookings.purchase_id, purchaseId), inArray(bookings.payment_status, ['succeeded', 'partially_refunded'])));
  }

  await refreshCustomerStats(tx, updated.customer_id);
  return updated;
}
