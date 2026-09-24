import { eq } from 'drizzle-orm';
import { db } from './db';
import { bookings, customerPackages, customers, emailLogs, packagePlans, purchases, refunds, services } from './db/schema';
import type { Booking, EmailLog, Service } from './db/schema';
import { BUSINESS_ADDRESS, BUSINESS_EMAIL } from './constants';
import { toDateOnly } from './utils';
import { sendLoggedEmail, type EmailOutcome } from './crm/emailLog';
import * as T from './crm/emailTemplates';
import { decimalToCents } from './crm/money';
import { utcToWall } from './crm/time';

/**
 * High-level transactional emails. Each one has a stable dedupe key, so it
 * is sent at most once however many times the calling flow (or a retry)
 * runs. None of these throw.
 */

export type { EmailOutcome };

export const EMAIL_TEMPLATES = {
  booking_confirmation: 'Booking confirmation',
  tour_confirmation: 'Studio tour confirmation',
  owner_new_booking: 'Owner: new booking',
  reschedule: 'Reschedule confirmation',
  cancellation: 'Cancellation',
  refund: 'Refund',
  package_assigned: 'Package assigned',
  package_credit_used: 'Package session booked',
  owner_payment_review: 'Owner: payment needs review',
} as const;

function contactEmail() {
  return BUSINESS_EMAIL;
}

function bookingData(booking: Booking, service: Service): T.BookingEmailData {
  return {
    bookingId: booking.booking_id,
    firstName: booking.customer_first_name,
    lastName: booking.customer_last_name,
    email: booking.customer_email,
    phone: booking.customer_phone,
    company: booking.company_name,
    serviceName: service.name,
    date: toDateOnly(booking.booking_date),
    startTime: booking.start_time,
    endTime: booking.end_time,
    totalCents: decimalToCents(booking.total_amount),
    isTour: service.category === 'tour',
    notes: booking.notes,
    address: BUSINESS_ADDRESS,
    contactEmail: contactEmail(),
  };
}

interface BookingEmailData {
  booking: Booking;
  service: Service;
}

/** Customer confirmation (the tour variant for studio tours). */
export async function sendBookingConfirmationEmail({ booking, service }: BookingEmailData): Promise<EmailOutcome> {
  const template = service.category === 'tour' ? 'tour_confirmation' : 'booking_confirmation';
  return sendLoggedEmail({
    template,
    recipientType: 'customer',
    to: booking.customer_email,
    dedupeKey: `${template}:${booking.id}`,
    refs: { bookingId: booking.id, purchaseId: booking.purchase_id },
    render: () => T.bookingConfirmation(bookingData(booking, service)),
  });
}

export async function sendOwnerNotificationEmail({ booking, service }: BookingEmailData): Promise<EmailOutcome> {
  return sendLoggedEmail({
    template: 'owner_new_booking',
    recipientType: 'owner',
    to: process.env.OWNER_EMAIL,
    dedupeKey: `owner_new_booking:${booking.id}`,
    refs: { bookingId: booking.id, purchaseId: booking.purchase_id },
    replyTo: booking.customer_email,
    render: () => T.ownerNewBooking({ ...bookingData(booking, service), source: booking.source }),
  });
}

export async function sendRescheduleEmail({
  booking,
  service,
  previous,
}: BookingEmailData & { previous: { date: string; startTime: string } }): Promise<EmailOutcome> {
  return sendLoggedEmail({
    template: 'reschedule',
    recipientType: 'customer',
    to: booking.customer_email,
    // One email per new time.
    dedupeKey: `reschedule:${booking.id}:${toDateOnly(booking.booking_date)}T${booking.start_time}`,
    refs: { bookingId: booking.id },
    context: { previousDate: previous.date, previousStart: previous.startTime },
    render: () =>
      T.rescheduleConfirmation({ ...bookingData(booking, service), previousDate: previous.date, previousStart: previous.startTime }),
  });
}

export async function sendCancellationEmail({
  booking,
  service,
  refundNote,
}: BookingEmailData & { refundNote?: string | null }): Promise<EmailOutcome> {
  return sendLoggedEmail({
    template: 'cancellation',
    recipientType: 'customer',
    to: booking.customer_email,
    dedupeKey: `cancellation:${booking.id}`,
    refs: { bookingId: booking.id },
    context: { refundNote: refundNote ?? null },
    render: () => T.cancellationNotice({ ...bookingData(booking, service), refundNote }),
  });
}

