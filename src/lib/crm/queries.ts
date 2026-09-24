import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditLogs, bookings, customerPackages, customers, packageCreditTransactions, packagePlans, purchases, refunds, services } from '@/lib/db/schema';
import { SERVICE_CATEGORIES } from '@/lib/catalog';
import { addDays, isDateString, wallTimeToUtc } from './time';

/**
 * Filtered, paginated list queries shared by the CRM pages and the CSV
 * exports (so an export always matches what the page shows).
 */

export const PAGE_SIZE = 25;
export const EXPORT_LIMIT = 10000;

function like(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function dateBounds(from?: string, to?: string) {
  return {
    start: isDateString(from) ? wallTimeToUtc(from, '00:00') : undefined,
    end: isDateString(to) ? wallTimeToUtc(addDays(to, 1), '00:00') : undefined,
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const BOOKING_STATUSES = ['confirmed', 'payment_pending', 'pending', 'completed', 'no_show', 'cancelled', 'refunded'] as const;
export const BOOKING_SOURCES = ['individual', 'package', 'studio_tour', 'admin'] as const;

export interface SessionFilters {
  q?: string;
  status?: string;
  category?: string;
  service?: string;
  source?: string;
  when?: string; // upcoming | past
  from?: string;
  to?: string;
  room?: string;
  sort?: string; // start_asc | start_desc | created_desc
  review?: string;
  page?: string;
}

function sessionWhere(f: SessionFilters): SQL | undefined {
  const c: SQL[] = [];
  const q = f.q?.trim();
  if (q) {
    c.push(
      or(
        ilike(bookings.booking_id, like(q)),
        ilike(bookings.customer_email, like(q)),
        sql`${bookings.customer_first_name} || ' ' || ${bookings.customer_last_name} ILIKE ${like(q)}`,
        ilike(bookings.customer_phone, like(q))
      )!
    );
  }
  if (f.status && (BOOKING_STATUSES as readonly string[]).includes(f.status)) c.push(eq(bookings.status, f.status as (typeof BOOKING_STATUSES)[number]));
  if (f.category && (SERVICE_CATEGORIES as readonly string[]).includes(f.category)) c.push(sql`${services.category}::text = ${f.category}`);
  if (f.service && /^\d+$/.test(f.service)) c.push(eq(bookings.service_id, Number(f.service)));
  if (f.source && (BOOKING_SOURCES as readonly string[]).includes(f.source)) c.push(eq(bookings.source, f.source as (typeof BOOKING_SOURCES)[number]));
  if (f.room && /^\d+$/.test(f.room)) c.push(eq(bookings.room_id, Number(f.room)));
  if (f.when === 'upcoming') c.push(gte(bookings.starts_at, new Date()));
  if (f.when === 'past') c.push(lt(bookings.starts_at, new Date()));
  if (f.review === '1') c.push(eq(bookings.needs_refund_review, true));
  const { start, end } = dateBounds(f.from, f.to);
  if (start) c.push(gte(bookings.starts_at, start));
  if (end) c.push(lt(bookings.starts_at, end));
  return c.length ? and(...c) : undefined;
}

export async function listSessions(f: SessionFilters, opts: { page?: number; pageSize?: number } = {}) {
  const where = sessionWhere(f);
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const page = opts.page ?? 1;
  const order =
    f.sort === 'start_desc' ? [desc(bookings.starts_at)] : f.sort === 'created_desc' ? [desc(bookings.created_at)] : f.when === 'past' ? [desc(bookings.starts_at)] : [asc(bookings.starts_at)];
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: bookings.id,
        booking_id: bookings.booking_id,
        booking_date: bookings.booking_date,
        start_time: bookings.start_time,
        end_time: bookings.end_time,
        duration_minutes: bookings.duration_minutes,
        status: bookings.status,
        payment_status: bookings.payment_status,
        source: bookings.source,
        total_amount: bookings.total_amount,
        first: bookings.customer_first_name,
        last: bookings.customer_last_name,
        email: bookings.customer_email,
        phone: bookings.customer_phone,
        company: bookings.company_name,
        customer_id: bookings.customer_id,
        service: services.name,
        category: services.category,
        calendar: bookings.google_calendar_event_id,
        sheet: bookings.google_sheets_row_id,
        needs_refund_review: bookings.needs_refund_review,
        created_at: bookings.created_at,
        starts_at: bookings.starts_at,
      })
      .from(bookings)
      .innerJoin(services, eq(services.id, bookings.service_id))
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(bookings).innerJoin(services, eq(services.id, bookings.service_id)).where(where),
  ]);
  return { rows, total: Number(total) };
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface CustomerFilters {
  q?: string;
  status?: string;
  sort?: string; // recent | spent | bookings | name
  page?: string;
}

