/**
 * Studio policies: the one place the cancellation, rescheduling, studio-time
 * and refund rules live. The FAQ, Terms, booking flow, emails, the Manage
 * Booking page and the server-side checks all read from here, so the site
 * can never show two versions of a policy.
 *
 * Pure — safe for client components and unit tests. Every eligibility
 * decision that matters is re-made on the server from the booking's own
 * `starts_at`; the browser's clock is only used for display.
 */

/** Bump when the wording customers agree to changes in substance. Stored with each booking. */
export const POLICY_VERSION = '2026-11-11';

/** Hours before the start that cancellation (with refund) and self-service rescheduling close. */
export const CHANGE_WINDOW_HOURS = 24;

/** How early a customer may arrive (personal preparation only). */
export const EARLY_ARRIVAL_MINUTES = 10;

/** Typical time a setup change takes during a session (counts toward the booking). */
export const SETUP_CHANGE_MINUTES = { min: 10, max: 20 } as const;

export const POLICY_COPY = {
  /** The short version shown before payment and on Manage Booking. */
  concise:
    'Cancel or reschedule at least 24 hours before your session. Cancellations made within 24 hours are non-refundable. Your reserved time includes preparation, setup changes and recording.',
  changes:
    'Cancel or reschedule at least 24 hours before your scheduled session. Cancellations made within 24 hours are non-refundable and cannot be rescheduled.',
  cancellation:
    'Cancel at least 24 hours before your scheduled session to receive a full refund. Cancellations made within 24 hours are non-refundable.',
  refund:
    'Eligible refunds are returned to the original payment method. Your bank or card provider may need additional time to display the refund.',
  noShow: 'No-shows are non-refundable.',
  studioTime:
    'Your reserved time includes preparation, setup changes and recording. Arrive ready to begin so you can make the most of your session.',
  earlyArrival:
    'You may arrive up to 10 minutes early for basic personal preparation. Studio access and recording begin at your scheduled time.',
  setupChange:
    'Choose your preferred setup before your session so we can have it ready when you arrive. Setup changes during the session typically take 10–20 minutes and count toward your booked time.',
  extension:
    'Need more time? You may extend your session when the schedule allows. Additional time is subject to availability and payment.',
  lateArrival:
    'Your booking ends at the scheduled time. Additional time may be purchased only when availability allows.',
  acknowledgment: 'I agree to the cancellation, rescheduling and studio-time policies.',
  /** Full Podcast Package post-production turnaround (owner decision 2026-11-11: business days). */
  editedDelivery: 'Your edited episode will be delivered within 3 business days.',
} as const;

export interface PolicyItem {
  id: string;
  question: string;
  answer: string;
}

/**
 * Policy questions shared by the FAQ (visible text and FAQPage JSON-LD)
 * and the Terms page.
 */
