import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { bookings, purchases, services } from '@/lib/db/schema';
import type { Booking, Customer, Service } from '@/lib/db/schema';
import type { Executor } from '@/lib/db/types';
import { pgErrorCode } from '@/lib/db/types';
import { checkTimeSlotConflict, isSlotActuallyAvailable, lockStudioDates } from '@/lib/availability';
import { generateBookingId, toDateOnly } from '@/lib/utils';
import { getTaxRate } from '@/lib/pricing';
import { checkBookable } from '@/lib/catalogData';
import { logIntegration, resyncGoogleAfterChange, syncGoogleIntegrations, syncSheetsForBooking } from '@/lib/integrationSync';
import { sendBookingConfirmationEmail, sendPackageCreditUsedEmail, sendRescheduleEmail } from '@/lib/email';
import { writeAudit, type AuditActor } from './audit';
import { upsertCustomer, refreshCustomerStats, type CustomerInput } from './customers';
import { createPurchase, orderNumberForBooking } from './purchases';
import { redeemCredit } from './packages';
import { CrmError, conflict, notFound } from './errors';
import { centsToDecimal, decimalToCents, taxCents } from './money';
import { minutesToTime, timeToMinutes, wallTimeToUtc } from './time';

/**
 * Staff-side booking operations. Every change that can move a booking into
 * a slot runs in one transaction that
 *   1. takes the per-date studio advisory lock (same lock as public holds),
 *   2. re-checks availability (bookings, holds, blocked time, buffers),
 *   3. writes the booking — where the bookings_no_overlap exclusion
 *      constraint is the final guarantee,
 *   4. writes the audit record.
 * Calendar / Sheets / email run after commit and never undo it.
 */

const DOUBLE_BOOKED = 'That time is no longer free — another booking, hold or blocked time overlaps it.';

function endTimeFor(start: string, durationMinutes: number): string {
  const end = timeToMinutes(start) + durationMinutes;
  if (end > 24 * 60) throw new CrmError('Sessions cannot run past midnight');
  return minutesToTime(end === 24 * 60 ? 0 : end);
}

async function assertSlotFree(
  tx: Executor,
  args: { date: string; start: string; end: string; duration: number; overrideHours: boolean; excludeBookingId?: string }
) {
  if (args.overrideHours) {
    // Outside opening hours / off the grid is allowed for staff, on top of someone else is not.
    if (await checkTimeSlotConflict(args.date, args.start, args.end, tx, { excludeBookingId: args.excludeBookingId })) {
      throw conflict(DOUBLE_BOOKED);
    }
    return;
  }
  const ok = await isSlotActuallyAvailable(args.date, args.start, args.end, args.duration, tx, {
    excludeBookingId: args.excludeBookingId,
    ignoreCutoff: true,
  });
  if (!ok) {
    throw conflict(
      'That time is not bookable: it is outside opening hours, off the booking grid, or overlaps another booking, hold or blocked time. ' +
        'Use "allow outside hours" to book off-grid.'
    );
  }
}

function mapOverlapError(error: unknown): never {
  if (pgErrorCode(error) === '23P01') throw conflict(DOUBLE_BOOKED);
  throw error;
}

// ---------------------------------------------------------------------------
// Manual booking
// ---------------------------------------------------------------------------

export type ManualPayment =
  | { mode: 'unpaid' }
  | { mode: 'comp' }
  | { mode: 'offline_paid'; method: 'cash' | 'card_terminal' | 'bank_transfer' | 'other' }
  | { mode: 'package'; customerPackageId: string };

export interface ManualBookingInput {
  serviceId: number;
  date: string;
  startTime: string;
  customer: { customerId: string } | CustomerInput;
  notes?: string | null;
  internalNotes?: string | null;
  payment: ManualPayment;
  overrideHours?: boolean;
  sendConfirmation?: boolean;
}

export interface BookingSideEffects {
  calendar?: string;
  sheets?: string;
  email?: string;
}

