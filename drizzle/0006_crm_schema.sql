-- CRM, step 2 of 4: new tables, new columns and triggers. Purely additive:
-- nothing is dropped, renamed or retyped, every new column on an existing
-- table is nullable or has a default, so the previous deployment keeps
-- working while this one is being built. Idempotent (IF NOT EXISTS /
-- ON CONFLICT / DROP TRIGGER IF EXISTS).

-- ---------------------------------------------------------------------
-- Rooms and setups
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "rooms" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(120) NOT NULL,
  "address" varchar(255),
  "timezone" varchar(64) DEFAULT 'America/New_York' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "rooms" ("id", "name", "address", "timezone", "active")
VALUES (1, 'Main Studio', '40 W 37th St, Suite 603, New York, NY 10018', 'America/New_York', true)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('rooms', 'id'), GREATEST((SELECT max("id") FROM "rooms"), 1));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "setups" (
  "id" serial PRIMARY KEY NOT NULL,
  "room_id" integer NOT NULL REFERENCES "rooms"("id"),
  "slug" varchar(80) NOT NULL,
  "name" varchar(120) NOT NULL,
  "description" text,
  "capacity" integer,
  "active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "setups_slug_unique" UNIQUE ("slug")
);--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Team, roles, audit
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "roles" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(60) NOT NULL,
  "description" text,
  "is_system" boolean DEFAULT false NOT NULL,
  "permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "roles_name_unique" UNIQUE ("name")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(255) NOT NULL,
  "normalized_email" varchar(255) NOT NULL,
  "full_name" varchar(255),
  "role_id" integer NOT NULL REFERENCES "roles"("id"),
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "last_login_at" timestamp with time zone,
  "created_by" varchar(255),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "admin_profiles_normalized_email_unique" UNIQUE ("normalized_email"),
  CONSTRAINT "admin_profiles_status_check" CHECK ("status" IN ('active', 'invited', 'disabled'))
);--> statement-breakpoint
-- One row per consumed magic link, so a link can only be used once.
CREATE TABLE IF NOT EXISTS "admin_login_tokens" (
  "jti" varchar(64) PRIMARY KEY NOT NULL,
  "normalized_email" varchar(255) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid,
  "actor_email" varchar(255),
  "operation" varchar(80) NOT NULL,
  "entity_type" varchar(60) NOT NULL,
  "entity_id" varchar(120),
  "outcome" varchar(20) NOT NULL,
  "before_data" jsonb,
  "after_data" jsonb,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "audit_logs_outcome_check" CHECK ("outcome" IN ('success', 'denied', 'failed'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs" ("entity_type", "entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs" ("actor_id");--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "normalized_email" varchar(255);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "stripe_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "total_spent_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "booking_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "last_booking_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "internal_notes" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "marketing_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "merged_into_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "customers" ADD CONSTRAINT "customers_status_check" CHECK ("status" IN ('active', 'archived', 'merged'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_normalized_email_idx" ON "customers" ("normalized_email");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "zayro_customers_normalize_email"() RETURNS trigger AS $$
BEGIN
  NEW."normalized_email" := lower(btrim(NEW."email"));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "customers_normalize_email" ON "customers";--> statement-breakpoint
CREATE TRIGGER "customers_normalize_email"
  BEFORE INSERT OR UPDATE OF "email" ON "customers"
  FOR EACH ROW EXECUTE FUNCTION "zayro_customers_normalize_email"();--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "author_id" uuid,
  "author_email" varchar(255),
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_notes_customer_idx" ON "customer_notes" ("customer_id");--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "slug" varchar(120);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "visible_in_booking" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "quote_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "services_slug_unique" ON "services" ("slug");--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Purchases (integer cents, immutable line items)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "purchases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_number" varchar(40) NOT NULL,
  "customer_id" uuid REFERENCES "customers"("id"),
  "type" varchar(20) NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "subtotal_cents" integer DEFAULT 0 NOT NULL,
  "tax_cents" integer DEFAULT 0 NOT NULL,
  "total_cents" integer DEFAULT 0 NOT NULL,
  "refunded_cents" integer DEFAULT 0 NOT NULL,
  "currency" varchar(3) DEFAULT 'USD' NOT NULL,
  "payment_method" varchar(24) DEFAULT 'stripe' NOT NULL,
  "stripe_checkout_session_id" varchar(255),
  "stripe_payment_intent_id" varchar(255),
  "stripe_customer_id" varchar(255),
  "promotion_code" varchar(100),
  "needs_refund_review" boolean DEFAULT false NOT NULL,
  "review_reason" text,
  "notes" text,
  "created_by_admin_id" uuid,
  "purchased_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchases_order_number_unique" UNIQUE ("order_number"),
  CONSTRAINT "purchases_checkout_session_unique" UNIQUE ("stripe_checkout_session_id"),
  CONSTRAINT "purchases_type_check" CHECK ("type" IN ('individual', 'package', 'studio_tour', 'manual')),
  CONSTRAINT "purchases_status_check" CHECK ("status" IN ('pending', 'paid', 'partially_refunded', 'refunded', 'cancelled', 'failed', 'approved')),
  CONSTRAINT "purchases_payment_method_check" CHECK ("payment_method" IN ('stripe', 'cash', 'card_terminal', 'bank_transfer', 'comp', 'package_credit', 'other')),
  CONSTRAINT "purchases_amounts_check" CHECK (
    "subtotal_cents" >= 0 AND "tax_cents" >= 0 AND "total_cents" >= 0
    AND "refunded_cents" >= 0 AND "refunded_cents" <= "total_cents"
  )
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchases_customer_idx" ON "purchases" ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchases_status_idx" ON "purchases" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchases_purchased_at_idx" ON "purchases" ("purchased_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchases_payment_intent_idx" ON "purchases" ("stripe_payment_intent_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_id" uuid NOT NULL REFERENCES "purchases"("id"),
  "item_type" varchar(20) NOT NULL,
  "reference_id" varchar(64),
  "description_snapshot" text NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unit_price_cents" integer NOT NULL,
  "total_cents" integer NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "purchase_items_type_check" CHECK ("item_type" IN ('service', 'package', 'adjustment')),
  CONSTRAINT "purchase_items_quantity_check" CHECK ("quantity" > 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_items_purchase_idx" ON "purchase_items" ("purchase_id");--> statement-breakpoint
-- A line item is a historical snapshot: once written it can't change, so a
-- later price edit on the service can never rewrite what a customer paid.
CREATE OR REPLACE FUNCTION "zayro_purchase_items_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'purchase_items are immutable snapshots (% on %)', TG_OP, OLD."id"
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "purchase_items_immutable" ON "purchase_items";--> statement-breakpoint
CREATE TRIGGER "purchase_items_immutable"
  BEFORE UPDATE OR DELETE ON "purchase_items"
  FOR EACH ROW EXECUTE FUNCTION "zayro_purchase_items_immutable"();--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Packages and credits
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "package_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "service_id" integer REFERENCES "services"("id"),
  "name" varchar(255) NOT NULL,
  "slug" varchar(120) NOT NULL,
  "package_type" varchar(40),
  "description" text,
  "total_credits" integer NOT NULL,
  "validity_days" integer DEFAULT 30 NOT NULL,
  "price_cents" integer NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "package_plans_slug_unique" UNIQUE ("slug"),
  CONSTRAINT "package_plans_service_unique" UNIQUE ("service_id"),
  CONSTRAINT "package_plans_values_check" CHECK ("total_credits" > 0 AND "validity_days" > 0 AND "price_cents" >= 0)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "package_plan_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "plan_id" integer NOT NULL REFERENCES "package_plans"("id"),
  "service_id" integer NOT NULL REFERENCES "services"("id"),
  "credits" integer NOT NULL,
  CONSTRAINT "package_plan_items_unique" UNIQUE ("plan_id", "service_id"),
  CONSTRAINT "package_plan_items_credits_check" CHECK ("credits" > 0)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "package_plan_id" integer NOT NULL REFERENCES "package_plans"("id"),
  "purchase_id" uuid REFERENCES "purchases"("id"),
  "total_credits" integer NOT NULL,
  "remaining_credits" integer NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "plan_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "notes" text,
  "assigned_by_admin_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_packages_status_check" CHECK ("status" IN ('active', 'expired', 'exhausted', 'cancelled')),
  CONSTRAINT "customer_packages_credits_check" CHECK ("total_credits" >= 0 AND "remaining_credits" >= 0),
  CONSTRAINT "customer_packages_dates_check" CHECK ("expires_at" > "starts_at")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_packages_customer_idx" ON "customer_packages" ("customer_id");--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "purchase_id" uuid REFERENCES "purchases"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "source" varchar(20) DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "room_id" integer DEFAULT 1 NOT NULL REFERENCES "rooms"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "setup_id" integer REFERENCES "setups"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "customer_package_id" uuid REFERENCES "customer_packages"("id");--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "internal_notes" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "no_show_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "created_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "updated_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "needs_refund_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "review_reason" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "ends_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_source_check" CHECK ("source" IN ('individual', 'package', 'studio_tour', 'admin'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_purchase_idx" ON "bookings" ("purchase_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_starts_at_idx" ON "bookings" ("starts_at");--> statement-breakpoint
-- starts_at / ends_at are the booking's wall-clock date + times interpreted
-- in the room's time zone. Kept by a trigger so every writer (including
-- code written before the CRM) keeps them correct.
CREATE OR REPLACE FUNCTION "zayro_bookings_set_range"() RETURNS trigger AS $$
DECLARE
  tz text;
BEGIN
  SELECT "timezone" INTO tz FROM "rooms" WHERE "id" = NEW."room_id";
  tz := coalesce(tz, 'America/New_York');
  NEW."starts_at" := (NEW."booking_date" + NEW."start_time"::time) AT TIME ZONE tz;
  NEW."ends_at" := (
    NEW."booking_date" + NEW."end_time"::time
    + CASE WHEN NEW."end_time" <= NEW."start_time" THEN interval '1 day' ELSE interval '0' END
  ) AT TIME ZONE tz;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "bookings_set_range" ON "bookings";--> statement-breakpoint
CREATE TRIGGER "bookings_set_range"
  BEFORE INSERT OR UPDATE OF "booking_date", "start_time", "end_time", "room_id" ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "zayro_bookings_set_range"();--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "package_credit_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "customer_package_id" uuid NOT NULL REFERENCES "customer_packages"("id"),
  "booking_id" uuid REFERENCES "bookings"("id"),
  "type" varchar(20) NOT NULL,
  "credits" integer NOT NULL,
  "balance_after" integer NOT NULL,
  "actor_id" uuid,
  "actor_email" varchar(255),
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "package_credit_transactions_type_check" CHECK ("type" IN ('grant', 'redeem', 'restore', 'expire', 'adjustment')),
  CONSTRAINT "package_credit_transactions_balance_check" CHECK ("balance_after" >= 0),
  CONSTRAINT "package_credit_transactions_sign_check" CHECK (
    ("type" IN ('grant', 'restore') AND "credits" > 0)
    OR ("type" IN ('redeem', 'expire') AND "credits" < 0)
    OR ("type" = 'adjustment' AND "credits" <> 0)
  )
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "package_credit_transactions_package_idx" ON "package_credit_transactions" ("customer_package_id");--> statement-breakpoint
-- A booking can consume at most one credit and get it back at most once.
CREATE UNIQUE INDEX IF NOT EXISTS "package_credit_one_redeem_per_booking" ON "package_credit_transactions" ("booking_id") WHERE "type" = 'redeem';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "package_credit_one_restore_per_booking" ON "package_credit_transactions" ("booking_id") WHERE "type" = 'restore';--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Refunds, webhook events, email log
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "purchase_id" uuid NOT NULL REFERENCES "purchases"("id"),
  "booking_id" uuid REFERENCES "bookings"("id"),
  "stripe_refund_id" varchar(255),
  "amount_cents" integer NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "reason" text,
  "requested_by" varchar(255),
  "requested_by_admin_id" uuid,
  "source" varchar(20) DEFAULT 'admin' NOT NULL,
  "failure_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "refunds_stripe_refund_id_unique" UNIQUE ("stripe_refund_id"),
  CONSTRAINT "refunds_amount_check" CHECK ("amount_cents" > 0),
  CONSTRAINT "refunds_status_check" CHECK ("status" IN ('pending', 'succeeded', 'failed', 'canceled', 'requires_action')),
  CONSTRAINT "refunds_source_check" CHECK ("source" IN ('admin', 'stripe'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refunds_purchase_idx" ON "refunds" ("purchase_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" varchar(20) NOT NULL,
  "external_event_id" varchar(255) NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "status" varchar(20) DEFAULT 'received' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "safe_payload" jsonb,
  "error" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "processed_at" timestamp with time zone,
  CONSTRAINT "webhook_events_external_event_id_unique" UNIQUE ("provider", "external_event_id"),
  CONSTRAINT "webhook_events_status_check" CHECK ("status" IN ('received', 'processing', 'processed', 'failed'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_received_at_idx" ON "webhook_events" ("received_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "template" varchar(60) NOT NULL,
  "recipient_type" varchar(20) NOT NULL,
  "recipient" varchar(255),
  "booking_id" uuid,
  "purchase_id" uuid,
  "customer_package_id" uuid,
  "refund_id" uuid,
  "dedupe_key" varchar(200) NOT NULL,
  "context" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "provider_message_id" varchar(255),
  "error" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "email_logs_dedupe_key_unique" UNIQUE ("dedupe_key"),
  CONSTRAINT "email_logs_status_check" CHECK ("status" IN ('pending', 'sent', 'failed', 'skipped')),
  CONSTRAINT "email_logs_recipient_type_check" CHECK ("recipient_type" IN ('customer', 'owner', 'admin'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_logs_booking_idx" ON "email_logs" ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_logs_status_idx" ON "email_logs" ("status");--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Availability overrides and blocked time
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "availability_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_id" integer DEFAULT 1 NOT NULL REFERENCES "rooms"("id"),
  "date" date NOT NULL,
  "kind" varchar(20) NOT NULL,
  "is_closed" boolean DEFAULT true NOT NULL,
  "start_time" varchar(5),
  "end_time" varchar(5),
  "reason" varchar(255),
  "created_by" varchar(255),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "availability_overrides_room_date_unique" UNIQUE ("room_id", "date"),
  CONSTRAINT "availability_overrides_kind_check" CHECK ("kind" IN ('custom_hours', 'holiday', 'day_off', 'closure')),
  CONSTRAINT "availability_overrides_hours_check" CHECK (
    "is_closed" OR ("start_time" ~ '^\d{2}:\d{2}$' AND "end_time" ~ '^\d{2}:\d{2}$' AND "end_time" > "start_time")
  )
);--> statement-breakpoint
ALTER TABLE "blocked_times" ADD COLUMN IF NOT EXISTS "room_id" integer DEFAULT 1 NOT NULL REFERENCES "rooms"("id");--> statement-breakpoint
ALTER TABLE "blocked_times" ADD COLUMN IF NOT EXISTS "kind" varchar(20) DEFAULT 'block' NOT NULL;--> statement-breakpoint
ALTER TABLE "blocked_times" ADD COLUMN IF NOT EXISTS "series_id" uuid;--> statement-breakpoint
ALTER TABLE "blocked_times" ADD COLUMN IF NOT EXISTS "google_calendar_event_id" varchar(255);--> statement-breakpoint
ALTER TABLE "blocked_times" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "blocked_times" ADD COLUMN IF NOT EXISTS "deleted_by" varchar(255);--> statement-breakpoint
ALTER TABLE "blocked_times" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
-- NULL = stored by pre-CRM code (ET wall-clock saved as if it were UTC);
-- 2 = a real UTC instant. 0007 converts the NULL rows once.
ALTER TABLE "blocked_times" ADD COLUMN IF NOT EXISTS "tz_version" smallint;--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Rate limiting for public endpoints (hashed keys, no raw IPs)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "rate_limits" (
  "key" varchar(200) PRIMARY KEY NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "count" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Booking rule settings: insert the values the code already defaults to,
-- so they become editable without changing today's behaviour.
-- ---------------------------------------------------------------------
INSERT INTO "business_settings" ("setting_key", "setting_value") VALUES
  ('buffer_before_booking', '0'),
  ('buffer_after_booking', '0'),
  ('booking_increment_minutes', '30'),
  ('min_advance_notice_hours', '1'),
  ('max_booking_horizon_days', '90')
ON CONFLICT ("setting_key") DO NOTHING;
