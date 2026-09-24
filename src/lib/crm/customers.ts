import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookings, customerNotes, customerPackages, customers, emailLogs, purchases } from '@/lib/db/schema';
import type { Customer } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/types';
import { normalizeEmail } from '@/lib/adminAuth';
import { writeAudit, type AuditActor } from './audit';

export interface CustomerInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  company?: string | null;
}

function clean(value: string | null | undefined): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  return v ? v : null;
}

/** Runs `fn` in the caller's transaction, or opens one when given the plain db. */
export async function inTransaction<T>(exec: Executor, fn: (tx: Executor) => Promise<T>): Promise<T> {
  return exec === db ? db.transaction((tx) => fn(tx)) : fn(exec);
}

/**
 * Finds the customer for an email (case- and whitespace-insensitive) or
 * creates one. Never creates a second customer for the same person:
 * concurrent calls for one email are serialised by a transaction-scoped
 * advisory lock, and an email that belongs to a merged record resolves to
 * the record it was merged into. With `updateContact`, non-empty contact
 * details from the booking form refresh the stored ones.
 */
export async function upsertCustomer(
  exec: Executor,
  input: CustomerInput,
  options: { updateContact?: boolean } = {}
): Promise<Customer> {
  const email = input.email.trim();
  const normalized = normalizeEmail(email);

  return inTransaction(exec, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`customer:${normalized}`}))`);

    let existing = await tx.query.customers.findFirst({
      where: and(eq(customers.normalized_email, normalized), ne(customers.status, 'merged')),
      orderBy: (c, { asc }) => [asc(c.created_at)],
    });

    if (!existing) {
      // Follow a merged record to the customer it now belongs to.
      let merged = await tx.query.customers.findFirst({ where: eq(customers.normalized_email, normalized) });
      for (let hops = 0; merged?.status === 'merged' && merged.merged_into_id && hops < 5; hops++) {
        merged = await tx.query.customers.findFirst({ where: eq(customers.id, merged.merged_into_id) });
      }
      if (merged && merged.status !== 'merged') existing = merged;
    }

    if (existing) {
      if (options.updateContact) {
        const updates: Partial<Customer> = {};
        const first = clean(input.firstName);
        const last = clean(input.lastName);
        const phone = clean(input.phone);
        const company = clean(input.company);
        if (first && first !== existing.first_name) updates.first_name = first;
        if (last && last !== existing.last_name) updates.last_name = last;
        if (phone && phone !== existing.phone) updates.phone = phone.slice(0, 20);
        if (company && company !== existing.company) updates.company = company;
        if (Object.keys(updates).length > 0) {
          const [updated] = await tx
            .update(customers)
            .set({ ...updates, updated_at: new Date() })
            .where(eq(customers.id, existing.id))
            .returning();
          return updated;
        }
      }
      return existing;
    }

    const [created] = await tx
      .insert(customers)
      .values({
        email,
        first_name: clean(input.firstName),
        last_name: clean(input.lastName),
        phone: clean(input.phone)?.slice(0, 20) ?? null,
        company: clean(input.company),
      })
      .returning();
    return created;
  });
}

/**
 * Recomputes the denormalised stats on a customer:
 * - total_spent_cents = Σ (total − refunded) over paid / (partially) refunded purchases
 * - booking_count     = bookings that held the room (confirmed, completed, no-show)
 * - last_booking_at   = latest start among those bookings
 */
export async function refreshCustomerStats(exec: Executor, customerId: string | null | undefined) {
  if (!customerId) return;
  await exec.execute(sql`
    UPDATE customers c SET
      total_spent_cents = coalesce((
        SELECT sum(p.total_cents - p.refunded_cents) FROM purchases p
         WHERE p.customer_id = c.id AND p.status IN ('paid', 'partially_refunded', 'refunded')), 0),
      booking_count = (
        SELECT count(*) FROM bookings b
         WHERE b.customer_id = c.id AND b.status IN ('confirmed', 'completed', 'no_show')),
      last_booking_at = (
        SELECT max(b.starts_at) FROM bookings b
         WHERE b.customer_id = c.id AND b.status IN ('confirmed', 'completed', 'no_show')),
      updated_at = now()
    WHERE c.id = ${customerId}
  `);
}

// ---------------------------------------------------------------------------
// Merge duplicates
// ---------------------------------------------------------------------------

export interface MergePreview {
  primary: Customer;
  duplicate: Customer;
  emailsMatch: boolean;
  moves: { bookings: number; purchases: number; packages: number; notes: number; emails: number };
  /** What the admin must type to confirm. */
  confirmationPhrase: string;
  blockers: string[];
}

async function countWhere(exec: Executor, table: 'bookings' | 'purchases' | 'customer_packages' | 'customer_notes', customerId: string) {
  const result = await exec.execute(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE customer_id = ${customerId}`);
  const rows = (Array.isArray(result) ? result : (result as any).rows) as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

