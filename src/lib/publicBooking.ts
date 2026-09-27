import type { Booking, Service } from './db/schema';
import { toDateOnly } from './utils';

/**
 * What the public success page may show about a booking. Anyone holding a
 * booking ID or Checkout session ID can ask for it, so it carries no phone
 * number, no full email and no notes — just enough for the customer to
 * recognise their booking.
 */
export interface PublicBookingSummary {
  bookingId: string;
  status: string;
  service: { name: string; category: string };
  bookingDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  totalAmount: string;
  isFree: boolean;
  firstName: string;
  emailHint: string;
}

/** "ada@example.com" → "a***@example.com" */
export function maskEmail(email: string): string {
  const [local, domain] = email.trim().split('@');
  if (!local || !domain) return '';
  return `${local.slice(0, 1)}***@${domain}`;
}

export function publicBookingSummary(booking: Booking, service: Pick<Service, 'name' | 'category'>): PublicBookingSummary {
  const total = Number(booking.total_amount);
  return {
    bookingId: booking.booking_id,
    status: booking.status,
    service: { name: service.name, category: service.category },
    bookingDate: toDateOnly(booking.booking_date),
    startTime: booking.start_time,
    endTime: booking.end_time,
    durationMinutes: booking.duration_minutes,
    totalAmount: total.toFixed(2),
    isFree: !(total > 0),
    firstName: booking.customer_first_name,
    emailHint: maskEmail(booking.customer_email),
  };
}

/**
 * Public status of a booking for the success page:
 *  confirmed    — room booked;
 *  needs_review — paid, but the booking can't go ahead (cancelled first or
 *                 the slot was taken); staff will refund or rebook;
 *  cancelled    — cancelled, nothing owed;
 *  pending      — waiting for the payment confirmation.
 */
export function publicStatus(booking: Booking): 'confirmed' | 'needs_review' | 'cancelled' | 'pending' {
  if (booking.needs_refund_review && booking.payment_status !== 'pending') return 'needs_review';
  if (['confirmed', 'completed', 'no_show'].includes(booking.status)) return 'confirmed';
  if (booking.status === 'cancelled' || booking.status === 'refunded') return 'cancelled';
  return 'pending';
}
