import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  decimal,
  boolean,
  timestamp,
  date,
  uuid,
  pgEnum,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ========================================
// ENUMS
// ========================================

export const bookingStatusEnum = pgEnum('booking_status', [
  'pending',
  'payment_pending',
  'confirmed',
  'cancelled',
  'completed',
  'refunded',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
]);

export const holdStatusEnum = pgEnum('hold_status', [
  'active',
  'converted_to_booking',
  'expired',
  'cancelled',
]);

export const integrationTypeEnum = pgEnum('integration_type', [
  'stripe',
  'google_calendar',
  'google_sheets',
  'email',
]);

export const integrationStatusEnum = pgEnum('integration_status', [
  'pending',
  'success',
  'failed',
]);

export const serviceCategoryEnum = pgEnum('service_category', [
  'podcast',
  'video',
  'livestream',
  'editing',
  // Studio tours are identified by this category, never by a $0 price.
  'tour',
]);

// ========================================
// MAIN TABLES
// ========================================

export const services = pgTable(
  'services',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    base_price: decimal('base_price', { precision: 10, scale: 2 }).notNull(),
    duration_minutes: integer('duration_minutes').notNull(),
    category: serviceCategoryEnum('category').notNull().default('podcast'),
    features: jsonb('features').$type<string[]>().default(sql`'[]'::jsonb`),
    is_active: boolean('is_active').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    categoryIdx: index('services_category_idx').on(table.category),
  })
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: varchar('email', { length: 255 }).notNull().unique(),
    first_name: varchar('first_name', { length: 255 }),
    last_name: varchar('last_name', { length: 255 }),
    phone: varchar('phone', { length: 20 }),
    company: varchar('company', { length: 255 }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    emailIdx: index('customers_email_idx').on(table.email),
  })
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    booking_id: varchar('booking_id', { length: 20 }).notNull().unique(),
    customer_id: uuid('customer_id').notNull(),
    service_id: integer('service_id').notNull(),
    booking_date: date('booking_date', { mode: 'string' }).notNull(),
    start_time: varchar('start_time', { length: 5 }).notNull(), // HH:MM
    end_time: varchar('end_time', { length: 5 }).notNull(), // HH:MM
    duration_minutes: integer('duration_minutes').notNull(),
    customer_first_name: varchar('customer_first_name', { length: 255 }).notNull(),
    customer_last_name: varchar('customer_last_name', { length: 255 }).notNull(),
    customer_email: varchar('customer_email', { length: 255 }).notNull(),
    customer_phone: varchar('customer_phone', { length: 20 }).notNull(),
    company_name: varchar('company_name', { length: 255 }),
    notes: text('notes'),
    status: bookingStatusEnum('status').notNull().default('pending'),
    subtotal: decimal('subtotal', { precision: 10, scale: 2 }).notNull(),
    tax_amount: decimal('tax_amount', { precision: 10, scale: 2 }).notNull(),
    total_amount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
    payment_status: paymentStatusEnum('payment_status').notNull().default('pending'),
    stripe_payment_id: varchar('stripe_payment_id', { length: 255 }).unique(),
    stripe_session_id: varchar('stripe_session_id', { length: 255 }).unique(),
    google_calendar_event_id: varchar('google_calendar_event_id', { length: 255 }),
    google_sheets_row_id: varchar('google_sheets_row_id', { length: 255 }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    customerIdIdx: index('bookings_customer_id_idx').on(table.customer_id),
    bookingIdIdx: index('bookings_booking_id_idx').on(table.booking_id),
    bookingDateIdx: index('bookings_booking_date_idx').on(table.booking_date),
    stripePaymentIdx: index('bookings_stripe_payment_id_idx').on(table.stripe_payment_id),
    statusIdx: index('bookings_status_idx').on(table.status),
  })
);

export const temporaryHolds = pgTable(
  'temporary_holds',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    customer_email: varchar('customer_email', { length: 255 }).notNull(),
    service_id: integer('service_id').notNull(),
    booking_date: date('booking_date', { mode: 'string' }).notNull(),
    start_time: varchar('start_time', { length: 5 }).notNull(),
    end_time: varchar('end_time', { length: 5 }).notNull(),
    duration_minutes: integer('duration_minutes').notNull(),
    status: holdStatusEnum('status').notNull().default('active'),
    hold_expires_at: timestamp('hold_expires_at', { withTimezone: true }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    bookingDateIdx: index('holds_booking_date_idx').on(table.booking_date),
    expiresAtIdx: index('holds_expires_at_idx').on(table.hold_expires_at),
    statusIdx: index('holds_status_idx').on(table.status),
  })
);

export const availability = pgTable(
  'availability',
  {
    id: serial('id').primaryKey(),
    day_of_week: pgEnum('day_of_week', [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ])('day_of_week').notNull(),
    start_time: varchar('start_time', { length: 5 }).notNull(), // HH:MM
    end_time: varchar('end_time', { length: 5 }).notNull(), // HH:MM
    is_available: boolean('is_available').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    dayIdx: index('availability_day_of_week_idx').on(table.day_of_week),
  })
);

export const blockedTimes = pgTable(
  'blocked_times',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    start_datetime: timestamp('start_datetime', { withTimezone: true }).notNull(),
    end_datetime: timestamp('end_datetime', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 255 }),
    created_by: varchar('created_by', { length: 255 }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    startIdx: index('blocked_times_start_datetime_idx').on(table.start_datetime),
    endIdx: index('blocked_times_end_datetime_idx').on(table.end_datetime),
  })
);

export const businessSettings = pgTable(
  'business_settings',
  {
    id: serial('id').primaryKey(),
    setting_key: varchar('setting_key', { length: 255 }).notNull().unique(),
    setting_value: text('setting_value'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    keyIdx: index('business_settings_key_idx').on(table.setting_key),
  })
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    booking_id: uuid('booking_id').notNull(),
    stripe_payment_id: varchar('stripe_payment_id', { length: 255 }).notNull().unique(),
    amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    status: paymentStatusEnum('status').notNull().default('pending'),
    metadata: jsonb('metadata'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    bookingIdIdx: index('payments_booking_id_idx').on(table.booking_id),
    stripeIdIdx: index('payments_stripe_id_idx').on(table.stripe_payment_id),
  })
);

export const integrationLogs = pgTable(
  'integration_logs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    integration_type: integrationTypeEnum('integration_type').notNull(),
    booking_id: uuid('booking_id'),
    status: integrationStatusEnum('status').notNull(),
    error_message: text('error_message'),
    response_data: jsonb('response_data'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    bookingIdIdx: index('integration_logs_booking_id_idx').on(table.booking_id),
    typeIdx: index('integration_logs_type_idx').on(table.integration_type),
  })
);

// ========================================
// EXPORT TYPES
// ========================================

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

export type TemporaryHold = typeof temporaryHolds.$inferSelect;
export type NewTemporaryHold = typeof temporaryHolds.$inferInsert;

export type Availability = typeof availability.$inferSelect;
export type NewAvailability = typeof availability.$inferInsert;

export type BlockedTime = typeof blockedTimes.$inferSelect;
export type NewBlockedTime = typeof blockedTimes.$inferInsert;

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

export type IntegrationLog = typeof integrationLogs.$inferSelect;
export type NewIntegrationLog = typeof integrationLogs.$inferInsert;
