import type Stripe from 'stripe';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { bookingExtensions, bookings, purchaseItems, purchases, refunds, serviceAddons, services, setups, temporaryHolds } from './db/schema';
import type { Booking, BookingExtension, Purchase, Service } from './db/schema';
import type { Executor } from './db/types';
import { pgErrorCode } from './db/types';
import { checkTimeSlotConflict, getAvailableDates, getAvailableTimeSlotsForDate, getBookingRules, loadDayContext, lockStudioDates, overlaps } from './availability';
import { MAX_SESSION_HOURS, addonAvailability, computeQuote, maxUnits, type Intake, type Quote } from './bookingOptions';
import { cancelBooking } from './cancelBooking';
import { BUSINESS_ADDRESS, BUSINESS_EMAIL } from './constants';
import { formatDuration } from './catalog';
import { bookingForToken } from './manageToken';
import { abandonExtension, releasePendingExtensions } from './extensions';
import { cameraConfigMessage, logConfigWarning } from './configWarnings';
import { POLICY_COPY, bookingEligibility, canChangeBooking, changeDeadline } from './policies';
import { getTaxRate } from './pricing';
import { toDateOnly } from './utils';
import { writeAudit, type AuditActor } from './crm/audit';
import { rescheduleBooking } from './crm/bookings';
import { refreshCustomerStats } from './crm/customers';
import { CrmError } from './crm/errors';
import { COLLECTED_STATUSES, createPurchase, generateOrderNumber, recomputeRefundState } from './crm/purchases';
import { getStripe, issueRefund, refundableCents } from './crm/refunds';
import { addDays, formatInstantEt, isDateString, isTimeString, minutesToTime, timeToMinutes, todayInTz } from './crm/time';
import { logIntegration, resyncGoogleAfterChange } from './integrationSync';
import { sendGuestScheduleUpdateEmails, sendExtensionEmail, sendOwnerPaymentReviewEmail, sendCancellationEmail } from './email';

/**
 * Customer self-service on top of the existing domain logic. Nothing here
 * re-implements a rule that already exists:
 *
 *  - cancellation   → cancelBooking (compare-and-set, Calendar/Sheets, holds, credits)
 *  - refund         → issueRefund (refund row first, Stripe idempotency key, webhook reconciliation)
 *  - reschedule     → rescheduleBooking (date locks, slot check, overlap constraint, Calendar patch)
 *  - extra time     → a normal purchase + Stripe Checkout + webhook, guarded by a
 *                     temporary hold, lockStudioDates and the overlap constraint
 *
 * Every function starts from a Manage Booking token (lib/manageToken.ts);
 * no client-sent id, amount or Stripe reference is ever trusted.
 */

export const INVALID_LINK_MESSAGE =
  'This link is invalid or has expired. Please use the most recent link from your ZAYRO Studios email, or contact the studio.';
export const SLOT_TAKEN_MESSAGE = 'That time was just booked. Please choose another available time.';

export function invalidLink(): CrmError {
  return new CrmError(INVALID_LINK_MESSAGE, 404, 'invalid_link');
}

function customerActor(booking: Booking): AuditActor {
  return { email: `customer:${booking.customer_email}` };
}

/** Loads the token's booking or throws the generic invalid-link error. */
async function requireBooking(token: unknown, exec: Executor = db): Promise<Booking> {
  const booking = await bookingForToken(token, exec);
  if (!booking) throw invalidLink();
  return booking;
}

async function serviceOf(booking: Booking, exec: Executor = db): Promise<Service> {
  const service = await exec.query.services.findFirst({ where: eq(services.id, booking.service_id) });
  if (!service) throw invalidLink();
  return service;
}

function isHourly(service: Service): boolean {
  return maxUnits(service) > 1;
}

function endMinutes(time: string): number {
  const m = timeToMinutes(time);
  return m === 0 ? 1440 : m;
}

// ---------------------------------------------------------------------------
// Purchases that belong to a booking (its own + paid extensions)
// ---------------------------------------------------------------------------

async function bookingPurchases(exec: Executor, booking: Booking): Promise<Purchase[]> {
  const ids = new Set<string>();
  if (booking.purchase_id) ids.add(booking.purchase_id);
  const exts = await exec.query.bookingExtensions.findMany({ where: eq(bookingExtensions.booking_id, booking.id) });
  for (const e of exts) if (e.status === 'confirmed' || e.status === 'needs_review') ids.add(e.purchase_id);
  if (ids.size === 0) return [];
  return exec.query.purchases.findMany({ where: inArray(purchases.id, Array.from(ids)), orderBy: [asc(purchases.created_at)] });
}

// ---------------------------------------------------------------------------
// Extension availability and pricing
// ---------------------------------------------------------------------------

export interface ExtensionOption {
  hours: number;
  addedMinutes: number;
  newEndTime: string;
  quote: Quote;
}

