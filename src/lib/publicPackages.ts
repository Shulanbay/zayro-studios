import type Stripe from 'stripe';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookings, customerPackages, customers, packageCreditTransactions, packagePlans, purchaseItems, purchases, services, temporaryHolds } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/types';
import { CrmError } from '@/lib/crm/errors';
import { createPurchase } from '@/lib/crm/purchases';
import { upsertCustomer, refreshCustomerStats } from '@/lib/crm/customers';
import { decimalToCents, taxCents } from '@/lib/crm/money';
import { getTaxRate } from '@/lib/pricing';
import { getStripe } from '@/lib/crm/refunds';
import { packageAccessToken } from '@/lib/packageAccess';
import { sendLoggedEmail } from '@/lib/crm/emailLog';
import { SITE_URL } from '@/lib/seo';
import { checkBookable } from '@/lib/catalogData';
import { isSlotActuallyAvailable, lockStudioDates } from '@/lib/availability';
import { holdIsUsable, lockHold } from '@/lib/holds';
import { redeemCredit } from '@/lib/crm/packages';
import { parseIntake } from '@/lib/bookingOptions';
import { resolveSetup, setupForHold } from '@/lib/bookingQuote';
import { generateBookingId, toDateOnly } from '@/lib/utils';
import { wallTimeToUtc, utcToWall } from '@/lib/crm/time';
import { runPostConfirmationSideEffects } from '@/lib/postConfirmation';
import { writeAudit } from '@/lib/crm/audit';

export interface OnlinePackageSnapshot {
  onlinePackage: true;
  name: string;
  priceCents: number;
  totalCredits: number;
  validityDays: number;
  eligibleServiceIds: number[];
  eligible: string;
  durationMinutes: number;
  planId: number;
}

async function snapshotForPurchase(exec: Executor, purchaseId: string): Promise<OnlinePackageSnapshot> {
  const line = await exec.query.purchaseItems.findFirst({ where: and(eq(purchaseItems.purchase_id, purchaseId), eq(purchaseItems.item_type, 'package')) });
  const snapshot = line?.metadata as unknown as OnlinePackageSnapshot | undefined;
  if (!snapshot?.onlinePackage) throw new CrmError('Online package order not found', 404);
  return snapshot;
}

export async function onlinePackageOffer(serviceId: number, exec: Executor = db) {
  const pkg = await exec.query.services.findFirst({ where: eq(services.id, serviceId) });
  if (!pkg || pkg.category !== 'package' || !pkg.is_active || pkg.archived_at || pkg.quote_only) throw new CrmError('This package is not available online', 404);
  const base = pkg.package_base_service_id ? await exec.query.services.findFirst({ where: eq(services.id, pkg.package_base_service_id) }) : null;
  const plan = await exec.query.packagePlans.findFirst({ where: eq(packagePlans.service_id, pkg.id) });
  if (!base || !checkBookable(base).ok || !plan?.active || !pkg.session_count || !pkg.validity_days) throw new CrmError('This package is temporarily unavailable. Please contact the studio.', 409);
  const price = decimalToCents(pkg.base_price);
  if (price <= 0 || pkg.session_count < 1 || pkg.validity_days < 1) throw new CrmError('This package is temporarily unavailable', 409);
  const tax = taxCents(price, await getTaxRate(exec));
  const snapshot: OnlinePackageSnapshot = {
    onlinePackage: true, name: pkg.name, priceCents: price, totalCredits: pkg.session_count,
    validityDays: pkg.validity_days, eligibleServiceIds: [base.id], eligible: base.name,
    durationMinutes: base.duration_minutes, planId: plan.id,
  };
  return { snapshot, subtotal: price, tax, total: price + tax };
}

export interface PackageBuyer {
  requestId: string; serviceId: number; firstName: string; lastName: string;
  email: string; phone: string; company?: string;
}

