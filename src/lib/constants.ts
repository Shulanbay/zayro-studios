// Brand & Business Info
// These read from env vars set in Vercel/business settings so the owner can
// update them without a code change. Fall back to sensible defaults for
// local dev.
export const BUSINESS_NAME = process.env.BUSINESS_NAME || 'ZAYRO Studios';
export const BUSINESS_ADDRESS = process.env.BUSINESS_ADDRESS || '40 W 37th St, Suite 603, New York, NY 10018';
export const BUSINESS_EMAIL = process.env.BUSINESS_EMAIL || 'hello@zayro.studio';
export const OWNER_EMAIL = process.env.OWNER_EMAIL || 'owner@zayro.studio';

const rawPhone = process.env.BUSINESS_PHONE || '';
// A phone number hasn't actually been provided yet if it's empty or still
// the placeholder from .env.example. Callers should check BUSINESS_PHONE
// before rendering a phone number / tel: link, and hide that UI otherwise.
export const BUSINESS_PHONE: string | null = rawPhone && !/X{2,}/i.test(rawPhone) ? rawPhone : null;

// Colors
export const COLORS = {
  PRIMARY: '#315CFF', // Electric Blue
  DARK: '#0A0A0B', // Dark/Black
  BACKGROUND: '#F7F7F5', // Off-white
  WHITE: '#FFFFFF',
  GRAY: '#8A8A8F',
};

// Booking Configuration
export const BOOKING_CONFIG = {
  MIN_DURATION_MINUTES: parseInt(process.env.MIN_BOOKING_DURATION_MINUTES || '30'),
  MAX_DURATION_MINUTES: parseInt(process.env.MAX_BOOKING_DURATION_MINUTES || '480'),
  INCREMENT_MINUTES: parseInt(process.env.BOOKING_INCREMENT_MINUTES || '30'),
  BUFFER_BEFORE_MINUTES: parseInt(process.env.BUFFER_BEFORE_BOOKING_MINUTES || '15'),
  BUFFER_AFTER_MINUTES: parseInt(process.env.BUFFER_AFTER_BOOKING_MINUTES || '15'),
  MIN_ADVANCE_NOTICE_HOURS: parseInt(process.env.MIN_ADVANCE_NOTICE_HOURS || '1'),
  MAX_BOOKING_HORIZON_DAYS: parseInt(process.env.MAX_BOOKING_HORIZON_DAYS || '90'),
  TEMPORARY_HOLD_MINUTES: parseInt(process.env.TEMPORARY_HOLD_DURATION_MINUTES || '15'),
  TAX_RATE: parseFloat(process.env.TAX_RATE || '0.08625'),
};

// Business Hours (default, can be overridden in database)
export const DEFAULT_BUSINESS_HOURS = {
  Monday: { start: '09:00', end: '18:00' },
  Tuesday: { start: '09:00', end: '18:00' },
  Wednesday: { start: '09:00', end: '18:00' },
  Thursday: { start: '09:00', end: '18:00' },
  Friday: { start: '09:00', end: '18:00' },
  Saturday: { start: '10:00', end: '16:00' },
  Sunday: { start: 'closed', end: 'closed' },
};

// Routes
export const ROUTES = {
  HOME: '/',
  STUDIO: '/studio',
  PRICING: '/pricing',
  BOOKING: '/booking',
  BOOKING_SUCCESS: '/booking/success',
  BOOKING_CANCELLED: '/booking/cancelled',
  ADMIN: '/admin',
  ADMIN_BOOKINGS: '/admin/bookings',
  ADMIN_AVAILABILITY: '/admin/availability',
};

// Booking Status
export const BOOKING_STATUSES = {
  PENDING: 'pending',
  PAYMENT_PENDING: 'payment_pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  REFUNDED: 'refunded',
} as const;

// Payment Status
export const PAYMENT_STATUSES = {
  PENDING: 'pending',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const;

// Service Categories
export const SERVICE_CATEGORIES = {
  PODCAST: 'podcast',
  VIDEO: 'video',
  LIVESTREAM: 'livestream',
  EDITING: 'editing',
} as const;

// Email Templates
export const EMAIL_SUBJECTS = {
  BOOKING_CONFIRMATION: 'Your ZAYRO Studios Booking Is Confirmed',
  OWNER_NOTIFICATION: 'NEW BOOKING',
  BOOKING_REMINDER: 'Reminder: Your ZAYRO Studios Booking Tomorrow',
};

// SEO
export const SEO_KEYWORDS = [
  'podcast studio nyc',
  'podcast studio rental nyc',
  'podcast recording studio nyc',
  'video podcast studio nyc',
  'podcast studio manhattan',
  'podcast studio midtown nyc',
  'podcast recording nyc',
];