/** Hourly add-ons the booking was bought with, as quantity per hour. Per-session add-ons never repeat. */
async function hourlyAddonsOf(exec: Executor, booking: Booking): Promise<{ id: number; perHour: number; snapshotCents: number }[]> {
  if (!booking.purchase_id) return [];
  const items = await exec.query.purchaseItems.findMany({ where: eq(purchaseItems.purchase_id, booking.purchase_id) });
  const serviceLine = items.find((i) => i.item_type === 'service');
  const units = serviceLine && serviceLine.quantity > 0 ? serviceLine.quantity : Math.max(1, Math.ceil(booking.duration_minutes / 60));
  const out: { id: number; perHour: number; snapshotCents: number }[] = [];
  for (const item of items) {
    if (item.item_type !== 'addon') continue;
    if ((item.metadata as { unit?: unknown })?.unit !== 'hour') continue;
    const id = Number(item.reference_id);
    const perHour = Math.max(1, Math.round(item.quantity / units));
    if (Number.isInteger(id) && id > 0) out.push({ id, perHour, snapshotCents: item.unit_price_cents });
  }
  return out;
}

/**
 * Price of `hours` more hours: the service's current hourly price plus every
 * hourly add-on still on the booking at its current catalog price, with tax.
 * Integer cents; server-side only.
 */
export async function quoteExtension(exec: Executor, booking: Booking, service: Service, hours: number): Promise<Quote> {
  const hourly = await hourlyAddonsOf(exec, booking);
  const rows = hourly.length ? await exec.query.serviceAddons.findMany({ where: inArray(serviceAddons.id, hourly.map((h) => h.id)) }) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  // The original purchase snapshot is never changed; extra time just never
  // charges for more of an add-on than the service allows now (camera cap).
  const addons = hourly
    .map((h) => {
      const row = byId.get(h.id);
      const availability = row ? addonAvailability(service, row) : null;
      // Fail closed: if the package's camera count is mis-configured, extra time is not sold online
      // at all (dropping the camera would undercharge; guessing could overcharge).
      if (availability?.configError) throw new ExtensionConfigError(cameraConfigMessage(service, availability.configError));
      const quantity = availability ? Math.min(h.perHour, availability.limit) : h.perHour;
      return {
        addon: { id: h.id, name: row?.name ?? 'Hourly extra', price_cents: row?.price_cents ?? h.snapshotCents, unit: 'hour' as const },
        quantity,
      };
    })
    .filter((a) => a.quantity > 0);
  const hourlyService = { ...service, duration_minutes: 60 };
  return computeQuote({ service: hourlyService, units: hours, addons, taxRate: await getTaxRate(exec) });
}

class ExtensionConfigError extends Error {}

async function activeExtensionHold(exec: Executor, bookingUuid: string) {
  return exec.query.temporaryHolds.findFirst({
    where: and(eq(temporaryHolds.kind, 'extension'), eq(temporaryHolds.booking_id, bookingUuid), eq(temporaryHolds.status, 'active'), sql`${temporaryHolds.hold_expires_at} > now()`),
  });
}

/**
 * How much consecutive time can be added right after the booking: every
 * whole hour from its end until the first thing in the way (another booking
 * or its buffer, an active hold, blocked time, closing time, the daily
 * maximum or midnight). Database only — Google Calendar is never consulted.
 */