export const POLICY_FAQ: PolicyItem[] = [
  { id: 'studio-time', question: 'What is included in my studio time?', answer: 'Your reserved time includes preparation, setup adjustments and recording. Arrive ready to begin so you can make the most of your session.' },
  { id: 'early-arrival', question: 'Can I arrive early?', answer: POLICY_COPY.earlyArrival },
  { id: 'raw-files', question: 'When will I receive my raw files?', answer: 'Raw camera files and separate audio tracks are delivered through Google Drive within 24 hours.' },
  {
    id: 'ssd',
    question: 'Can I bring an SSD?',
    answer:
      'Yes. You may bring a compatible hard drive or SSD. On-site transfer depends on file readiness, available transfer time, compatibility and free space.',
  },
  {
    id: 'setup-change',
    question: 'Can I change my setup?',
    answer:
      'Yes. Choose your preferred setup before your session so it is ready when you arrive. Setup changes during the session typically take 10–20 minutes and count toward your booked time.',
  },
  {
    id: 'cancel',
    question: 'Can I cancel my booking?',
    answer:
      'You may cancel at least 24 hours before your session for a full refund to the original payment method. Cancellations within 24 hours are non-refundable.',
  },
  { id: 'reschedule', question: 'Can I reschedule?', answer: 'You may reschedule at least 24 hours before your session using your secure Manage Booking link.' },
  {
    id: 'add-time',
    question: 'Can I add more time?',
    answer: 'Yes, when the time immediately after your session is available. Additional time must be purchased and is not guaranteed.',
  },
  {
    id: 'cameras',
    question: 'How many cameras can I use?',
    answer:
      'Up to 3 cameras per session. Single Podcaster includes 1 camera and you can add up to 2 more; Podcast Pro and the Full Podcast Package already include up to 3 cameras.',
  },
  { id: 'late-arrival', question: 'Does late arrival extend my session?', answer: 'No. Your booking ends at the scheduled time. Additional time may be purchased only when availability allows.' },
  {
    id: 'editing',
    question: 'Is editing included?',
    answer:
      'Editing is included with the Full Podcast Package. It is not included with Single Podcaster or Podcast Pro, but it may be added separately. Your edited episode will be delivered within 3 business days.',
  },
];

// ---------------------------------------------------------------------------
// Eligibility (pure; the server passes its own clock)
// ---------------------------------------------------------------------------

/** The last instant a booking starting at `startsAt` can still be cancelled or rescheduled. */
export function changeDeadline(startsAt: Date): Date {
  return new Date(startsAt.getTime() - CHANGE_WINDOW_HOURS * 3600 * 1000);
}

/**
 * True while at least 24 hours remain before the start. Works on UTC
 * instants, so a DST change inside the window doesn't shift the deadline:
 * "24 hours" means 24 real hours.
 */
export function canChangeBooking(startsAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!startsAt) return false;
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (Number.isNaN(start.getTime())) return false;
  return now.getTime() <= changeDeadline(start).getTime();
}

export type BookingStateForPolicy = {
  status: string;
  payment_status: string;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
};

export interface Eligibility {
  cancel: boolean;
  reschedule: boolean;
  extend: boolean;
  /** Why an action is unavailable (customer-facing). */
  reasons: { cancel?: string; reschedule?: string; extend?: string };
  deadline: Date | null;
}

/** What a customer may do with a booking right now. Extension also needs free time (checked separately). */
export function bookingEligibility(b: BookingStateForPolicy, opts: { hourly: boolean }, now: Date = new Date()): Eligibility {
  const start = b.starts_at ? new Date(b.starts_at) : null;
  const end = b.ends_at ? new Date(b.ends_at) : null;
  const deadline = start ? changeDeadline(start) : null;
  const reasons: Eligibility['reasons'] = {};
  const confirmed = b.status === 'confirmed';
  const inWindow = canChangeBooking(start, now);

  let cancel = confirmed && inWindow;
  const reschedule = confirmed && inWindow;
  if (!confirmed) {
    const msg = b.status === 'cancelled' ? 'This booking has been canceled.' : 'This booking can no longer be changed online.';
    reasons.cancel = msg;
    reasons.reschedule = msg;
  } else if (!inWindow) {
    reasons.cancel = 'Cancellations made within 24 hours of the session are non-refundable and cannot be made online.';
    reasons.reschedule = 'Sessions cannot be rescheduled within 24 hours of the start time.';
  }
  if (confirmed && b.payment_status === 'pending') {
    // An unpaid (pay-at-studio) booking has nothing to refund; staff handle it.
    cancel = false;
    reasons.cancel = 'Please contact the studio to cancel this booking.';
  }

  const extend = confirmed && opts.hourly && !!end && now.getTime() < end.getTime();
  if (!extend) {
    reasons.extend = !confirmed
      ? 'Only confirmed bookings can be extended.'
      : !opts.hourly
        ? 'This service has a fixed length.'
        : 'This session has already ended.';
  }
  return { cancel, reschedule, extend, reasons, deadline };
}
