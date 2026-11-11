import { eq } from 'drizzle-orm';
import { db } from './db';
import { bookingExtensions, bookings, customerPackages, customers, emailLogs, packagePlans, purchases, refunds, services } from './db/schema';
import type { Booking, EmailLog, Service } from './db/schema';
import { BUSINESS_ADDRESS, BUSINESS_EMAIL } from './constants';
import { toDateOnly } from './utils';
import { sendLoggedEmail, type EmailOutcome } from './crm/emailLog';
import * as T from './crm/emailTemplates';
import { decimalToCents } from './crm/money';
import { utcToWall } from './crm/time';
import { EDITING_LABELS, guestList, type Intake } from './bookingOptions';
import { setups } from './db/schema';
import { formatDuration } from './catalog';
import { SITE_URL } from './seo';
import { buildSessionIcs } from './ics';
import { purchaseItems } from './db/schema';
import { ManageLinkConfigError, ensureManageToken, manageUrl } from './manageToken';
import { logConfigWarning } from './configWarnings';
import { POLICY_COPY, changeDeadline } from './policies';
import { formatInstantEt } from './crm/time';

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
  package_purchase: 'Monthly package purchased',
  package_credit_used: 'Package session booked',
  owner_payment_review: 'Owner: payment needs review',
  guest_invite: 'Guest invitation',
  guest_schedule_update: 'Guest: schedule update',
  extension: 'Session extended',
  manage_link: 'Manage Booking link (requested)',
} as const;

/**
 * The booking owner's Manage Booking link (created on first use). Only the
 * customer's own emails call this; guests never get it. Never throws.
 */
async function manageLinkFor(booking: Booking): Promise<string | null> {
  try {
    const token = await ensureManageToken(booking.id);
    return token ? manageUrl(token) : null;
  } catch (error) {
    // Never block a confirmation email; staff see the warning in Integrations.
    console.error('[email] manage link unavailable:', (error as Error)?.message || error);
    if (error instanceof ManageLinkConfigError) await logConfigWarning('BOOKING_MANAGE_SECRET is missing; confirmation emails are sent without a Manage Booking link.');
    return null;
  }
}

/** Bumps for every schedule change, so each change gets its own email and calendar update. */
function scheduleVersion(booking: Booking): number {
  const t = booking.updated_at ? new Date(booking.updated_at).getTime() : 0;
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

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
    // The package copy (services.features) is the source: only packages that promise an edited episode mention its delivery time.
    includesEditing: Array.isArray(service.features) && service.features.includes(POLICY_COPY.editedDelivery),
  };
}

interface BookingEmailData {
  booking: Booking;
  service: Service;
}

/** Customer confirmation (the tour variant for studio tours). */
export async function sendBookingConfirmationEmail({ booking, service }: BookingEmailData): Promise<EmailOutcome> {
  const template = service.category === 'tour' ? 'tour_confirmation' : 'booking_confirmation';
  const summary = await summaryData(booking, 'customer');
  const link = await manageLinkFor(booking);
  if (link) {
    summary.cta = { label: T.MANAGE_CTA_LABEL, url: link };
    summary.ctaNote = T.MANAGE_CTA_NOTE;
  }
  return sendLoggedEmail({
    template,
    recipientType: 'customer',
    to: booking.customer_email,
    dedupeKey: `${template}:${booking.id}`,
    refs: { bookingId: booking.id, purchaseId: booking.purchase_id },
    render: () => T.bookingConfirmation({ ...bookingData(booking, service), summary }),
  });
}

/**
 * Everything the booking summary emails show beyond the basics: order
 * number, setup (and its photo), extras, answers and guests. Never throws —
 * an email with fewer details is better than no email.
 */