export async function extensionOptions(
  exec: Executor,
  booking: Booking,
  service: Service,
  now = new Date()
): Promise<{ options: ExtensionOption[]; reason: string | null }> {
  if (booking.status !== 'confirmed') return { options: [], reason: 'Only confirmed bookings can be extended.' };
  if (!isHourly(service)) return { options: [], reason: 'This service has a fixed length.' };
  if (!booking.ends_at || new Date(booking.ends_at).getTime() <= now.getTime()) return { options: [], reason: 'This session has already ended.' };

  const date = toDateOnly(booking.booking_date);
  const ownHold = await activeExtensionHold(exec, booking.id);
  const ctx = await loadDayContext(date, exec, { excludeBookingId: booking.id, excludeHoldId: ownHold?.id, ignoreCutoff: true, now });
  const start = endMinutes(booking.end_time);
  const usedHours = Math.ceil(booking.duration_minutes / 60);
  const maxAdd = Math.max(0, MAX_SESSION_HOURS - usedHours);
  const closes = ctx.open ? Math.min(ctx.open.end, 1440) : 0;

  const options: ExtensionOption[] = [];
  for (let h = 1; h <= maxAdd; h++) {
    const end = start + h * 60;
    if (!ctx.open || end > closes) break;
    if (ctx.busy.some((b) => overlaps(start, end, b.start, b.end)) || ctx.blocked.some((b) => overlaps(start, end, b.start, b.end))) break;
    let quote: Quote;
    try {
      quote = await quoteExtension(exec, booking, service, h);
    } catch (error) {
      if (!(error instanceof ExtensionConfigError)) throw error;
      await logConfigWarning(error.message);
      return { options: [], reason: 'Extra time for this booking can’t be added online right now. Please contact the studio.' };
    }
    options.push({ hours: h, addedMinutes: h * 60, newEndTime: minutesToTime(end === 1440 ? 0 : end), quote });
  }
  let reason: string | null = null;
  if (options.length === 0) {
    reason =
      maxAdd === 0
        ? `Sessions can be at most ${MAX_SESSION_HOURS} hours.`
        : !ctx.open || start + 60 > closes
          ? 'The studio closes right after your session.'
          : 'The time right after your session is already booked.';
  }
  return { options, reason };
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export interface ManageView {
  reference: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'pending';
  statusLabel: string;
  service: string;
  setup: string | null;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  durationLabel: string;
  participants: number | null;
  extras: string[];
  money: { subtotalCents: number; taxCents: number; totalCents: number; refundedCents: number };
  paymentLabel: string;
  refund: { label: string; items: { amountCents: number; status: string }[] } | null;
  address: string;
  contactEmail: string;
  policies: { studioTime: string; earlyArrival: string; changes: string; refund: string; extension: string; setupChange: string };
  deadlineLabel: string | null;
  can: { cancel: boolean; reschedule: boolean; extend: boolean };
  reasons: { cancel?: string; reschedule?: string; extend?: string };
  extension: { options: { hours: number; newEndTime: string; subtotalCents: number; taxCents: number; totalCents: number; lines: { name: string; quantity: number; totalCents: number }[] }[]; reason: string | null };
  /** The booked length in hours — what a reschedule keeps. */
  hours: number;
  serviceId: number;
  justExtended: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmed',
  cancelled: 'Canceled',
  completed: 'Completed',
  no_show: 'No-show',
  pending: 'Awaiting payment',
  payment_pending: 'Awaiting payment',
  refunded: 'Refunded',
};

function refundStatusLabel(status: string): string {
  if (status === 'succeeded') return 'Refunded';
  if (status === 'failed' || status === 'canceled') return 'Refund not completed — the studio will contact you';
  return 'Refund requested — processing';
}

export async function buildManageView(booking: Booking, exec: Executor = db, now = new Date()): Promise<ManageView> {
  const service = await serviceOf(booking, exec);
  const intake = (booking.intake ?? {}) as Intake;
  const [setupRow, list] = await Promise.all([
    booking.setup_id ? exec.query.setups.findFirst({ where: eq(setups.id, booking.setup_id) }) : null,
    bookingPurchases(exec, booking),
  ]);
  const collected = list.filter((p) => (COLLECTED_STATUSES as readonly string[]).includes(p.status) || p.status === 'approved');
  const own = booking.purchase_id ? list.find((p) => p.id === booking.purchase_id) : undefined;
  const extras = own
    ? (await exec.query.purchaseItems.findMany({ where: eq(purchaseItems.purchase_id, own.id) }))
        .filter((i) => i.item_type === 'addon')
        .map((i) => `${i.description_snapshot.replace(/^Add-on: /, '')}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`)
    : [];
  const refundRows = list.length
    ? await exec.query.refunds.findMany({ where: inArray(refunds.purchase_id, list.map((p) => p.id)), orderBy: [asc(refunds.created_at)] })
    : [];
  const sum = (f: (p: Purchase) => number) => collected.reduce((n, p) => n + f(p), 0);
  const money = {
    subtotalCents: own || collected.length ? sum((p) => p.subtotal_cents) : Math.round(parseFloat(booking.subtotal) * 100),
    taxCents: own || collected.length ? sum((p) => p.tax_cents) : Math.round(parseFloat(booking.tax_amount) * 100),
    totalCents: own || collected.length ? sum((p) => p.total_cents) : Math.round(parseFloat(booking.total_amount) * 100),
    refundedCents: sum((p) => p.refunded_cents),
  };

  const hourly = isHourly(service);
  const eligibility = bookingEligibility(booking, { hourly }, now);
  const ext = eligibility.extend ? await extensionOptions(exec, booking, service, now) : { options: [], reason: eligibility.reasons.extend ?? null };
  const status = (['confirmed', 'cancelled', 'completed', 'no_show'].includes(booking.status) ? booking.status : 'pending') as ManageView['status'];
  const paymentLabel =
    service.category === 'tour'
      ? 'Free'
      : booking.source === 'package'
        ? 'Paid with a monthly package'
        : booking.payment_status === 'succeeded'
          ? 'Paid'
          : booking.payment_status === 'refunded'
            ? 'Refunded'
            : booking.payment_status === 'partially_refunded'
              ? 'Partially refunded'
              : 'Not paid yet';

  return {
    reference: booking.booking_id,
    status,
    statusLabel: STATUS_LABELS[booking.status] ?? booking.status,
    service: service.name,
    setup: setupRow?.name ?? intake.setupName ?? null,
    date: toDateOnly(booking.booking_date),
    startTime: booking.start_time,
    endTime: booking.end_time,
    timezone: 'New York time (ET)',
    durationLabel: formatDuration(booking.duration_minutes),
    participants: typeof intake.peopleRecording === 'number' ? intake.peopleRecording : null,
    extras,
    money,
    paymentLabel,
    refund: refundRows.length
      ? {
          label: refundStatusLabel(refundRows[refundRows.length - 1].status),
          items: refundRows.map((r) => ({ amountCents: r.amount_cents, status: refundStatusLabel(r.status) })),
        }
      : null,
    address: BUSINESS_ADDRESS,
    contactEmail: BUSINESS_EMAIL,
    policies: {
      studioTime: POLICY_COPY.studioTime,
      earlyArrival: POLICY_COPY.earlyArrival,
      changes: POLICY_COPY.changes,
      refund: POLICY_COPY.refund,
      extension: POLICY_COPY.extension,
      setupChange: POLICY_COPY.setupChange,
    },
    deadlineLabel: eligibility.deadline ? formatInstantEt(eligibility.deadline) : null,
    can: { cancel: eligibility.cancel, reschedule: eligibility.reschedule, extend: eligibility.extend && ext.options.length > 0 },
    reasons: { ...eligibility.reasons, ...(eligibility.extend && ext.options.length === 0 ? { extend: ext.reason ?? undefined } : {}) },
    extension: {
      options: ext.options.map((o) => ({
        hours: o.hours,
        newEndTime: o.newEndTime,
        subtotalCents: o.quote.subtotal,
        taxCents: o.quote.taxAmount,
        totalCents: o.quote.total,
        lines: o.quote.lines.map((l) => ({ name: l.kind === 'service' ? `${l.name} (extra hours)` : `${l.name} (per hour)`, quantity: l.quantity, totalCents: l.totalCents })),
      })),
      reason: ext.reason,
    },
    hours: Math.max(1, Math.round(booking.duration_minutes / 60)),
    serviceId: service.id,
    justExtended: false,
  };
}

export async function manageViewForToken(token: unknown): Promise<ManageView> {
  return buildManageView(await requireBooking(token));
}

// ---------------------------------------------------------------------------
// Cancellation with refund
// ---------------------------------------------------------------------------

const CUSTOMER_CANCEL_REASON = 'Cancelled by the customer (Manage Booking)';

export interface CustomerCancelResult {
  cancelled: boolean;
  refunds: { amountCents: number; status: string }[];
  message: string;
}

/** What a cancellation would refund right now (for the confirmation screen). */
export async function cancellationPreview(token: unknown, now = new Date()) {
  const booking = await requireBooking(token);
  if (booking.status !== 'confirmed' || !canChangeBooking(booking.starts_at, now)) {
    throw new CrmError('This booking can no longer be canceled online. Cancellations made within 24 hours are non-refundable.', 409, 'not_eligible');
  }
  let refundCents = 0;
  for (const p of await bookingPurchases(db, booking)) {
    if (!['paid', 'partially_refunded'].includes(p.status)) continue;
    refundCents += (await refundableCents(db, p.id)).available;
  }
  return {
    refundCents,
    date: toDateOnly(booking.booking_date),
    startTime: booking.start_time,
    endTime: booking.end_time,
    deadlineLabel: booking.starts_at ? formatInstantEt(changeDeadline(new Date(booking.starts_at))) : null,
  };
}

/**
 * Cancels a booking at least 24 hours ahead and refunds everything paid for
 * it (the booking's purchase and any paid extension) to the original
 * payment method.
 *
 * Order matters: the cancellation is the business decision, so it happens
 * first — atomically with the 24-hour check — and the refunds follow. A
 * failed refund leaves a cancelled booking flagged for staff, never a
 * refunded booking that still holds the slot. Repeating the request (double
 * click, refresh, timeout, retry) never refunds twice: refundableCents
 * excludes succeeded and in-flight refunds, and every Stripe refund carries
 * its own refund row id as the idempotency key.
 */
export async function cancelByCustomer(token: unknown, now = new Date()): Promise<CustomerCancelResult> {
  const booking = await requireBooking(token);
  const actor = customerActor(booking);
  const service = await serviceOf(booking);

  const resuming = booking.status === 'cancelled' && booking.cancellation_reason === CUSTOMER_CANCEL_REASON;
  if (!resuming) {
    if (booking.status !== 'confirmed') throw new CrmError('This booking can no longer be canceled online.', 409, 'not_eligible');
    if (!canChangeBooking(booking.starts_at, now)) {
      await writeAudit({ actor, operation: 'booking.cancel_by_customer', entityType: 'booking', entityId: booking.id, outcome: 'denied', metadata: { reason: 'inside_24h' } });
      throw new CrmError('Cancellations made within 24 hours of the session are non-refundable and cannot be made online.', 409, 'not_eligible');
    }
    if (booking.payment_status === 'pending') throw new CrmError('Please contact the studio to cancel this booking.', 409, 'not_eligible');

    const result = await cancelBooking(booking.id, actor, {
      reason: CUSTOMER_CANCEL_REASON,
      notifyCustomer: false,
      // The 24-hour rule is re-checked inside the cancellation's own compare-and-set.
      startsNoEarlierThan: new Date(now.getTime() + 24 * 3600 * 1000),
      refundFollows: true,
    });
    if (!result.ok) {
      const fresh = await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) });
      if (!(fresh?.status === 'cancelled' && fresh.cancellation_reason === CUSTOMER_CANCEL_REASON)) {
        throw new CrmError(
          fresh && fresh.status === 'confirmed'
            ? 'Cancellations made within 24 hours of the session are non-refundable and cannot be made online.'
            : 'This booking can no longer be canceled online.',
          409,
          'not_eligible'
        );
      }
      // A concurrent request cancelled it a moment ago: continue with the refunds (idempotent).
    }
  }

  // An unpaid extra-time Checkout must not stay payable for a cancelled booking.
  await releasePendingExtensions(booking.id);

  // Refund everything still refundable on the booking's purchases.
  const fresh = (await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) })) ?? booking;
  const outcomes: { amountCents: number; status: string; id: string }[] = [];
  let failed = false;
  let manualRefundNeeded = false;
  for (const p of await bookingPurchases(db, fresh)) {
    if (!['paid', 'partially_refunded'].includes(p.status)) continue;
    const { available } = await refundableCents(db, p.id);
    if (available <= 0) continue;
    // Cash / terminal / bank payments are refunded by staff, never marked refunded automatically.
    if (p.payment_method !== 'stripe') {
      manualRefundNeeded = true;
      continue;
    }
    try {
      const r = await issueRefund(
        {
          purchaseId: p.id,
          amountCents: available,
          expectedAvailableCents: available,
          reason: 'Customer cancellation at least 24 hours before the session',
          bookingId: fresh.id,
          notifyCustomer: true,
          source: 'customer',
        },
        actor
      );
      outcomes.push({ amountCents: r.refund.amount_cents, status: r.refund.status, id: r.refund.id });
      if (r.refund.status === 'failed') failed = true;
    } catch (error) {
      // A concurrent request is refunding the same purchase right now (stale amount): its refund stands.
      if (!(error instanceof CrmError && error.status === 409)) throw error;
    }
  }

  // Everything refunded so far on this booking (including a concurrent request's refunds).
  const all = await bookingPurchases(db, fresh);
  const refundRows = all.length ? await db.query.refunds.findMany({ where: inArray(refunds.purchase_id, all.map((p) => p.id)) }) : [];
  if (failed || manualRefundNeeded || refundRows.some((r) => r.status === 'failed')) {
    const reason = manualRefundNeeded && !failed ? 'Customer cancelled online — refund the offline payment manually' : 'Customer cancelled online but the refund failed — refund manually';
    await db.update(bookings).set({ needs_refund_review: true, review_reason: reason, updated_at: new Date() }).where(eq(bookings.id, fresh.id));
    for (const p of all) await db.update(purchases).set({ needs_refund_review: true, review_reason: reason, updated_at: new Date() }).where(eq(purchases.id, p.id));
    await sendOwnerPaymentReviewEmail({ booking: fresh, orderNumber: all[0]?.order_number ?? '', amountCents: outcomes.reduce((n, o) => n + o.amountCents, 0), reason, dedupeSuffix: 'customer-cancel' });
  }

  if (!resuming) {
    const refundNote = outcomes.length
      ? `${POLICY_COPY.refund} We will email you about your refund separately.`
      : fresh.source === 'package'
        ? 'The session credit has been returned to your package.'
        : null;
    const sent = await sendCancellationEmail({ booking: fresh, service, refundNote });
    await logIntegration('email', fresh.id, sent.sent ? 'success' : 'failed', sent.sent ? 'Customer cancellation email sent' : `Cancellation email ${sent.status}`);
  }
  await writeAudit({
    actor,
    operation: 'booking.cancel_by_customer',
    entityType: 'booking',
    entityId: fresh.id,
    after: { status: 'cancelled', refunds: outcomes.map((o) => ({ refundId: o.id, amountCents: o.amountCents, status: o.status })) },
    metadata: { resumed: resuming },
  });

  const shown = refundRows.map((r) => ({ amountCents: r.amount_cents, status: refundStatusLabel(r.status) }));
  return {
    cancelled: true,
    refunds: shown,
    message: shown.length ? 'Your booking has been canceled and your refund has been requested.' : 'Your booking has been canceled.',
  };
}