export async function createManualBooking(
  input: ManualBookingInput,
  actor: AuditActor
): Promise<{ booking: Booking; effects: BookingSideEffects }> {
  const service = await db.query.services.findFirst({ where: eq(services.id, input.serviceId) });
  if (!service) throw notFound('Service');
  const bookable = checkBookable(service);
  if (!bookable.ok) throw new CrmError(bookable.error, bookable.status);

  const endTime = endTimeFor(input.startTime, service.duration_minutes);
  const sessionStart = wallTimeToUtc(input.date, input.startTime);

  const booking = await db
    .transaction(async (tx) => {
      await lockStudioDates(tx, [input.date]);
      await assertSlotFree(tx, {
        date: input.date,
        start: input.startTime,
        end: endTime,
        duration: service.duration_minutes,
        overrideHours: !!input.overrideHours,
      });

      let customer: Customer;
      if ('customerId' in input.customer) {
        const found = await tx.query.customers.findFirst({ where: (c, { eq: e }) => e(c.id, (input.customer as { customerId: string }).customerId) });
        if (!found || found.status === 'merged') throw notFound('Customer');
        customer = found;
      } else {
        customer = await upsertCustomer(tx, input.customer, { updateContact: true });
      }
      const first = customer.first_name || '';
      const last = customer.last_name || '';
      if (!first) throw new CrmError('The customer needs a first name');

      const bookingUuid = crypto.randomUUID();
      const bookingId = generateBookingId();
      const listCents = decimalToCents(service.base_price);
      const isTour = service.category === 'tour';
      const pay = input.payment;

      let subtotal = 0;
      let tax = 0;
      let purchaseId: string | null = null;
      let paymentStatus: Booking['payment_status'] = 'succeeded';

      if (pay.mode !== 'package') {
        const charged = pay.mode === 'comp' || listCents === 0 ? 0 : listCents;
        subtotal = charged;
        tax = charged > 0 ? taxCents(charged, await getTaxRate(tx)) : 0;
        paymentStatus = pay.mode === 'unpaid' && charged > 0 ? 'pending' : 'succeeded';
        const purchase = await createPurchase(tx, {
          orderNumber: orderNumberForBooking(bookingId),
          customerId: customer.id,
          type: isTour ? 'studio_tour' : 'manual',
          status: charged === 0 ? 'approved' : pay.mode === 'offline_paid' ? 'paid' : 'pending',
          taxCents: tax,
          paymentMethod: charged === 0 ? 'comp' : pay.mode === 'offline_paid' ? pay.method : 'other',
          purchasedAt: paymentStatus === 'succeeded' ? new Date() : null,
          createdByAdminId: actor.id ?? null,
          items: [
            {
              itemType: 'service',
              referenceId: service.id,
              description: `${service.name} — ${input.date} ${input.startTime}–${endTime} ET`,
              unitPriceCents: charged,
              metadata: { bookingId, listPriceCents: listCents, category: service.category, durationMinutes: service.duration_minutes, mode: pay.mode },
            },
          ],
        });
        purchaseId = purchase.id;
      }

      const [created] = await tx
        .insert(bookings)
        .values({
          id: bookingUuid,
          booking_id: bookingId,
          customer_id: customer.id,
          service_id: service.id,
          booking_date: input.date,
          start_time: input.startTime,
          end_time: endTime,
          duration_minutes: service.duration_minutes,
          customer_first_name: first,
          customer_last_name: last,
          customer_email: customer.email,
          customer_phone: customer.phone || '',
          company_name: customer.company,
          notes: input.notes?.trim() || null,
          internal_notes: input.internalNotes?.trim() || null,
          status: 'confirmed',
          payment_status: paymentStatus,
          subtotal: centsToDecimal(subtotal),
          tax_amount: centsToDecimal(tax),
          total_amount: centsToDecimal(subtotal + tax),
          purchase_id: purchaseId,
          source: pay.mode === 'package' ? 'package' : 'admin',
          customer_package_id: pay.mode === 'package' ? pay.customerPackageId : null,
          created_by_admin_id: actor.id ?? null,
          updated_by_admin_id: actor.id ?? null,
        })
        .returning();

      if (pay.mode === 'package') {
        await redeemCredit(tx, {
          customerPackageId: pay.customerPackageId,
          customerId: customer.id,
          bookingId: created.id,
          serviceId: service.id,
          sessionStart,
          actor,
        });
      }

      await refreshCustomerStats(tx, customer.id);
      await writeAudit(
        {
          actor,
          operation: 'booking.create_manual',
          entityType: 'booking',
          entityId: created.id,
          after: {
            bookingId: created.booking_id,
            service: service.name,
            date: input.date,
            start: input.startTime,
            end: endTime,
            customerId: customer.id,
            payment: pay.mode,
            totalCents: subtotal + tax,
            overrideHours: !!input.overrideHours,
          },
        },
        tx
      );
      return created;
    })
    .catch(mapOverlapError);

  const effects: BookingSideEffects = {};
  const google = await syncGoogleIntegrations(booking, service);
  effects.calendar = google.calendar.message;
  effects.sheets = google.sheets.message;
  if (input.sendConfirmation) {
    const email =
      input.payment.mode === 'package'
        ? await sendPackageCreditUsedEmail(booking.id)
        : await sendBookingConfirmationEmail({ booking, service });
    effects.email = email.sent ? 'Confirmation email sent' : `Email ${email.status}: ${email.error ?? ''}`.trim();
    await logIntegration('email', booking.id, email.sent ? 'success' : 'failed', effects.email);
  }
  return { booking, effects };
}

