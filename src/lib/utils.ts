import { clsx, type ClassValue } from 'clsx';
import type { NextRequest } from 'next/server';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * The origin to build absolute URLs (Stripe redirect URLs, magic-link
 * emails) from. Prefers the actual origin the request came in on — this is
 * correct in production (zayro.studio), previews, and local dev alike, and
 * doesn't depend on NEXTAUTH_URL being set to the right value for the
 * environment. Falls back to NEXTAUTH_URL, then localhost, only if the
 * request's origin can't be determined.
 */
export function getBaseUrl(request?: NextRequest): string {
  if (request) {
    try {
      return request.nextUrl.origin;
    } catch {
      // fall through
    }
  }
  return process.env.NEXTAUTH_URL || 'http://localhost:3000';
}

// Time formatting
export function formatTime(time: string): string {
  return time; // Already in HH:MM format
}

export function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes };
}

export function addMinutesToTime(timeStr: string, minutes: number): string {
  const { hours, minutes: mins } = parseTime(timeStr);
  const totalMinutes = hours * 60 + mins + minutes;
  const newHours = Math.floor(totalMinutes / 60) % 24;
  const newMinutes = totalMinutes % 60;
  return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
}

export function timeToMinutes(timeStr: string): number {
  const { hours, minutes } = parseTime(timeStr);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// Date formatting
/**
 * Formats a SQL `date` value for display, safe regardless of whether the
 * driver handed it back as a bare "YYYY-MM-DD" string, a full ISO
 * timestamp string, or an actual Date object (postgres-js has returned all
 * three depending on context in this codebase). Always anchors to UTC on
 * both ends so the calendar date never shifts by a day for viewers behind
 * UTC.
 */
export function formatBookingDateUTC(value: string | Date): string {
  const raw = value instanceof Date ? value.toISOString() : value;
  const datePart = raw.slice(0, 10);
  return new Date(datePart + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Same as formatBookingDateUTC but short "YYYY-MM-DD" output, e.g. for admin tables. */
export function toDateOnly(value: string | Date): string {
  const raw = value instanceof Date ? value.toISOString() : value;
  return raw.slice(0, 10);
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDatetime(date: Date): string {
  return date.toISOString();
}

export function getDayOfWeek(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

// Currency formatting
export function formatCurrency(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num);
}

// Phone formatting
export function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  return phone;
}

// Validation
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidPhone(phone: string): boolean {
  const phoneRegex = /^[\d\s\-\(\)\+]+$/;
  return phoneRegex.test(phone) && phone.replace(/\D/g, '').length >= 10;
}

// Booking ID generation
export function generateBookingId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'ZAY-';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Pagination
export function getPaginationMetadata(
  page: number,
  limit: number,
  total: number
): {
  total: number;
  pages: number;
  current: number;
  hasNext: boolean;
  hasPrev: boolean;
} {
  const pages = Math.ceil(total / limit);
  return {
    total,
    pages,
    current: page,
    hasNext: page < pages,
    hasPrev: page > 1,
  };
}

// Get future dates
export function getFutureDates(days: number): string[] {
  const dates: string[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    dates.push(date.toISOString().split('T')[0]);
  }

  return dates;
}

// Check if date is today
export function isToday(dateStr: string): boolean {
  const date = new Date(dateStr);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

// Check if date is in past
export function isPastDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

// Check if date is in future
export function isFutureDate(dateStr: string): boolean {
  return !isPastDate(dateStr) && !isToday(dateStr);
}