export async function listCustomers(f: CustomerFilters, opts: { page?: number; pageSize?: number } = {}) {
  const c: SQL[] = [];
  const q = f.q?.trim();
  if (q) {
    c.push(
      or(
        ilike(customers.email, like(q)),
        sql`coalesce(${customers.first_name}, '') || ' ' || coalesce(${customers.last_name}, '') ILIKE ${like(q)}`,
        ilike(customers.phone, like(q)),
        ilike(customers.company, like(q))
      )!
    );
  }
  if (f.status && ['active', 'archived', 'merged'].includes(f.status)) c.push(eq(customers.status, f.status as 'active'));
  else c.push(sql`${customers.status} <> 'merged'`);
  const where = and(...c);
  const order =
    f.sort === 'spent'
      ? [desc(customers.total_spent_cents)]
      : f.sort === 'bookings'
        ? [desc(customers.booking_count)]
        : f.sort === 'name'
          ? [asc(customers.first_name), asc(customers.last_name)]
          : [sql`${customers.last_booking_at} DESC NULLS LAST`, desc(customers.created_at)];
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const page = opts.page ?? 1;
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(customers).where(where).orderBy(...order).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(customers).where(where),
  ]);
  return { rows, total: Number(total) };
}

// ---------------------------------------------------------------------------
// Purchases and refunds
// ---------------------------------------------------------------------------

export interface PurchaseFilters {
  q?: string;
  status?: string;
  type?: string;
  from?: string;
  to?: string;
  review?: string;
  page?: string;
}

function purchaseWhere(f: PurchaseFilters): SQL | undefined {
  const c: SQL[] = [];
  const q = f.q?.trim();
  if (q) {
    c.push(
      or(
        ilike(purchases.order_number, like(q)),
        ilike(purchases.stripe_payment_intent_id, like(q)),
        ilike(purchases.stripe_checkout_session_id, like(q)),
        ilike(customers.email, like(q)),
        sql`coalesce(${customers.first_name}, '') || ' ' || coalesce(${customers.last_name}, '') ILIKE ${like(q)}`
      )!
    );
  }
  if (f.status && ['pending', 'paid', 'partially_refunded', 'refunded', 'cancelled', 'failed', 'approved'].includes(f.status)) {
    c.push(eq(purchases.status, f.status as 'paid'));
  }
  if (f.type && ['individual', 'package', 'studio_tour', 'manual'].includes(f.type)) c.push(eq(purchases.type, f.type as 'manual'));
  if (f.review === '1') c.push(eq(purchases.needs_refund_review, true));
  const { start, end } = dateBounds(f.from, f.to);
  if (start) c.push(gte(purchases.created_at, start));
  if (end) c.push(lt(purchases.created_at, end));
  return c.length ? and(...c) : undefined;
}