/** Snapshot the catalog price; serialize retries and use Stripe's idempotency key. */
export async function startPackageCheckout(input: PackageBuyer, baseUrl: string) {
  const stripe = getStripe();
  if (!stripe) throw new CrmError('Online payment is temporarily unavailable', 503);
  // Verify signing is available before accepting any money.
  packageAccessToken('00000000-0000-0000-0000-000000000000');
  const orderNumber = `ZP-${input.requestId.replace(/-/g, '')}`;
  let createdSession: string | null = null;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`package-checkout:${orderNumber}`}))`);
      const existing = await tx.query.purchases.findFirst({ where: eq(purchases.order_number, orderNumber) });
      if (existing) {
        const owner = existing.customer_id ? await tx.query.customers.findFirst({ where: eq(customers.id, existing.customer_id) }) : null;
        const line = await tx.query.purchaseItems.findFirst({ where: eq(purchaseItems.purchase_id, existing.id) });
        if (owner?.email.toLowerCase() !== input.email.toLowerCase() || line?.metadata.serviceId !== input.serviceId) throw new CrmError('Please restart your package purchase', 409);
        if (!existing.stripe_checkout_session_id) throw new CrmError('Please restart your package purchase', 409);
        const session = await stripe.checkout.sessions.retrieve(existing.stripe_checkout_session_id);
        if (session.status === 'complete') return { sessionId: session.id, alreadyPaid: true };
        if (session.status !== 'open' || !session.url) throw new CrmError('This checkout expired. Please start a new purchase.', 410);
        return { checkoutUrl: session.url, sessionId: session.id };
      }
      const offer = await onlinePackageOffer(input.serviceId, tx);
      const customer = await upsertCustomer(tx, input, { updateContact: true });
      const purchase = await createPurchase(tx, {
        orderNumber, customerId: customer.id, type: 'package', status: 'pending', paymentMethod: 'stripe', taxCents: offer.tax,
        items: [{ itemType: 'package', referenceId: offer.snapshot.planId,
          description: `${offer.snapshot.name} — ${offer.snapshot.totalCredits} sessions, valid ${offer.snapshot.validityDays} days from purchase`,
          unitPriceCents: offer.subtotal, metadata: { ...offer.snapshot, serviceId: input.serviceId } }],
      });
      const session = await stripe.checkout.sessions.create({
        mode: 'payment', payment_method_types: ['card'], customer_email: customer.email,
        billing_address_collection: 'required',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: offer.total,
          product_data: { name: offer.snapshot.name, description: `${offer.snapshot.totalCredits} ${offer.snapshot.eligible} sessions. Valid ${offer.snapshot.validityDays} days from payment. Choose dates after purchase. One-time payment.` } } }],
        success_url: `${baseUrl}/packages/manage?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/packages/buy?package=${input.serviceId}&cancelled=1`,
        metadata: { kind: 'monthly_package', packagePurchaseId: purchase.id },
        payment_intent_data: { metadata: { packagePurchaseId: purchase.id } },
      }, { idempotencyKey: `monthly-package:${orderNumber}` });
      createdSession = session.id;
      if (!session.url) throw new Error('Stripe did not return a checkout URL');
      await tx.update(purchases).set({ stripe_checkout_session_id: session.id }).where(eq(purchases.id, purchase.id));
      return { checkoutUrl: session.url, sessionId: session.id };
    });
  } catch (error) {
    if (createdSession) await stripe.checkout.sessions.expire(createdSession).catch(() => undefined);
    throw error;
  }
}

/** Shared by signed webhook delivery and the return page's server-side Stripe check. */
export async function fulfillPackageSession(session: Stripe.Checkout.Session) {
  if (session.metadata?.kind !== 'monthly_package') throw new CrmError('Package payment not found', 404);
  if (session.payment_status !== 'paid' || session.status !== 'complete') throw new CrmError('Your payment is still processing. Please try again shortly.', 409);
  const result = await db.transaction(async (tx) => {
    const purchase = await tx.query.purchases.findFirst({ where: eq(purchases.stripe_checkout_session_id, session.id) });
    if (!purchase || purchase.id !== session.metadata?.packagePurchaseId || purchase.type !== 'package' || !purchase.customer_id) throw new Error('Package payment has no matching purchase');
    await tx.execute(sql`SELECT id FROM purchases WHERE id = ${purchase.id} FOR UPDATE`);
    const fresh = (await tx.query.purchases.findFirst({ where: eq(purchases.id, purchase.id) }))!;
    if (session.amount_total !== fresh.total_cents || session.currency !== 'usd') {
      await tx.update(purchases).set({ needs_refund_review: true, review_reason: 'Package payment amount or currency mismatch', updated_at: new Date() }).where(eq(purchases.id, fresh.id));
      return { mismatch: true as const, purchaseId: fresh.id };
    }
    if (fresh.refunded_cents > 0 || ['refunded', 'partially_refunded'].includes(fresh.status) || fresh.needs_refund_review) throw new CrmError('This payment needs studio review. Please contact us.', 409);
    const existing = await tx.query.customerPackages.findFirst({ where: eq(customerPackages.purchase_id, fresh.id) });
    if (existing) return { mismatch: false as const, purchaseId: fresh.id, packageId: existing.id };
    const snapshot = await snapshotForPurchase(tx, fresh.id);
    const paidAt = new Date(session.created * 1000);
    // Use the payment's actual creation time when available; the webhook's retry time never extends validity.
    const stripe = getStripe();
    const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    let startsAt = paidAt;
    if (stripe && intentId) {
      const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ['latest_charge'] });
      const charge = intent.latest_charge;
      startsAt = new Date((charge && typeof charge !== 'string' ? charge.created : intent.created) * 1000);
    }
    const expiresAt = new Date(startsAt.getTime() + snapshot.validityDays * 86400000);
    const [pkg] = await tx.insert(customerPackages).values({
      customer_id: fresh.customer_id!, package_plan_id: snapshot.planId, purchase_id: fresh.id,
      total_credits: snapshot.totalCredits, remaining_credits: snapshot.totalCredits,
      starts_at: startsAt, expires_at: expiresAt, status: 'active', plan_snapshot: { ...snapshot },
    }).returning();
    await tx.insert(packageCreditTransactions).values({ customer_package_id: pkg.id, type: 'grant', credits: snapshot.totalCredits, balance_after: snapshot.totalCredits, actor_email: 'stripe-webhook', reason: 'Monthly package paid online' });
    await tx.update(purchases).set({ status: 'paid', stripe_payment_intent_id: intentId ?? null, purchased_at: startsAt, updated_at: new Date() }).where(eq(purchases.id, fresh.id));
    await refreshCustomerStats(tx, fresh.customer_id);
    await writeAudit({ actor: { email: 'stripe-webhook' }, operation: 'package.purchase_online', entityType: 'customer_package', entityId: pkg.id, after: { purchaseId: fresh.id, credits: snapshot.totalCredits } }, tx);
    return { mismatch: false as const, purchaseId: fresh.id, packageId: pkg.id };
  });
  if (result.mismatch) throw new CrmError('Your payment needs studio review. Please contact us.', 409);
  await sendPackagePurchaseEmail(result.purchaseId);
  return result;
}

export async function expirePackageCheckout(session: Stripe.Checkout.Session, status: 'failed' | 'cancelled') {
  await db.update(purchases).set({ status, updated_at: new Date() })
    .where(and(eq(purchases.stripe_checkout_session_id, session.id), eq(purchases.status, 'pending')));
  return { status: 'package_checkout_released' };
}

export async function sendPackagePurchaseEmail(purchaseId: string) {
  const purchase = await db.query.purchases.findFirst({ where: eq(purchases.id, purchaseId) });
  const pkg = await db.query.customerPackages.findFirst({ where: eq(customerPackages.purchase_id, purchaseId) });
  if (!purchase?.customer_id || !pkg) throw new Error('Paid package not found');
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, purchase.customer_id) });
  const snapshot = await snapshotForPurchase(db, purchaseId);
  const url = `${SITE_URL}/packages/manage#access=${packageAccessToken(purchaseId)}`;
  const text = `Your ${snapshot.name} package is ready.\n${pkg.total_credits} sessions, valid until ${utcToWall(pkg.expires_at).date} (New York time).\nChoose your dates and view remaining sessions: ${url}\nKeep this private link for future bookings. Each session is subject to availability.\nOrder: ${purchase.order_number}`;
  const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  return sendLoggedEmail({ template: 'package_purchase', recipientType: 'customer', to: customer?.email,
    dedupeKey: `package_purchase:${purchaseId}`, refs: { purchaseId, customerPackageId: pkg.id },
    render: () => ({ subject: 'Your ZAYRO monthly package — choose your dates', text,
      html: `<h1>Your monthly package is ready</h1><p>${escape(snapshot.name)} · ${pkg.total_credits} sessions</p><p>Valid until ${utcToWall(pkg.expires_at).date} (New York time).</p><p><a href="${escape(url)}">Choose dates and manage your package</a></p><p>Keep this private link for future bookings. Each session is subject to availability.</p><p>Order: ${escape(purchase.order_number)}</p>` }),
  });
}