async function summaryData(booking: Booking, audience: 'customer' | 'owner'): Promise<T.BookingSummaryData> {
  const intake = (booking.intake ?? {}) as Intake;
  const data: T.BookingSummaryData = {
    durationLabel: formatDuration(booking.duration_minutes),
    people: typeof intake.peopleRecording === 'number' ? intake.peopleRecording : null,
    guests: guestList(intake),
    extras: [],
    answers: [],
    headerImage: `${SITE_URL}/email/sofa-lounge.jpg`,
    setupName: intake.setupName ?? null,
  };
  if (typeof intake.peopleOnCamera === 'number') data.answers!.push(['How many people will be on camera?', String(intake.peopleOnCamera)]);
  if (intake.recordingType) data.answers!.push(['What are you recording?', intake.recordingType]);
  if (intake.editing) data.answers!.push(['Do you need editing services?', EDITING_LABELS[intake.editing] ?? intake.editing]);
  if (intake.project) data.answers!.push(['Tell us about your project', intake.project]);
  data.cta =
    audience === 'owner'
      ? { label: 'Open in CRM', url: `${SITE_URL}/admin/sessions/${booking.id}` }
      : { label: 'Get directions', url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(BUSINESS_ADDRESS)}` };
  try {
    const [purchase, items, setup] = await Promise.all([
      booking.purchase_id ? db.query.purchases.findFirst({ where: eq(purchases.id, booking.purchase_id) }) : null,
      booking.purchase_id ? db.query.purchaseItems.findMany({ where: eq(purchaseItems.purchase_id, booking.purchase_id) }) : [],
      booking.setup_id ? db.query.setups.findFirst({ where: eq(setups.id, booking.setup_id) }) : null,
    ]);
    data.orderNumber = purchase?.order_number ?? null;
    if (purchase) {
      data.subtotalCents = purchase.subtotal_cents;
      data.taxCents = purchase.tax_cents;
    }
    if (booking.starts_at) data.changeDeadlineLabel = formatInstantEt(changeDeadline(new Date(booking.starts_at)));
    data.extras = items.filter((i) => i.item_type === 'addon').map((i) => `${i.description_snapshot.replace(/^Add-on: /, '')}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`);
    if (setup) {
      data.setupName = setup.name;
      // Email clients need JPEG; public/email/<slug>.jpg mirrors public/setups/<slug>.webp.
      if (EMAIL_HEADER_SLUGS.includes(setup.slug)) data.headerImage = `${SITE_URL}/email/${setup.slug}.jpg`;
    }
  } catch (error) {
    console.error('[email] booking summary details unavailable:', (error as Error)?.message || error);
  }
  return data;
}

// Retired setups stay listed: older bookings still use them.
const EMAIL_HEADER_SLUGS = ['sofa-lounge', 'conversation-corner', 'conference-table', 'bookshelf', 'cream-lounge', 'garden-lounge', 'library-table'];

export async function sendOwnerNotificationEmail({ booking, service }: BookingEmailData): Promise<EmailOutcome> {
  const summary = await summaryData(booking, 'owner');
  return sendLoggedEmail({
    template: 'owner_new_booking',
    recipientType: 'owner',
    to: process.env.OWNER_EMAIL,
    dedupeKey: `owner_new_booking:${booking.id}`,
    refs: { bookingId: booking.id, purchaseId: booking.purchase_id },
    replyTo: booking.customer_email,
    render: () => T.ownerNewBooking({ ...bookingData(booking, service), source: booking.source, summary }),
  });
}

/**
 * One email per guest the customer added, with a calendar file. Sent once
 * per guest per booking (dedupe key); never to the customer themselves.
 */
export async function sendGuestInviteEmails({ booking, service }: BookingEmailData): Promise<EmailOutcome[]> {
  const guests = ((booking.intake ?? {}) as Intake).guests;
  if (!Array.isArray(guests) || guests.length === 0) return [];
  const date = toDateOnly(booking.booking_date);
  const hostName = `${booking.customer_first_name} ${booking.customer_last_name}`.trim();
  const isTour = service.category === 'tour';
  const ics = buildSessionIcs({
    uid: booking.booking_id,
    title: `${service.name} at ZAYRO Studios`,
    description: `Hosted by ${hostName}. Booking ${booking.booking_id}.`,
    location: BUSINESS_ADDRESS,
    date,
    startTime: booking.start_time,
    endTime: booking.end_time,
  });
  return Promise.all(
    guests.slice(0, 8).map((guest) =>
      sendLoggedEmail({
        template: 'guest_invite',
        recipientType: 'guest',
        to: guest,
        dedupeKey: `guest_invite:${booking.id}:${guest}`,
        refs: { bookingId: booking.id },
        attachments: [{ filename: 'zayro-studios-session.ics', content: ics, contentType: 'text/calendar' }],
        render: () =>
          T.guestInvite({ hostName, serviceName: service.name, date, startTime: booking.start_time, endTime: booking.end_time, address: BUSINESS_ADDRESS, contactEmail: contactEmail(), isTour }),
      })
    )
  );
}

export async function sendRescheduleEmail({
  booking,
  service,
  previous,
}: BookingEmailData & { previous: { date: string; startTime: string } }): Promise<EmailOutcome> {
  const link = await manageLinkFor(booking);
  const setupName = ((booking.intake ?? {}) as Intake).setupName ?? null;
  return sendLoggedEmail({
    template: 'reschedule',
    recipientType: 'customer',
    to: booking.customer_email,
    // One email per change (moving A → B → A sends two).
    dedupeKey: `reschedule:${booking.id}:${toDateOnly(booking.booking_date)}T${booking.start_time}:v${scheduleVersion(booking)}`,
    refs: { bookingId: booking.id },
    context: { previousDate: previous.date, previousStart: previous.startTime },
    render: () =>
      T.rescheduleConfirmation({ ...bookingData(booking, service), previousDate: previous.date, previousStart: previous.startTime, manageUrl: link, setupName }),
  });
}

/** Guests' copy of a schedule change, with an updated calendar file (same UID, higher SEQUENCE). */
export async function sendGuestScheduleUpdateEmails({
  booking,
  service,
  change,
}: BookingEmailData & { change: 'rescheduled' | 'extended' }): Promise<EmailOutcome[]> {
  const guests = ((booking.intake ?? {}) as Intake).guests;
  if (!Array.isArray(guests) || guests.length === 0) return [];
  const date = toDateOnly(booking.booking_date);
  const hostName = `${booking.customer_first_name} ${booking.customer_last_name}`.trim();
  const version = scheduleVersion(booking);
  const ics = buildSessionIcs({
    uid: booking.booking_id,
    title: `${service.name} at ZAYRO Studios`,
    description: `Hosted by ${hostName}. Booking ${booking.booking_id}.`,
    location: BUSINESS_ADDRESS,
    date,
    startTime: booking.start_time,
    endTime: booking.end_time,
    sequence: version,
  });
  return Promise.all(
    guests.slice(0, 8).map((guest) =>
      sendLoggedEmail({
        template: 'guest_schedule_update',
        recipientType: 'guest',
        to: guest,
        dedupeKey: `guest_update:${booking.id}:${guest}:v${version}`,
        refs: { bookingId: booking.id },
        context: { change },
        attachments: [{ filename: 'zayro-studios-session.ics', content: ics, contentType: 'text/calendar' }],
        render: () =>
          T.guestScheduleUpdate({ hostName, serviceName: service.name, date, startTime: booking.start_time, endTime: booking.end_time, address: BUSINESS_ADDRESS, contactEmail: contactEmail(), change }),
      })
    )
  );
}

/**
 * A Manage Booking link the customer requested. Goes only to the email
 * stored on the booking; `dedupeKey` (one per cooldown window) keeps
 * repeated requests from sending more than one email, and a failed send
 * can be retried from Integrations with the booking's current link.
 */
export async function sendManageLinkEmail(booking: Booking, dedupeKey: string): Promise<EmailOutcome> {
  const service = await db.query.services.findFirst({ where: eq(services.id, booking.service_id) });
  const link = await manageLinkFor(booking);
  if (!service || !link) return { sent: false, status: 'failed', error: 'Manage link unavailable' };
  return sendLoggedEmail({
    template: 'manage_link',
    recipientType: 'customer',
    to: booking.customer_email,
    dedupeKey,
    refs: { bookingId: booking.id },
    render: () =>
      T.manageLinkEmail({
        firstName: booking.customer_first_name || 'there',
        bookingId: booking.booking_id,
        serviceName: service.name,
        date: toDateOnly(booking.booking_date),
        startTime: booking.start_time,
        endTime: booking.end_time,
        manageUrl: link,
        contactEmail: contactEmail(),
      }),
  });
}

/** Customer email after a paid extension is applied. One per extension. */
export async function sendExtensionEmail(extensionId: string): Promise<EmailOutcome> {
  const ext = await db.query.bookingExtensions.findFirst({ where: eq(bookingExtensions.id, extensionId) });
  if (!ext) return { sent: false, status: 'failed', error: 'Extension not found' };
  const [booking, purchase] = await Promise.all([
    db.query.bookings.findFirst({ where: eq(bookings.id, ext.booking_id) }),
    db.query.purchases.findFirst({ where: eq(purchases.id, ext.purchase_id) }),
  ]);
  const service = booking ? await db.query.services.findFirst({ where: eq(services.id, booking.service_id) }) : null;
  if (!booking || !purchase || !service) return { sent: false, status: 'failed', error: 'Extension data missing' };
  const link = await manageLinkFor(booking);
  return sendLoggedEmail({
    template: 'extension',
    recipientType: 'customer',
    to: booking.customer_email,
    dedupeKey: `extension:${ext.id}`,
    refs: { bookingId: booking.id, purchaseId: purchase.id },
    render: () =>
      T.extensionConfirmation({
        ...bookingData(booking, service),
        previousEnd: ext.previous_end_time,
        addedLabel: formatDuration(ext.added_minutes),
        amountCents: purchase.total_cents,
        taxCents: purchase.tax_cents,
        orderNumber: purchase.order_number,
        manageUrl: link,
      }),
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
  // One email per refund state the customer should hear about. A refund
  // that is still processing is "requested", never "issued".
  const status: T.RefundEmailStatus =
    refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' || refund.status === 'canceled' ? 'failed' : 'pending';
  return sendLoggedEmail({
    template: 'refund',
    recipientType: 'customer',
    to: customer?.email ?? booking?.customer_email,
    dedupeKey: `refund:${refund.id}:${status}`,
    context: { status },
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
        status,
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
  /** Distinguishes a second review for the same booking (e.g. a paid extension). */
  dedupeSuffix?: string;
}): Promise<EmailOutcome> {
  return sendLoggedEmail({
    template: 'owner_payment_review',
    recipientType: 'owner',
    to: process.env.OWNER_EMAIL,
    dedupeKey: `owner_payment_review:${args.booking.id}${args.dedupeSuffix ? `:${args.dedupeSuffix}` : ''}`,
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
      const link = await manageLinkFor(data.booking);
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
            manageUrl: link,
          }),
      });
    }
    case 'cancellation': {
      const data = await loadBooking();
      return data ? sendCancellationEmail({ ...data, refundNote: ctx.refundNote ?? null }) : { sent: false, status: 'failed', error: 'Booking not found' };
    }
    case 'refund':
      return log.refund_id ? sendRefundEmail(log.refund_id) : { sent: false, status: 'failed', error: 'Refund missing' };
    case 'manage_link': {
      const data = await loadBooking();
      return data ? sendManageLinkEmail(data.booking, log.dedupe_key) : { sent: false, status: 'failed', error: 'Booking not found' };
    }
    case 'extension': {
      const ext = log.purchase_id ? await db.query.bookingExtensions.findFirst({ where: eq(bookingExtensions.purchase_id, log.purchase_id) }) : null;
      return ext ? sendExtensionEmail(ext.id) : { sent: false, status: 'failed', error: 'Extension missing' };
    }
    case 'guest_schedule_update': {
      const data = await loadBooking();
      if (!data) return { sent: false, status: 'failed', error: 'Booking not found' };
      const all = await sendGuestScheduleUpdateEmails({ ...data, change: ctx.change === 'extended' ? 'extended' : 'rescheduled' });
      return all.find((o) => o.logId === logId) ?? { sent: false, status: 'failed', error: 'This update was superseded by a later change' };
    }
    case 'package_purchase':
      return log.purchase_id ? (await import('@/lib/publicPackages')).sendPackagePurchaseEmail(log.purchase_id) : { sent: false, status: 'failed', error: 'Purchase missing' };
    case 'package_assigned':
      return log.customer_package_id ? sendPackageAssignedEmail(log.customer_package_id) : { sent: false, status: 'failed', error: 'Package missing' };
    case 'package_credit_used':
      return log.booking_id ? sendPackageCreditUsedEmail(log.booking_id) : { sent: false, status: 'failed', error: 'Booking missing' };
    case 'guest_invite': {
      const data = await loadBooking();
      if (!data) return { sent: false, status: 'failed', error: 'Booking not found' };
      const all = await sendGuestInviteEmails(data);
      return all.find((o) => o.logId === logId) ?? { sent: false, status: 'failed', error: 'Guest is no longer on this booking' };
    }
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