export async function sendRefundEmail(refundId: string): Promise<EmailOutcome> {
  const refund = await db.query.refunds.findFirst({ where: eq(refunds.id, refundId) });
  if (!refund) return { sent: false, status: 'failed', error: 'Refund not found' };
  const purchase = await db.query.purchases.findFirst({ where: eq(purchases.id, refund.purchase_id) });
  if (!purchase) return { sent: false, status: 'failed', error: 'Purchase not found' };
  const customer = purchase.customer_id ? await db.query.customers.findFirst({ where: eq(customers.id, purchase.customer_id) }) : null;
  const booking = refund.booking_id ? await db.query.bookings.findFirst({ where: eq(bookings.id, refund.booking_id) }) : null;
  return sendLoggedEmail({
    template: 'refund',
    recipientType: 'customer',
    to: customer?.email ?? booking?.customer_email,
    dedupeKey: `refund:${refund.id}`,
    refs: { refundId: refund.id, purchaseId: purchase.id, bookingId: refund.booking_id },
    render: () =>
      T.refundNotice({
        firstName: customer?.first_name || booking?.customer_first_name || 'there',
        orderNumber: purchase.order_number,
        bookingId: booking?.booking_id,
        amountCents: refund.amount_cents,
        totalRefundedCents: purchase.refunded_cents,
        originalCents: purchase.total_cents,
        contactEmail: contactEmail(),
      }),
  });
}

async function packageContext(customerPackageId: string) {
  const pkg = await db.query.customerPackages.findFirst({ where: eq(customerPackages.id, customerPackageId) });
  if (!pkg) return null;
  const [customer, plan] = await Promise.all([
    db.query.customers.findFirst({ where: eq(customers.id, pkg.customer_id) }),
    db.query.packagePlans.findFirst({ where: eq(packagePlans.id, pkg.package_plan_id) }),
  ]);
  const snapshot = pkg.plan_snapshot as { name?: string; eligible?: string };
  return {
    pkg,
    customer,
    planName: snapshot.name || plan?.name || 'package',
    eligible: snapshot.eligible || 'Eligible studio sessions',
    expiresOn: utcToWall(pkg.expires_at).date,
  };
}

export async function sendPackageAssignedEmail(customerPackageId: string): Promise<EmailOutcome> {
  const ctx = await packageContext(customerPackageId);
  if (!ctx) return { sent: false, status: 'failed', error: 'Package not found' };
  return sendLoggedEmail({
    template: 'package_assigned',
    recipientType: 'customer',
    to: ctx.customer?.email,
    dedupeKey: `package_assigned:${customerPackageId}`,
    refs: { customerPackageId, purchaseId: ctx.pkg.purchase_id },
    render: () =>
      T.packageAssigned({
        firstName: ctx.customer?.first_name || 'there',
        planName: ctx.planName,
        credits: ctx.pkg.total_credits,
        expiresOn: ctx.expiresOn,
        eligible: ctx.eligible,
        contactEmail: contactEmail(),
      }),
  });
}

export async function sendPackageCreditUsedEmail(bookingUuid: string): Promise<EmailOutcome> {
  const booking = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingUuid) });
  if (!booking?.customer_package_id) return { sent: false, status: 'failed', error: 'Booking has no package' };
  const [service, ctx] = await Promise.all([
    db.query.services.findFirst({ where: eq(services.id, booking.service_id) }),
    packageContext(booking.customer_package_id),
  ]);
  if (!service || !ctx) return { sent: false, status: 'failed', error: 'Booking data missing' };
  return sendLoggedEmail({
    template: 'package_credit_used',
    recipientType: 'customer',
    to: booking.customer_email,
    dedupeKey: `package_credit_used:${booking.id}`,
    refs: { bookingId: booking.id, customerPackageId: ctx.pkg.id },
    render: () =>
      T.packageCreditUsed({
        ...bookingData(booking, service),
        planName: ctx.planName,
        remaining: ctx.pkg.remaining_credits,
        expiresOn: ctx.expiresOn,
      }),
  });
}