export async function packageForAccess(purchaseId: string, exec: Executor = db) {
  const purchase = await exec.query.purchases.findFirst({ where: eq(purchases.id, purchaseId) });
  if (!purchase || purchase.type !== 'package' || purchase.status !== 'paid' || purchase.refunded_cents > 0 || purchase.needs_refund_review) throw new CrmError('This package is not available. Please contact the studio.', 403);
  const pkg = await exec.query.customerPackages.findFirst({ where: eq(customerPackages.purchase_id, purchaseId) });
  if (!pkg) throw new CrmError('Your package is still being activated. Please try again shortly.', 409);
  const snapshot = await snapshotForPurchase(exec, purchaseId);
  const customer = await exec.query.customers.findFirst({ where: eq(customers.id, pkg.customer_id) });
  if (!customer) throw new CrmError('Package customer not found', 404);
  return { purchase, pkg, snapshot, customer };
}

export async function packageDashboard(purchaseId: string) {
  const { purchase, pkg, snapshot, customer } = await packageForAccess(purchaseId);
  const sessions = await db.query.bookings.findMany({ where: eq(bookings.customer_package_id, pkg.id), orderBy: [asc(bookings.booking_date), asc(bookings.start_time)] });
  const canBook = pkg.status === 'active' && pkg.remaining_credits > 0 && pkg.expires_at > new Date();
  return { id: pkg.id, name: snapshot.name, serviceId: snapshot.eligibleServiceIds[0], durationMinutes: snapshot.durationMinutes,
    remaining: pkg.remaining_credits, total: pkg.total_credits, expiresAt: pkg.expires_at.toISOString(), expiresOn: utcToWall(pkg.expires_at).date, canBook,
    orderNumber: purchase.order_number, privateLink: `/packages/manage#access=${packageAccessToken(purchaseId)}`,
    customer: { firstName: customer.first_name ?? '', lastName: customer.last_name ?? '', email: customer.email, phone: customer.phone ?? '', company: customer.company ?? '', notes: '' },
    sessions: sessions.map((b) => ({ bookingId: b.booking_id, date: toDateOnly(b.booking_date), start: b.start_time, end: b.end_time, status: b.status })),
  };
}

