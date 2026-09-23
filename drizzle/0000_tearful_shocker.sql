DO $$ BEGIN
 CREATE TYPE "day_of_week" AS ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "booking_status" AS ENUM('pending', 'payment_pending', 'confirmed', 'cancelled', 'completed', 'refunded');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "hold_status" AS ENUM('active', 'converted_to_booking', 'expired', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "integration_status" AS ENUM('pending', 'success', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "integration_type" AS ENUM('stripe', 'google_calendar', 'google_sheets', 'email');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "service_category" AS ENUM('podcast', 'video', 'livestream', 'editing');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_of_week" "day_of_week" NOT NULL,
	"start_time" varchar(5) NOT NULL,
	"end_time" varchar(5) NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blocked_times" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"start_datetime" timestamp with time zone NOT NULL,
	"end_datetime" timestamp with time zone NOT NULL,
	"reason" varchar(255),
	"created_by" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" varchar(20) NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_id" integer NOT NULL,
	"booking_date" date NOT NULL,
	"start_time" varchar(5) NOT NULL,
	"end_time" varchar(5) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"customer_first_name" varchar(255) NOT NULL,
	"customer_last_name" varchar(255) NOT NULL,
	"customer_email" varchar(255) NOT NULL,
	"customer_phone" varchar(20) NOT NULL,
	"company_name" varchar(255),
	"notes" text,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"tax_amount" numeric(10, 2) NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"payment_status" "payment_status" DEFAULT 'pending' NOT NULL,
	"stripe_payment_id" varchar(255),
	"stripe_session_id" varchar(255),
	"google_calendar_event_id" varchar(255),
	"google_sheets_row_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "bookings_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "bookings_stripe_payment_id_unique" UNIQUE("stripe_payment_id"),
	CONSTRAINT "bookings_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"setting_key" varchar(255) NOT NULL,
	"setting_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "business_settings_setting_key_unique" UNIQUE("setting_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"first_name" varchar(255),
	"last_name" varchar(255),
	"phone" varchar(20),
	"company" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_type" "integration_type" NOT NULL,
	"booking_id" uuid,
	"status" "integration_status" NOT NULL,
	"error_message" text,
	"response_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"stripe_payment_id" varchar(255) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "payments_stripe_payment_id_unique" UNIQUE("stripe_payment_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"base_price" numeric(10, 2) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"category" "service_category" DEFAULT 'podcast' NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "temporary_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_email" varchar(255) NOT NULL,
	"service_id" integer NOT NULL,
	"booking_date" date NOT NULL,
	"start_time" varchar(5) NOT NULL,
	"end_time" varchar(5) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"status" "hold_status" DEFAULT 'active' NOT NULL,
	"hold_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "availability_day_of_week_idx" ON "availability" ("day_of_week");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blocked_times_start_datetime_idx" ON "blocked_times" ("start_datetime");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blocked_times_end_datetime_idx" ON "blocked_times" ("end_datetime");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_customer_id_idx" ON "bookings" ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_booking_id_idx" ON "bookings" ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_booking_date_idx" ON "bookings" ("booking_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_stripe_payment_id_idx" ON "bookings" ("stripe_payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_status_idx" ON "bookings" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_settings_key_idx" ON "business_settings" ("setting_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_email_idx" ON "customers" ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_logs_booking_id_idx" ON "integration_logs" ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_logs_type_idx" ON "integration_logs" ("integration_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_booking_id_idx" ON "payments" ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_stripe_id_idx" ON "payments" ("stripe_payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "services_category_idx" ON "services" ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holds_booking_date_idx" ON "temporary_holds" ("booking_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holds_expires_at_idx" ON "temporary_holds" ("hold_expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holds_status_idx" ON "temporary_holds" ("status");