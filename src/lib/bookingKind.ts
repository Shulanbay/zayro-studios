import type { Booking, Service } from './db/schema';

export const STUDIO_TIMEZONE = 'America/New_York';

/**
 * - 'tour': the service is explicitly categorised as a studio tour.
 * - 'paid': any other service with a non-zero total.
 * - 'free': any other $0 service (e.g. a free test service). Price alone
 *   never makes something a tour.
 */
export type BookingKind = 'paid' | 'tour' | 'free';

export function isTourService(service: Pick<Service, 'category'>): boolean {
  return service.category === 'tour';
}

export function getBookingKind(
  booking: Pick<Booking, 'total_amount'>,
  service: Pick<Service, 'category'>
): BookingKind {
  if (isTourService(service)) return 'tour';
  return parseFloat(booking.total_amount) > 0 ? 'paid' : 'free';
}

export function bookingKindLabel(kind: BookingKind, booking: Pick<Booking, 'total_amount'>): string {
  if (kind === 'tour') return parseFloat(booking.total_amount) > 0 ? 'Studio Tour' : 'Free Studio Tour';
  return kind === 'paid' ? 'Paid Booking' : 'Free Booking';
}