// ---------------------------------------------------------------------------
// Reschedule
// ---------------------------------------------------------------------------

function assertReschedulable(booking: Booking, now: Date) {
  if (booking.status !== 'confirmed') throw new CrmError('This booking can no longer be rescheduled online.', 409, 'not_eligible');
  if (!canChangeBooking(booking.starts_at, now)) throw new CrmError('Sessions cannot be rescheduled within 24 hours of the start time.', 409, 'not_eligible');
}

/** Dates and times the booking could move to (same length; its own slot doesn't count against it). */
export async function rescheduleAvailability(token: unknown, args: { from?: string; to?: string; date?: string }, now = new Date()) {
  const booking = await requireBooking(token);
  assertReschedulable(booking, now);
  const opts = { excludeBookingId: booking.id, now };
  if (args.date) {
    if (!isDateString(args.date)) throw new CrmError('Invalid date');
    const slots = await getAvailableTimeSlotsForDate(args.date, booking.duration_minutes, db, opts);
    return { slots: slots.filter((s) => s.available && !(args.date === toDateOnly(booking.booking_date) && s.start === booking.start_time)) };
  }
  if (!isDateString(args.from) || !isDateString(args.to)) throw new CrmError('Invalid date range');
  return { dates: await getAvailableDates(args.from, args.to, booking.duration_minutes, db, opts) };
}