export async function previewMerge(primaryId: string, duplicateId: string, exec: Executor = db): Promise<MergePreview | null> {
  const [primary, duplicate] = await Promise.all([
    exec.query.customers.findFirst({ where: eq(customers.id, primaryId) }),
    exec.query.customers.findFirst({ where: eq(customers.id, duplicateId) }),
  ]);
  if (!primary || !duplicate) return null;

  const blockers: string[] = [];
  if (primary.id === duplicate.id) blockers.push('Choose two different customers.');
  if (primary.status === 'merged') blockers.push('The customer you keep has itself been merged into another record.');
  if (duplicate.status === 'merged') blockers.push('The duplicate has already been merged.');

  const [b, p, k, n] = await Promise.all([
    countWhere(exec, 'bookings', duplicate.id),
    countWhere(exec, 'purchases', duplicate.id),
    countWhere(exec, 'customer_packages', duplicate.id),
    countWhere(exec, 'customer_notes', duplicate.id),
  ]);
  const emailRows = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(emailLogs)
    .innerJoin(bookings, eq(bookings.id, emailLogs.booking_id))
    .where(eq(bookings.customer_id, duplicate.id));

  const emailsMatch = (primary.normalized_email ?? normalizeEmail(primary.email)) === (duplicate.normalized_email ?? normalizeEmail(duplicate.email));
  return {
    primary,
    duplicate,
    emailsMatch,
    moves: { bookings: b, purchases: p, packages: k, notes: n, emails: Number(emailRows[0]?.n ?? 0) },
    confirmationPhrase: emailsMatch ? `MERGE ${duplicate.email}` : `MERGE DIFFERENT PEOPLE ${duplicate.email}`,
    blockers,
  };
}

export type MergeResult = { ok: true; primary: Customer; moved: MergePreview['moves'] } | { ok: false; status: number; error: string };

/**
 * Moves everything from `duplicateId` onto `primaryId` in one transaction
 * and marks the duplicate as merged (it is kept, never deleted). The admin
 * must type the exact confirmation phrase from the preview; merging two
 * different email addresses needs a longer, explicit phrase.
 */
export async function mergeCustomers(
  primaryId: string,
  duplicateId: string,
  confirmation: string,
  actor: AuditActor
): Promise<MergeResult> {
  const preview = await previewMerge(primaryId, duplicateId);
  if (!preview) return { ok: false, status: 404, error: 'Customer not found' };
  if (preview.blockers.length) return { ok: false, status: 409, error: preview.blockers.join(' ') };
  if (confirmation.trim() !== preview.confirmationPhrase) {
    return { ok: false, status: 400, error: `Type "${preview.confirmationPhrase}" to confirm the merge` };
  }

  const primary = await db.transaction(async (tx) => {
    // Lock both rows in a stable order so two merges can't interleave.
    const [first, second] = [primaryId, duplicateId].sort();
    await tx.execute(sql`SELECT id FROM customers WHERE id IN (${first}, ${second}) ORDER BY id FOR UPDATE`);
    const p = await tx.query.customers.findFirst({ where: eq(customers.id, primaryId) });
    const d = await tx.query.customers.findFirst({ where: eq(customers.id, duplicateId) });
    if (!p || !d || p.status === 'merged' || d.status === 'merged') return null;

    await tx.update(bookings).set({ customer_id: p.id }).where(eq(bookings.customer_id, d.id));
    await tx.update(purchases).set({ customer_id: p.id, updated_at: new Date() }).where(eq(purchases.customer_id, d.id));
    await tx.update(customerPackages).set({ customer_id: p.id, updated_at: new Date() }).where(eq(customerPackages.customer_id, d.id));
    await tx.update(customerNotes).set({ customer_id: p.id }).where(eq(customerNotes.customer_id, d.id));

    const notes = [p.internal_notes, d.internal_notes ? `Merged from ${d.email}: ${d.internal_notes}` : null].filter(Boolean).join('\n\n');
    const [updated] = await tx
      .update(customers)
      .set({
        first_name: p.first_name ?? d.first_name,
        last_name: p.last_name ?? d.last_name,
        phone: p.phone ?? d.phone,
        company: p.company ?? d.company,
        stripe_customer_id: p.stripe_customer_id ?? d.stripe_customer_id,
        marketing_consent: p.marketing_consent || d.marketing_consent,
        internal_notes: notes || null,
        updated_at: new Date(),
      })
      .where(eq(customers.id, p.id))
      .returning();

    await tx
      .update(customers)
      .set({ status: 'merged', merged_into_id: p.id, total_spent_cents: 0, booking_count: 0, last_booking_at: null, updated_at: new Date() })
      .where(eq(customers.id, d.id));

    await refreshCustomerStats(tx, p.id);
    await writeAudit(
      {
        actor,
        operation: 'customer.merge',
        entityType: 'customer',
        entityId: p.id,
        before: { primary: { id: p.id, email: p.email }, duplicate: { id: d.id, email: d.email } },
        after: { mergedInto: p.id },
        metadata: { moved: preview.moves, emailsMatch: preview.emailsMatch },
      },
      tx
    );
    return updated;
  });

  if (!primary) return { ok: false, status: 409, error: 'One of the customers changed; reload and try again' };
  return { ok: true, primary, moved: preview.moves };
}
