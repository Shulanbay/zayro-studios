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
  smallint,
  uniqueIndex,
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
  // Added in 0005 (CRM): the customer didn't turn up.
  'no_show',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
  // Added in 0005 (CRM).
  'partially_refunded',
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
  // Admin actions on a booking (e.g. cancellation) — an audit trail.
  'admin',
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
  'photography',
  // Prepaid monthly packages. Never bookable as a single time slot.
  'package',
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
    display_order: integer('display_order').notNull().default(0),
    is_featured: boolean('is_featured').notNull().default(false),
    badge: varchar('badge', { length: 40 }),
    // Monthly package fields — only set for category 'package'.
    session_count: integer('session_count'),
    validity_days: integer('validity_days'),
    package_type: varchar('package_type', { length: 40 }),
    // The single-session service a package is priced from (regular price =
    // session_count × that service's base_price).
    package_base_service_id: integer('package_base_service_id'),
    // CRM (0006)
    slug: varchar('slug', { length: 120 }),
    visible_in_booking: boolean('visible_in_booking').notNull().default(true),
    quote_only: boolean('quote_only').notNull().default(false),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    // Soft delete: services linked to money are never physically deleted.
    archived_at: timestamp('archived_at', { withTimezone: true }),
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
    // CRM (0006). normalized_email is maintained by a trigger.
    normalized_email: varchar('normalized_email', { length: 255 }),
    status: varchar('status', { length: 20, enum: ['active', 'archived', 'merged'] }).notNull().default('active'),
    stripe_customer_id: varchar('stripe_customer_id', { length: 255 }),
    total_spent_cents: integer('total_spent_cents').notNull().default(0),
    booking_count: integer('booking_count').notNull().default(0),
    last_booking_at: timestamp('last_booking_at', { withTimezone: true }),
    internal_notes: text('internal_notes'),
    marketing_consent: boolean('marketing_consent').notNull().default(false),
    merged_into_id: uuid('merged_into_id'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    emailIdx: index('customers_email_idx').on(table.email),
    normalizedEmailIdx: index('customers_normalized_email_idx').on(table.normalized_email),
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
    // CRM (0006)
    purchase_id: uuid('purchase_id'),
    source: varchar('source', { length: 20, enum: ['individual', 'package', 'studio_tour', 'admin'] })
      .notNull()
      .default('individual'),
    room_id: integer('room_id').notNull().default(1),
    setup_id: integer('setup_id'),
    customer_package_id: uuid('customer_package_id'),
    internal_notes: text('internal_notes'),
    cancellation_reason: text('cancellation_reason'),
    cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    no_show_at: timestamp('no_show_at', { withTimezone: true }),
    created_by_admin_id: uuid('created_by_admin_id'),
    updated_by_admin_id: uuid('updated_by_admin_id'),
    needs_refund_review: boolean('needs_refund_review').notNull().default(false),
    review_reason: text('review_reason'),
    // Derived from booking_date + start/end time in the room's time zone by
    // the bookings_set_range trigger — never written by application code.
    starts_at: timestamp('starts_at', { withTimezone: true }),
    ends_at: timestamp('ends_at', { withTimezone: true }),
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
    // CRM (0006)
    room_id: integer('room_id').notNull().default(1),
    kind: varchar('kind', { length: 20 }).notNull().default('block'),
    series_id: uuid('series_id'),
    google_calendar_event_id: varchar('google_calendar_event_id', { length: 255 }),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    deleted_by: varchar('deleted_by', { length: 255 }),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    // 2 = real UTC instant (see 0007). Pre-CRM rows were converted once.
    tz_version: smallint('tz_version').default(2),
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
// CRM TABLES (migrations 0006-0008)
// ========================================

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const rooms = pgTable('rooms', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  address: varchar('address', { length: 255 }),
  timezone: varchar('timezone', { length: 64 }).notNull().default('America/New_York'),
  active: boolean('active').notNull().default(true),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const setups = pgTable('setups', {
  id: serial('id').primaryKey(),
  room_id: integer('room_id').notNull(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  capacity: integer('capacity'),
  active: boolean('active').notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 60 }).notNull().unique(),
  description: text('description'),
  is_system: boolean('is_system').notNull().default(false),
  permissions: jsonb('permissions').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const ADMIN_STATUSES = ['active', 'invited', 'disabled'] as const;

export const adminProfiles = pgTable('admin_profiles', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: varchar('email', { length: 255 }).notNull(),
  normalized_email: varchar('normalized_email', { length: 255 }).notNull().unique(),
  full_name: varchar('full_name', { length: 255 }),
  role_id: integer('role_id').notNull(),
  status: varchar('status', { length: 20, enum: ADMIN_STATUSES }).notNull().default('active'),
  last_login_at: timestamp('last_login_at', { withTimezone: true }),
  created_by: varchar('created_by', { length: 255 }),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const adminLoginTokens = pgTable('admin_login_tokens', {
  jti: varchar('jti', { length: 64 }).primaryKey(),
  normalized_email: varchar('normalized_email', { length: 255 }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumed_at: timestamp('consumed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const AUDIT_OUTCOMES = ['success', 'denied', 'failed'] as const;

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    actor_id: uuid('actor_id'),
    actor_email: varchar('actor_email', { length: 255 }),
    operation: varchar('operation', { length: 80 }).notNull(),
    entity_type: varchar('entity_type', { length: 60 }).notNull(),
    entity_id: varchar('entity_id', { length: 120 }),
    outcome: varchar('outcome', { length: 20, enum: AUDIT_OUTCOMES }).notNull(),
    before_data: jsonb('before_data'),
    after_data: jsonb('after_data'),
    metadata: jsonb('metadata'),
    created_at: createdAt(),
  },
  (table) => ({
    entityIdx: index('audit_logs_entity_idx').on(table.entity_type, table.entity_id),
    createdAtIdx: index('audit_logs_created_at_idx').on(table.created_at),
    actorIdx: index('audit_logs_actor_idx').on(table.actor_id),
  })
);

export const customerNotes = pgTable('customer_notes', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  customer_id: uuid('customer_id').notNull(),
  author_id: uuid('author_id'),
  author_email: varchar('author_email', { length: 255 }),
  body: text('body').notNull(),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const PURCHASE_TYPES = ['individual', 'package', 'studio_tour', 'manual'] as const;
export const PURCHASE_STATUSES = ['pending', 'paid', 'partially_refunded', 'refunded', 'cancelled', 'failed', 'approved'] as const;
export const PAYMENT_METHODS = ['stripe', 'cash', 'card_terminal', 'bank_transfer', 'comp', 'package_credit', 'other'] as const;

export const purchases = pgTable('purchases', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  order_number: varchar('order_number', { length: 40 }).notNull().unique(),
  customer_id: uuid('customer_id'),
  type: varchar('type', { length: 20, enum: PURCHASE_TYPES }).notNull(),
  status: varchar('status', { length: 24, enum: PURCHASE_STATUSES }).notNull().default('pending'),
  subtotal_cents: integer('subtotal_cents').notNull().default(0),
  tax_cents: integer('tax_cents').notNull().default(0),
  total_cents: integer('total_cents').notNull().default(0),
  refunded_cents: integer('refunded_cents').notNull().default(0),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  payment_method: varchar('payment_method', { length: 24, enum: PAYMENT_METHODS }).notNull().default('stripe'),
  stripe_checkout_session_id: varchar('stripe_checkout_session_id', { length: 255 }).unique(),
  stripe_payment_intent_id: varchar('stripe_payment_intent_id', { length: 255 }),
  stripe_customer_id: varchar('stripe_customer_id', { length: 255 }),
  promotion_code: varchar('promotion_code', { length: 100 }),
  needs_refund_review: boolean('needs_refund_review').notNull().default(false),
  review_reason: text('review_reason'),
  notes: text('notes'),
  created_by_admin_id: uuid('created_by_admin_id'),
  purchased_at: timestamp('purchased_at', { withTimezone: true }),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const purchaseItems = pgTable('purchase_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  purchase_id: uuid('purchase_id').notNull(),
  item_type: varchar('item_type', { length: 20, enum: ['service', 'package', 'adjustment'] }).notNull(),
  reference_id: varchar('reference_id', { length: 64 }),
  description_snapshot: text('description_snapshot').notNull(),
  quantity: integer('quantity').notNull().default(1),
  unit_price_cents: integer('unit_price_cents').notNull(),
  total_cents: integer('total_cents').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  created_at: createdAt(),
});

export const REFUND_STATUSES = ['pending', 'succeeded', 'failed', 'canceled', 'requires_action'] as const;

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  purchase_id: uuid('purchase_id').notNull(),
  booking_id: uuid('booking_id'),
  stripe_refund_id: varchar('stripe_refund_id', { length: 255 }).unique(),
  amount_cents: integer('amount_cents').notNull(),
  status: varchar('status', { length: 20, enum: REFUND_STATUSES }).notNull().default('pending'),
  reason: text('reason'),
  requested_by: varchar('requested_by', { length: 255 }),
  requested_by_admin_id: uuid('requested_by_admin_id'),
  source: varchar('source', { length: 20, enum: ['admin', 'stripe'] }).notNull().default('admin'),
  failure_reason: text('failure_reason'),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const WEBHOOK_STATUSES = ['received', 'processing', 'processed', 'failed'] as const;

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    provider: varchar('provider', { length: 20 }).notNull(),
    external_event_id: varchar('external_event_id', { length: 255 }).notNull(),
    event_type: varchar('event_type', { length: 100 }).notNull(),
    status: varchar('status', { length: 20, enum: WEBHOOK_STATUSES }).notNull().default('received'),
    attempts: integer('attempts').notNull().default(0),
    safe_payload: jsonb('safe_payload').$type<Record<string, unknown>>(),
    error: text('error'),
    received_at: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    locked_at: timestamp('locked_at', { withTimezone: true }),
    processed_at: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => ({
    externalUnique: uniqueIndex('webhook_events_external_event_id_unique').on(table.provider, table.external_event_id),
  })
);

export const EMAIL_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;

export const emailLogs = pgTable('email_logs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  template: varchar('template', { length: 60 }).notNull(),
  recipient_type: varchar('recipient_type', { length: 20, enum: ['customer', 'owner', 'admin'] }).notNull(),
  recipient: varchar('recipient', { length: 255 }),
  booking_id: uuid('booking_id'),
  purchase_id: uuid('purchase_id'),
  customer_package_id: uuid('customer_package_id'),
  refund_id: uuid('refund_id'),
  dedupe_key: varchar('dedupe_key', { length: 200 }).notNull().unique(),
  /** Non-secret values a retry needs to re-render the email (e.g. the previous time of a reschedule). */
  context: jsonb('context').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  status: varchar('status', { length: 20, enum: EMAIL_STATUSES }).notNull().default('pending'),
  provider_message_id: varchar('provider_message_id', { length: 255 }),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  last_attempt_at: timestamp('last_attempt_at', { withTimezone: true }),
  sent_at: timestamp('sent_at', { withTimezone: true }),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const OVERRIDE_KINDS = ['custom_hours', 'holiday', 'day_off', 'closure'] as const;

export const availabilityOverrides = pgTable('availability_overrides', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  room_id: integer('room_id').notNull().default(1),
  date: date('date', { mode: 'string' }).notNull(),
  kind: varchar('kind', { length: 20, enum: OVERRIDE_KINDS }).notNull(),
  is_closed: boolean('is_closed').notNull().default(true),
  start_time: varchar('start_time', { length: 5 }),
  end_time: varchar('end_time', { length: 5 }),
  reason: varchar('reason', { length: 255 }),
  created_by: varchar('created_by', { length: 255 }),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const packagePlans = pgTable('package_plans', {
  id: serial('id').primaryKey(),
  service_id: integer('service_id').unique(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 120 }).notNull().unique(),
  package_type: varchar('package_type', { length: 40 }),
  description: text('description'),
  total_credits: integer('total_credits').notNull(),
  validity_days: integer('validity_days').notNull().default(30),
  price_cents: integer('price_cents').notNull(),
  active: boolean('active').notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const packagePlanItems = pgTable('package_plan_items', {
  id: serial('id').primaryKey(),
  plan_id: integer('plan_id').notNull(),
  service_id: integer('service_id').notNull(),
  credits: integer('credits').notNull(),
});

export const CUSTOMER_PACKAGE_STATUSES = ['active', 'expired', 'exhausted', 'cancelled'] as const;

export const customerPackages = pgTable('customer_packages', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  customer_id: uuid('customer_id').notNull(),
  package_plan_id: integer('package_plan_id').notNull(),
  purchase_id: uuid('purchase_id'),
  total_credits: integer('total_credits').notNull(),
  remaining_credits: integer('remaining_credits').notNull(),
  starts_at: timestamp('starts_at', { withTimezone: true }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 20, enum: CUSTOMER_PACKAGE_STATUSES }).notNull().default('active'),
  plan_snapshot: jsonb('plan_snapshot').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  notes: text('notes'),
  assigned_by_admin_id: uuid('assigned_by_admin_id'),
  created_at: createdAt(),
  updated_at: updatedAt(),
});

export const CREDIT_TRANSACTION_TYPES = ['grant', 'redeem', 'restore', 'expire', 'adjustment'] as const;

export const packageCreditTransactions = pgTable('package_credit_transactions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  customer_package_id: uuid('customer_package_id').notNull(),
  booking_id: uuid('booking_id'),
  type: varchar('type', { length: 20, enum: CREDIT_TRANSACTION_TYPES }).notNull(),
  credits: integer('credits').notNull(),
  balance_after: integer('balance_after').notNull(),
  actor_id: uuid('actor_id'),
  actor_email: varchar('actor_email', { length: 255 }),
  reason: text('reason'),
  created_at: createdAt(),
});

export const rateLimits = pgTable('rate_limits', {
  key: varchar('key', { length: 200 }).primaryKey(),
  window_start: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
});

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

export type Room = typeof rooms.$inferSelect;
export type Setup = typeof setups.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type AdminProfile = typeof adminProfiles.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type CustomerNote = typeof customerNotes.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type NewPurchase = typeof purchases.$inferInsert;
export type PurchaseItem = typeof purchaseItems.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type EmailLog = typeof emailLogs.$inferSelect;
export type AvailabilityOverride = typeof availabilityOverrides.$inferSelect;
export type PackagePlan = typeof packagePlans.$inferSelect;
export type PackagePlanItem = typeof packagePlanItems.$inferSelect;
export type CustomerPackage = typeof customerPackages.$inferSelect;
export type PackageCreditTransaction = typeof packageCreditTransactions.$inferSelect;