export async function listPurchases(f: PurchaseFilters, opts: { page?: number; pageSize?: number } = {}) {
  const where = purchaseWhere(f);
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const page = opts.page ?? 1;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: purchases.id,
        order_number: purchases.order_number,
        type: purchases.type,
        status: purchases.status,
        subtotal_cents: purchases.subtotal_cents,
        tax_cents: purchases.tax_cents,
        total_cents: purchases.total_cents,
        refunded_cents: purchases.refunded_cents,
        payment_method: purchases.payment_method,
        stripe_payment_intent_id: purchases.stripe_payment_intent_id,
        promotion_code: purchases.promotion_code,
        needs_refund_review: purchases.needs_refund_review,
        purchased_at: purchases.purchased_at,
        created_at: purchases.created_at,
        customer_id: purchases.customer_id,
        email: customers.email,
        first: customers.first_name,
        last: customers.last_name,
      })
      .from(purchases)
      .leftJoin(customers, eq(customers.id, purchases.customer_id))
      .where(where)
      .orderBy(desc(purchases.created_at))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(purchases).leftJoin(customers, eq(customers.id, purchases.customer_id)).where(where),
  ]);
  return { rows, total: Number(total) };
}

export async function listRefunds(f: { from?: string; to?: string; status?: string }, limit = EXPORT_LIMIT) {
  const c: SQL[] = [];
  const { start, end } = dateBounds(f.from, f.to);
  if (start) c.push(gte(refunds.created_at, start));
  if (end) c.push(lt(refunds.created_at, end));
  if (f.status && ['pending', 'succeeded', 'failed', 'canceled', 'requires_action'].includes(f.status)) c.push(eq(refunds.status, f.status as 'pending'));
  return db
    .select({
      id: refunds.id,
      created_at: refunds.created_at,
      amount_cents: refunds.amount_cents,
      status: refunds.status,
      reason: refunds.reason,
      source: refunds.source,
      requested_by: refunds.requested_by,
      stripe_refund_id: refunds.stripe_refund_id,
      order_number: purchases.order_number,
      booking_code: bookings.booking_id,
      email: customers.email,
    })
    .from(refunds)
    .innerJoin(purchases, eq(purchases.id, refunds.purchase_id))
    .leftJoin(bookings, eq(bookings.id, refunds.booking_id))
    .leftJoin(customers, eq(customers.id, purchases.customer_id))
    .where(c.length ? and(...c) : undefined)
    .orderBy(desc(refunds.created_at))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Package credits
// ---------------------------------------------------------------------------

export async function listCreditTransactions(f: { from?: string; to?: string; type?: string }, limit = EXPORT_LIMIT) {
  const c: SQL[] = [];
  const { start, end } = dateBounds(f.from, f.to);
  if (start) c.push(gte(packageCreditTransactions.created_at, start));
  if (end) c.push(lt(packageCreditTransactions.created_at, end));
  if (f.type && ['grant', 'redeem', 'restore', 'expire', 'adjustment'].includes(f.type)) c.push(eq(packageCreditTransactions.type, f.type as 'grant'));
  return db
    .select({
      id: packageCreditTransactions.id,
      created_at: packageCreditTransactions.created_at,
      type: packageCreditTransactions.type,
      credits: packageCreditTransactions.credits,
      balance_after: packageCreditTransactions.balance_after,
      reason: packageCreditTransactions.reason,
      actor_email: packageCreditTransactions.actor_email,
      booking_code: bookings.booking_id,
      plan: packagePlans.name,
      email: customers.email,
      package_id: customerPackages.id,
    })
    .from(packageCreditTransactions)
    .innerJoin(customerPackages, eq(customerPackages.id, packageCreditTransactions.customer_package_id))
    .innerJoin(packagePlans, eq(packagePlans.id, customerPackages.package_plan_id))
    .innerJoin(customers, eq(customers.id, customerPackages.customer_id))
    .leftJoin(bookings, eq(bookings.id, packageCreditTransactions.booking_id))
    .where(c.length ? and(...c) : undefined)
    .orderBy(desc(packageCreditTransactions.created_at))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function auditFor(entityType: string, entityIds: string[], limit = 50) {
  if (entityIds.length === 0) return [];
  return db.query.auditLogs.findMany({
    where: and(eq(auditLogs.entity_type, entityType), inArray(auditLogs.entity_id, entityIds)),
    orderBy: [desc(auditLogs.created_at)],
    limit,
  });
}