/** Consume one credit and convert one held slot in a single, locked transaction. */
export async function bookPackageSession(purchaseId: string, body: { packageId?: string; holdId: string; intake?: unknown; notes?: string }) {
  const outcome = await db.transaction(async (tx) => {
    await lockHold(tx, body.holdId);
    const hold = await tx.query.temporaryHolds.findFirst({ where: eq(temporaryHolds.id, body.holdId) });
    if (!hold) throw new CrmError('Your reserved time was not found. Choose a time again.', 404);
    const date = toDateOnly(hold.booking_date);
    await lockStudioDates(tx, [date]);
    await tx.execute(sql`SELECT id FROM purchases WHERE id = ${purchaseId} FOR UPDATE`);
    const { pkg, snapshot, customer } = await packageForAccess(purchaseId, tx);
    if (body.packageId && body.packageId !== pkg.id) throw new CrmError('Another package was opened in this browser. Return to your package and reload.', 409);
    if (hold.customer_email.trim().toLowerCase() !== customer.email.toLowerCase()) throw new CrmError('This reservation belongs to a different customer', 403);
    const existing = await tx.query.bookings.findFirst({ where: and(eq(bookings.customer_package_id, pkg.id), sql`${bookings.intake}->>'packageHoldId' = ${hold.id}`) });
    if (existing) {
      if (existing.status !== 'confirmed') throw new CrmError('This session is no longer confirmed. Choose another date.', 409);
      return { booking: existing, service: null };
    }
    if (!holdIsUsable(hold)) throw new CrmError('Your reserved time expired. Choose a time again.', 410);
    if (!snapshot.eligibleServiceIds.includes(hold.service_id) || hold.duration_minutes !== snapshot.durationMinutes) throw new CrmError('This package covers one standard session per credit', 400);
    const selection = hold.selection as { addons?: unknown[]; units?: number; setupId?: number };
    if (selection?.addons?.length || (selection?.units ?? 1) !== 1) throw new CrmError('Package sessions do not include extra hours or add-ons', 400);
    const service = await tx.query.services.findFirst({ where: eq(services.id, hold.service_id) });
    if (!service || !checkBookable(service).ok || service.duration_minutes !== snapshot.durationMinutes) throw new CrmError('This session is temporarily unavailable. Please contact the studio.', 409);
    const setupValid = await resolveSetup(service.category, selection?.setupId, tx);
    if (!setupValid.ok) throw new CrmError(setupValid.error);
    const sessionStart = wallTimeToUtc(date, hold.start_time);
    if (sessionStart < pkg.starts_at || wallTimeToUtc(date, hold.end_time) > pkg.expires_at) throw new CrmError('Choose a session within your package validity period');
    const answers = parseIntake(body.intake, service.category, customer.email);
    if (!answers.ok) throw new CrmError(answers.error);
    const available = await isSlotActuallyAvailable(date, hold.start_time, hold.end_time, hold.duration_minutes, tx, { excludeHoldId: hold.id });
    if (!available) throw new CrmError('That time was just taken. Please choose another.', 409);
    const setup = await setupForHold(hold, tx);
    const [booking] = await tx.insert(bookings).values({
      booking_id: generateBookingId(), customer_id: customer.id, customer_package_id: pkg.id, service_id: service.id,
      booking_date: date, start_time: hold.start_time, end_time: hold.end_time, duration_minutes: hold.duration_minutes,
      customer_first_name: customer.first_name || '', customer_last_name: customer.last_name || '', customer_email: customer.email,
      customer_phone: customer.phone || '', company_name: customer.company, notes: body.notes || null,
      status: 'confirmed', payment_status: 'succeeded', subtotal: '0.00', tax_amount: '0.00', total_amount: '0.00', source: 'package',
      setup_id: setup.setupId, intake: { ...answers.intake, packageHoldId: hold.id, ...(setup.setupName ? { setupName: setup.setupName } : {}) },
    }).returning();
    await redeemCredit(tx, { customerPackageId: pkg.id, customerId: customer.id, bookingId: booking.id, serviceId: service.id, sessionStart, actor: null });
    await tx.update(temporaryHolds).set({ status: 'converted_to_booking' }).where(eq(temporaryHolds.id, hold.id));
    await refreshCustomerStats(tx, customer.id);
    await writeAudit({ actor: { email: customer.email }, operation: 'package.book_online', entityType: 'booking', entityId: booking.id, after: { packageId: pkg.id } }, tx);
    return { booking, service };
  });
  if (outcome.service) await runPostConfirmationSideEffects(outcome.booking, outcome.service).catch(() => undefined);
  return { bookingId: outcome.booking.booking_id };
}