export async function rescheduleByCustomer(token: unknown, input: { date: unknown; startTime: unknown }, now = new Date()) {
  if (!isDateString(input.date) || !isTimeString(input.startTime)) throw new CrmError('Please choose a date and time.');
  const date = input.date;
  const startTime = input.startTime;
  const booking = await requireBooking(token);
  const actor = customerActor(booking);
  try {
    assertReschedulable(booking, now);
    // Same booking window as the public calendar (the API can't reach past it).
    const { horizonDays } = await getBookingRules();
    if (date > addDays(todayInTz(now), horizonDays)) throw new CrmError(`Please choose a date within the next ${horizonDays} days.`, 400, 'not_eligible');
  } catch (error) {
    await writeAudit({ actor, operation: 'booking.reschedule_by_customer', entityType: 'booking', entityId: booking.id, outcome: 'denied', metadata: { reason: (error as Error).message } });
    throw error;
  }
  try {
    const { booking: updated } = await rescheduleBooking(
      booking.id,
      {
        date,
        startTime,
        notifyCustomer: true,
        respectCutoff: true,
        reason: 'Customer self-service reschedule',
        operation: 'booking.reschedule_by_customer',
        // Same service, length, setup, extras, guests and payment; only the time moves.
        guard: (fresh) => assertReschedulable(fresh, now),
      },
      actor
    );
    return { date: toDateOnly(updated.booking_date), startTime: updated.start_time, endTime: updated.end_time };
  } catch (error) {
    if (error instanceof CrmError && error.status === 409 && error.code !== 'not_eligible') throw new CrmError(SLOT_TAKEN_MESSAGE, 409, 'slot_taken');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Extra time (Stripe Checkout)
// ---------------------------------------------------------------------------

const EXTENSION_CHECKOUT_MINUTES = 31;

/**
 * Starts payment for `hours` more hours right after the booking. The
 * extension range is held (temporary_holds, kind 'extension') for as long as
 * the Checkout session can be paid; the booking itself is not touched until
 * the webhook confirms the payment.
 */
export async function startExtension(token: unknown, hoursInput: unknown, baseUrl: string, now = new Date()): Promise<{ checkoutUrl: string }> {
  const hours = Number(hoursInput);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_SESSION_HOURS) throw new CrmError('Please choose how much time to add.');
  const booking = await requireBooking(token);
  const actor = customerActor(booking);
  const stripe = getStripe();
  if (!stripe) throw new CrmError('Online payment is temporarily unavailable. Please try again shortly.', 503);
  const date = toDateOnly(booking.booking_date);
  let createdSessionId: string | null = null;

  try {
    return await db.transaction(async (tx) => {
      await lockStudioDates(tx, [date]);
      const fresh = await tx.query.bookings.findFirst({ where: eq(bookings.id, booking.id) });
      if (!fresh) throw invalidLink();
      const service = await serviceOf(fresh, tx);

      // One open extension at a time: the same request again returns the same Checkout page.
      const pending = await tx.query.bookingExtensions.findMany({ where: and(eq(bookingExtensions.booking_id, fresh.id), eq(bookingExtensions.status, 'pending')) });
      for (const p of pending) {
        const session = p.stripe_checkout_session_id ? await stripe.checkout.sessions.retrieve(p.stripe_checkout_session_id).catch(() => null) : null;
        // Unknown state (Stripe unreachable): never give up a Checkout that might still be paid.
        if (p.stripe_checkout_session_id && !session) throw new CrmError('Online payment is temporarily unavailable. Please try again shortly.', 503);
        if (session?.status === 'complete') throw new CrmError('Your extra time has been paid and is being confirmed. Refresh in a moment.', 409);
        if (session?.status === 'open' && p.added_minutes === hours * 60 && p.previous_end_time === fresh.end_time && session.url) {
          return { checkoutUrl: session.url };
        }
        if (session?.status === 'open') await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
        await abandonExtension(tx, p, 'cancelled');
      }

      const { options } = await extensionOptions(tx, fresh, service, now);
      const option = options.find((o) => o.hours === hours);
      if (!option) throw new CrmError('That extra time is no longer available.', 409, 'not_available');

      const expiresAt = new Date(now.getTime() + EXTENSION_CHECKOUT_MINUTES * 60000);
      const [hold] = await tx
        .insert(temporaryHolds)
        .values({
          kind: 'extension',
          booking_id: fresh.id,
          customer_email: fresh.customer_email,
          service_id: fresh.service_id,
          booking_date: date,
          start_time: fresh.end_time,
          end_time: option.newEndTime,
          duration_minutes: option.addedMinutes,
          status: 'active',
          hold_expires_at: expiresAt,
        })
        .returning();

      const orderNumber = generateOrderNumber('ZX');
      const purchase = await createPurchase(tx, {
        orderNumber,
        customerId: fresh.customer_id,
        type: 'extension',
        status: 'pending',
        taxCents: option.quote.taxAmount,
        paymentMethod: 'stripe',
        notes: `Extra time for booking ${fresh.booking_id}`,
        items: option.quote.lines.map((l) =>
          l.kind === 'service'
            ? {
                itemType: 'service' as const,
                referenceId: l.referenceId,
                description: `${l.name} — extra time ${date} ${fresh.end_time}–${option.newEndTime} ET`,
                quantity: l.quantity,
                unitPriceCents: l.unitPriceCents,
                metadata: { bookingId: fresh.booking_id, extension: true, addedMinutes: option.addedMinutes, taxRate: option.quote.taxRate },
              }
            : {
                itemType: 'addon' as const,
                referenceId: l.referenceId,
                description: `Add-on: ${l.name} (per hour) — extra time`,
                quantity: l.quantity,
                unitPriceCents: l.unitPriceCents,
                metadata: { bookingId: fresh.booking_id, unit: 'hour', extension: true },
              }
        ),
      });

      const extensionId = crypto.randomUUID();
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: fresh.customer_email,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: { name: `${service.name} — extra time`, description: `${formatDuration(option.addedMinutes)} after your session, until ${option.newEndTime} ET` },
              unit_amount: option.quote.total,
            },
            quantity: 1,
          },
        ],
        // Ids only, never contact details. The token is never sent to Stripe.
        metadata: { kind: 'booking_extension', extensionId, bookingId: fresh.id, holdId: hold.id },
        payment_intent_data: { metadata: { kind: 'booking_extension', extensionId, bookingId: fresh.id } },
        success_url: `${baseUrl}/booking/manage?extension=paid`,
        cancel_url: `${baseUrl}/booking/manage?extension=cancelled`,
        expires_at: Math.floor(expiresAt.getTime() / 1000),
      });
      createdSessionId = session.id;

      await tx.update(purchases).set({ stripe_checkout_session_id: session.id }).where(eq(purchases.id, purchase.id));
      await tx.insert(bookingExtensions).values({
        id: extensionId,
        booking_id: fresh.id,
        purchase_id: purchase.id,
        hold_id: hold.id,
        added_minutes: option.addedMinutes,
        previous_end_time: fresh.end_time,
        new_end_time: option.newEndTime,
        previous_duration_minutes: fresh.duration_minutes,
        new_duration_minutes: fresh.duration_minutes + option.addedMinutes,
        status: 'pending',
        stripe_checkout_session_id: session.id,
      });
      await writeAudit(
        {
          actor,
          operation: 'booking.extension_started',
          entityType: 'booking',
          entityId: fresh.id,
          after: { extensionId, addedMinutes: option.addedMinutes, newEnd: option.newEndTime, totalCents: option.quote.total, orderNumber },
        },
        tx
      );
      if (!session.url) throw new Error('Stripe returned no Checkout URL');
      return { checkoutUrl: session.url };
    });
  } catch (error) {
    if (createdSessionId) await stripe.checkout.sessions.expire(createdSessionId).catch(() => undefined);
    throw error;
  }
}