export async function sendOwnerPaymentReviewEmail(args: {
  booking: Booking;
  orderNumber: string;
  amountCents: number;
  reason: string;
}): Promise<EmailOutcome> {
  return sendLoggedEmail({
    template: 'owner_payment_review',
    recipientType: 'owner',
    to: process.env.OWNER_EMAIL,
    dedupeKey: `owner_payment_review:${args.booking.id}`,
    refs: { bookingId: args.booking.id, purchaseId: args.booking.purchase_id },
    context: { reason: args.reason, amountCents: args.amountCents, orderNumber: args.orderNumber },
    render: () =>
      T.ownerPaymentReview({ bookingId: args.booking.booking_id, orderNumber: args.orderNumber, amountCents: args.amountCents, reason: args.reason }),
  });
}

/**
 * Re-sends a failed/skipped email from its log row, re-rendered from the
 * current data. A sent email is never re-sent (the dedupe key guarantees
 * it). Email only — never touches Calendar or Sheets.
 */
export async function retryEmail(logId: string): Promise<EmailOutcome> {
  const log: EmailLog | undefined = await db.query.emailLogs.findFirst({ where: eq(emailLogs.id, logId) });
  if (!log) return { sent: false, status: 'failed', error: 'Email log not found' };
  if (log.status === 'sent') return { sent: true, status: 'duplicate', logId };

  const loadBooking = async () => {
    const booking = log.booking_id ? await db.query.bookings.findFirst({ where: eq(bookings.id, log.booking_id) }) : null;
    const service = booking ? await db.query.services.findFirst({ where: eq(services.id, booking.service_id) }) : null;
    return booking && service ? { booking, service } : null;
  };
  const ctx = log.context as Record<string, any>;

  switch (log.template) {
    case 'booking_confirmation':
    case 'tour_confirmation': {
      const data = await loadBooking();
      return data ? sendBookingConfirmationEmail(data) : { sent: false, status: 'failed', error: 'Booking not found' };
    }
    case 'owner_new_booking': {
      const data = await loadBooking();
      return data ? sendOwnerNotificationEmail(data) : { sent: false, status: 'failed', error: 'Booking not found' };
    }
    case 'reschedule': {
      const data = await loadBooking();
      if (!data) return { sent: false, status: 'failed', error: 'Booking not found' };
      // Re-send the log's own email (its dedupe key), even if the booking moved again since.
      return sendLoggedEmail({
        template: 'reschedule',
        recipientType: 'customer',
        to: data.booking.customer_email,
        dedupeKey: log.dedupe_key,
        refs: { bookingId: data.booking.id },
        context: ctx,
        render: () =>
          T.rescheduleConfirmation({
            ...bookingData(data.booking, data.service),
            previousDate: String(ctx.previousDate ?? ''),
            previousStart: String(ctx.previousStart ?? ''),
          }),
      });
    }
    case 'cancellation': {
      const data = await loadBooking();
      return data ? sendCancellationEmail({ ...data, refundNote: ctx.refundNote ?? null }) : { sent: false, status: 'failed', error: 'Booking not found' };
    }
    case 'refund':
      return log.refund_id ? sendRefundEmail(log.refund_id) : { sent: false, status: 'failed', error: 'Refund missing' };
    case 'package_assigned':
      return log.customer_package_id ? sendPackageAssignedEmail(log.customer_package_id) : { sent: false, status: 'failed', error: 'Package missing' };
    case 'package_credit_used':
      return log.booking_id ? sendPackageCreditUsedEmail(log.booking_id) : { sent: false, status: 'failed', error: 'Booking missing' };
    case 'owner_payment_review': {
      const data = await loadBooking();
      return data
        ? sendOwnerPaymentReviewEmail({
            booking: data.booking,
            orderNumber: String(ctx.orderNumber ?? ''),
            amountCents: Number(ctx.amountCents ?? 0),
            reason: String(ctx.reason ?? ''),
          })
        : { sent: false, status: 'failed', error: 'Booking not found' };
    }
    default:
      return { sent: false, status: 'failed', error: `Unknown template ${log.template}` };
  }
}