// ---------------------------------------------------------------------------
// Reschedule / change service
// ---------------------------------------------------------------------------

export interface RescheduleInput {
  date: string;
  startTime: string;
  serviceId?: number;
  overrideHours?: boolean;
  notifyCustomer?: boolean;
  reason?: string | null;
}

/**
 * Moves a confirmed booking (and/or switches it to another service of a
 * different length). The price that was paid is never changed — a price
 * difference is settled separately (refund or manual purchase).
 */
export async function rescheduleBooking(
  bookingUuid: string,
  input: RescheduleInput,
  actor: AuditActor
): Promise<{ booking: Booking; effects: BookingSideEffects }> {
  const before = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingUuid) });
  if (!before) throw notFound('Booking');
  if (before.status !== 'confirmed') throw new CrmError(`A ${before.status} booking can't be rescheduled`, 409);

  const serviceId = input.serviceId ?? before.service_id;
  const service = await db.query.services.findFirst({ where: eq(services.id, serviceId) });
  if (!service) throw notFound('Service');
  if (serviceId !== before.service_id) {
    const bookable = checkBookable(service);
    if (!bookable.ok) throw new CrmError(bookable.error, bookable.status);
  }

  const endTime = endTimeFor(input.startTime, service.duration_minutes);
  const oldDate = toDateOnly(before.booking_date);
  if (oldDate === input.date && before.start_time === input.startTime && serviceId === before.service_id) {
    throw new CrmError('That is already the booking’s time');
  }

  const booking = await db
    .transaction(async (tx) => {
      await lockStudioDates(tx, [oldDate, input.date]);
      const fresh = await tx.query.bookings.findFirst({ where: eq(bookings.id, bookingUuid) });
      if (!fresh || fresh.status !== 'confirmed') throw conflict('The booking changed; reload and try again');
      await assertSlotFree(tx, {
        date: input.date,
        start: input.startTime,
        end: endTime,
        duration: service.duration_minutes,
        overrideHours: !!input.overrideHours,
        excludeBookingId: bookingUuid,
      });
      const [updated] = await tx
        .update(bookings)
        .set({
          booking_date: input.date,
          start_time: input.startTime,
          end_time: endTime,
          service_id: service.id,
          duration_minutes: service.duration_minutes,
          updated_by_admin_id: actor.id ?? null,
          updated_at: new Date(),
        })
        .where(and(eq(bookings.id, bookingUuid), eq(bookings.status, 'confirmed')))
        .returning();
      await refreshCustomerStats(tx, updated.customer_id);
      await writeAudit(
        {
          actor,
          operation: serviceId !== before.service_id ? 'booking.change_service' : 'booking.reschedule',
          entityType: 'booking',
          entityId: bookingUuid,
          before: { date: oldDate, start: before.start_time, end: before.end_time, serviceId: before.service_id },
          after: { date: input.date, start: input.startTime, end: endTime, serviceId: service.id },
          metadata: { reason: input.reason ?? null, overrideHours: !!input.overrideHours },
        },
        tx
      );
      return updated;
    })
    .catch(mapOverlapError);

  const effects: BookingSideEffects = {};
  const google = await resyncGoogleAfterChange(booking, service);
  effects.calendar = google.calendar.message;
  effects.sheets = google.sheets.message;
  if (input.notifyCustomer) {
    const email = await sendRescheduleEmail({ booking, service, previous: { date: oldDate, startTime: before.start_time } });
    effects.email = email.sent ? 'Reschedule email sent' : `Email ${email.status}: ${email.error ?? ''}`.trim();
    await logIntegration('email', booking.id, email.sent ? 'success' : 'failed', effects.email);
  }
  return { booking, effects };
}