async function findExtension(exec: Executor, session: Stripe.Checkout.Session): Promise<BookingExtension | undefined> {
  const bySession = await exec.query.bookingExtensions.findFirst({ where: eq(bookingExtensions.stripe_checkout_session_id, session.id) });
  if (bySession) return bySession;
  const id = session.metadata?.extensionId;
  return id ? exec.query.bookingExtensions.findFirst({ where: eq(bookingExtensions.id, id) }) : undefined;
}

/** Webhook: Checkout for extra time expired or the payment failed. Nothing about the booking changes. */
export async function releaseExtensionSession(session: Stripe.Checkout.Session, status: 'cancelled' | 'failed'): Promise<{ status: string; bookingId?: string }> {
  const ext = await findExtension(db, session);
  if (!ext) return { status: 'no_extension' };
  await db.transaction((tx) => abandonExtension(tx, ext, status));
  await logIntegration('stripe', ext.booking_id, 'success', `Extension checkout ${status}; booking unchanged`, { sessionId: session.id });
  return { status: 'extension_released', bookingId: ext.booking_id };
}

/**
 * Webhook: extra time was paid. Applies it in one transaction under the
 * date lock — booking end + duration, purchase paid, hold converted — or,
 * if the time can no longer be given (another booking took it, the booking
 * was cancelled or moved), records the payment and flags it for a refund.
 * Re-delivery of the same event, or a second event for the same session,
 * changes nothing.
 */
export async function confirmExtensionSession(session: Stripe.Checkout.Session): Promise<{ status: string; bookingId?: string }> {
  const ext = await findExtension(db, session);
  if (!ext) throw new Error(`No extension for Checkout session ${session.id}`);
  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;
  const purchase = await db.query.purchases.findFirst({ where: eq(purchases.id, ext.purchase_id) });
  if (!purchase) throw new Error('Extension purchase missing');
  const booking0 = await db.query.bookings.findFirst({ where: eq(bookings.id, ext.booking_id) });
  if (!booking0) throw new Error('Extension booking missing');
  // The date the extra time was bought for (its hold), not wherever the booking is now.
  const hold = ext.hold_id ? await db.query.temporaryHolds.findFirst({ where: eq(temporaryHolds.id, ext.hold_id) }) : null;
  const date = hold ? toDateOnly(hold.booking_date) : toDateOnly(booking0.booking_date);
  const lockDates = Array.from(new Set([date, toDateOnly(booking0.booking_date)]));

  const outcome = await db
    .transaction(async (tx) => {
      await lockStudioDates(tx, lockDates);
      const e = (await tx.query.bookingExtensions.findFirst({ where: eq(bookingExtensions.id, ext.id) }))!;
      if (e.status === 'confirmed' || e.status === 'needs_review') return { kind: 'already' as const };
      const b = (await tx.query.bookings.findFirst({ where: eq(bookings.id, e.booking_id) }))!;
      const now = new Date();

      const paidAmountOk = (session.amount_total ?? -1) === purchase.total_cents && session.currency?.toLowerCase() === 'usd';
      let problem: string | null = null;
      if (!paidAmountOk) problem = `Paid amount ${session.amount_total} ${session.currency} does not match the extension total ${purchase.total_cents} usd`;
      else if (b.status !== 'confirmed') problem = `Extra time paid for a ${b.status} booking — refund`;
      else if (toDateOnly(b.booking_date) !== date || b.end_time !== e.previous_end_time) problem = 'Extra time paid after the booking was moved — refund or apply manually';
      else if (
        await checkTimeSlotConflict(date, e.previous_end_time, e.new_end_time, tx, { excludeBookingId: b.id, excludeHoldId: e.hold_id ?? undefined })
      ) {
        problem = 'Extra time was taken by another booking before this payment arrived — refund';
      }

      await tx
        .update(purchases)
        .set({
          status: 'paid',
          stripe_payment_intent_id: paymentIntent,
          stripe_checkout_session_id: session.id,
          purchased_at: purchase.purchased_at ?? now,
          ...(problem ? { needs_refund_review: true, review_reason: problem } : {}),
          updated_at: now,
        })
        .where(eq(purchases.id, purchase.id));

      if (problem) {
        await tx.update(bookingExtensions).set({ status: 'needs_review', review_reason: problem, stripe_payment_intent_id: paymentIntent, updated_at: now }).where(eq(bookingExtensions.id, e.id));
        if (e.hold_id) await tx.update(temporaryHolds).set({ status: 'cancelled' }).where(eq(temporaryHolds.id, e.hold_id));
        await writeAudit({ actor: { email: 'stripe-webhook' }, operation: 'booking.extension_needs_review', entityType: 'booking', entityId: b.id, metadata: { extensionId: e.id, reason: problem } }, tx);
        return { kind: 'review' as const, booking: b, reason: problem };
      }

      const [updated] = await tx
        .update(bookings)
        .set({ end_time: e.new_end_time, duration_minutes: e.new_duration_minutes, updated_at: now })
        .where(and(eq(bookings.id, b.id), eq(bookings.status, 'confirmed'), eq(bookings.end_time, e.previous_end_time)))
        .returning();
      if (!updated) throw new Error('Booking changed while applying the extension');
      await tx.update(bookingExtensions).set({ status: 'confirmed', confirmed_at: now, stripe_payment_intent_id: paymentIntent, updated_at: now }).where(eq(bookingExtensions.id, e.id));
      if (e.hold_id) await tx.update(temporaryHolds).set({ status: 'converted_to_booking' }).where(eq(temporaryHolds.id, e.hold_id));
      await recomputeRefundState(tx, purchase.id);
      await refreshCustomerStats(tx, updated.customer_id);
      await writeAudit(
        {
          actor: { email: 'stripe-webhook' },
          operation: 'booking.extend',
          entityType: 'booking',
          entityId: updated.id,
          before: { end: e.previous_end_time, durationMinutes: e.previous_duration_minutes },
          after: { end: e.new_end_time, durationMinutes: e.new_duration_minutes, extensionId: e.id, purchaseId: purchase.id, amountCents: purchase.total_cents },
        },
        tx
      );
      return { kind: 'applied' as const, booking: updated };
    })
    .catch(async (error) => {
      if (pgErrorCode(error) !== '23P01') throw error;
      // The overlap constraint caught what the checks above missed.
      const reason = 'Extra time overlaps another booking — refund';
      await db.transaction(async (tx) => {
        const now = new Date();
        await tx
          .update(purchases)
          .set({ status: 'paid', stripe_payment_intent_id: paymentIntent, purchased_at: purchase.purchased_at ?? now, needs_refund_review: true, review_reason: reason, updated_at: now })
          .where(eq(purchases.id, purchase.id));
        await tx.update(bookingExtensions).set({ status: 'needs_review', review_reason: reason, updated_at: now }).where(eq(bookingExtensions.id, ext.id));
        if (ext.hold_id) await tx.update(temporaryHolds).set({ status: 'cancelled' }).where(eq(temporaryHolds.id, ext.hold_id));
      });
      return { kind: 'review' as const, booking: booking0, reason };
    });

  if (outcome.kind === 'already') return { status: 'already_processed', bookingId: ext.booking_id };
  if (outcome.kind === 'review') {
    await logIntegration('stripe', ext.booking_id, 'failed', outcome.reason, { sessionId: session.id });
    await sendOwnerPaymentReviewEmail({ booking: outcome.booking, orderNumber: purchase.order_number, amountCents: purchase.total_cents, reason: outcome.reason, dedupeSuffix: `extension:${ext.id}` });
    return { status: 'extension_needs_review', bookingId: ext.booking_id };
  }

  // After commit: Calendar end, Sheets row, emails. Failures are logged and retryable; nothing here can charge again.
  await logIntegration('stripe', ext.booking_id, 'success', 'Extension paid and applied', { sessionId: session.id, extensionId: ext.id });
  const service = await db.query.services.findFirst({ where: eq(services.id, outcome.booking.service_id) });
  if (service) {
    await resyncGoogleAfterChange(outcome.booking, service).catch((err) => console.error('[extension] Google sync failed:', (err as Error)?.message || err));
    const email = await sendExtensionEmail(ext.id);
    await logIntegration('email', ext.booking_id, email.sent ? 'success' : 'failed', email.sent ? 'Extension email sent' : `Extension email ${email.status}`);
    const guests = await sendGuestScheduleUpdateEmails({ booking: outcome.booking, service, change: 'extended' }).catch(() => []);
    if (guests.length) {
      const sent = guests.filter((g) => g.sent).length;
      await logIntegration('email', ext.booking_id, sent === guests.length ? 'success' : 'failed', `Guest schedule updates sent: ${sent} of ${guests.length}`);
    }
  }
  return { status: 'extension_applied', bookingId: ext.booking_id };
}