// ---------------------------------------------------------------------------
// Outcome: completed / no-show
// ---------------------------------------------------------------------------

export async function setBookingOutcome(bookingUuid: string, outcome: 'completed' | 'no_show' | 'confirmed', actor: AuditActor) {
  const before = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingUuid) });
  if (!before) throw notFound('Booking');
  const allowedFrom: Record<typeof outcome, Booking['status'][]> = {
    completed: ['confirmed', 'no_show'],
    no_show: ['confirmed', 'completed'],
    confirmed: ['completed', 'no_show'], // undo
  };
  if (!allowedFrom[outcome].includes(before.status)) {
    throw new CrmError(`A ${before.status} booking can't be marked ${outcome.replace('_', '-')}`, 409);
  }
  if (outcome !== 'confirmed' && before.starts_at && before.starts_at > new Date()) {
    throw new CrmError('The session has not started yet');
  }

  const now = new Date();
  const [updated] = await db
    .update(bookings)
    .set({
      status: outcome,
      completed_at: outcome === 'completed' ? now : null,
      no_show_at: outcome === 'no_show' ? now : null,
      updated_by_admin_id: actor.id ?? null,
      updated_at: now,
    })
    .where(and(eq(bookings.id, bookingUuid), inArray(bookings.status, allowedFrom[outcome])))
    .returning();
  if (!updated) throw conflict('The booking changed; reload and try again');

  await refreshCustomerStats(db, updated.customer_id);
  await writeAudit({
    actor,
    operation: outcome === 'confirmed' ? 'booking.reopen' : `booking.mark_${outcome}`,
    entityType: 'booking',
    entityId: bookingUuid,
    before: { status: before.status },
    after: { status: outcome },
  });

  const service = await db.query.services.findFirst({ where: eq(services.id, updated.service_id) });
  if (service) await syncSheetsForBooking(updated, service);
  return updated;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function updateBookingNotes(bookingUuid: string, internalNotes: string, actor: AuditActor) {
  const before = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingUuid) });
  if (!before) throw notFound('Booking');
  const value = internalNotes.trim().slice(0, 5000) || null;
  const [updated] = await db
    .update(bookings)
    .set({ internal_notes: value, updated_by_admin_id: actor.id ?? null, updated_at: new Date() })
    .where(eq(bookings.id, bookingUuid))
    .returning();
  await writeAudit({
    actor,
    operation: 'booking.update_notes',
    entityType: 'booking',
    entityId: bookingUuid,
    before: { internalNotes: before.internal_notes },
    after: { internalNotes: value },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Offline payment for an unpaid manual booking / package
// ---------------------------------------------------------------------------

export async function markPurchasePaid(
  purchaseId: string,
  method: 'cash' | 'card_terminal' | 'bank_transfer' | 'other',
  actor: AuditActor
) {
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(purchases)
      .set({ status: 'paid', payment_method: method, purchased_at: new Date(), updated_at: new Date() })
      .where(and(eq(purchases.id, purchaseId), eq(purchases.status, 'pending'), inArray(purchases.payment_method, ['other', 'cash', 'card_terminal', 'bank_transfer'])))
      .returning();
    if (!updated) throw new CrmError('Only an unpaid, non-Stripe purchase can be marked paid', 409);
    const linked = await tx
      .update(bookings)
      .set({ payment_status: 'succeeded', updated_by_admin_id: actor.id ?? null, updated_at: new Date() })
      .where(and(eq(bookings.purchase_id, purchaseId), eq(bookings.payment_status, 'pending')))
      .returning();
    await refreshCustomerStats(tx, updated.customer_id);
    await writeAudit(
      { actor, operation: 'purchase.mark_paid', entityType: 'purchase', entityId: purchaseId, before: { status: 'pending' }, after: { status: 'paid', method } },
      tx
    );
    return { purchase: updated, bookings: linked };
  });
  for (const b of result.bookings) {
    const service = await db.query.services.findFirst({ where: eq(services.id, b.service_id) });
    if (service) await syncSheetsForBooking(b, service);
  }
  return result.purchase;
}

/** Services a booking can be switched to (single sessions, active). */
export async function switchableServices(): Promise<Service[]> {
  const rows = await db.query.services.findMany({ orderBy: (s, { asc }) => [asc(s.category), asc(s.display_order)] });
  return rows.filter((s) => s.is_active && s.category !== 'package' && !s.archived_at);
}

