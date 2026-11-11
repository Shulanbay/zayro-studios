-- Customer self-service (Manage Booking): secure management links, policy
-- acknowledgment, customer refunds and paid session extensions.
-- Additive and idempotent: new nullable columns, one new table, three CHECK
-- constraints widened by one value each. No existing row is rewritten
-- except the untouched seeded package copy at the end.

-- Management link: only a hash and a random nonce are stored. The link
-- itself is HMAC(secret, booking id + nonce), so a database copy alone can't
-- produce a working link. Rotating the nonce revokes the old link.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "manage_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "manage_token_nonce" varchar(64);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "manage_token_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "manage_token_revoked_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_manage_token_hash_unique" ON "bookings" ("manage_token_hash") WHERE "manage_token_hash" IS NOT NULL;--> statement-breakpoint

-- Which version of the studio policies the customer agreed to, and when.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "policy_version" varchar(40);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "policy_accepted_at" timestamp with time zone;--> statement-breakpoint

-- A hold can now reserve the time right after a booking while its
-- extension is being paid for. Old code ignores both columns; an
-- extension hold still blocks the slot like any other hold.
ALTER TABLE "temporary_holds" ADD COLUMN IF NOT EXISTS "kind" varchar(20) NOT NULL DEFAULT 'booking';--> statement-breakpoint
ALTER TABLE "temporary_holds" ADD COLUMN IF NOT EXISTS "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "temporary_holds" DROP CONSTRAINT IF EXISTS "temporary_holds_kind_check";--> statement-breakpoint
ALTER TABLE "temporary_holds" ADD CONSTRAINT "temporary_holds_kind_check" CHECK ("kind" IN ('booking', 'extension'));--> statement-breakpoint

-- Paid extra time on an existing booking. The money lives in its own
-- purchase (type 'extension') with immutable line items, so refunds,
-- reports and Stripe reconciliation work exactly as for any purchase.
CREATE TABLE IF NOT EXISTS "booking_extensions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id" uuid NOT NULL REFERENCES "bookings" ("id"),
  "purchase_id" uuid NOT NULL REFERENCES "purchases" ("id"),
  "hold_id" uuid,
  "added_minutes" integer NOT NULL,
  "previous_end_time" varchar(5) NOT NULL,
  "new_end_time" varchar(5) NOT NULL,
  "previous_duration_minutes" integer NOT NULL,
  "new_duration_minutes" integer NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "stripe_checkout_session_id" varchar(255),
  "stripe_payment_intent_id" varchar(255),
  "review_reason" text,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "booking_extensions_checkout_unique" UNIQUE ("stripe_checkout_session_id"),
  CONSTRAINT "booking_extensions_purchase_unique" UNIQUE ("purchase_id"),
  CONSTRAINT "booking_extensions_minutes_check" CHECK ("added_minutes" > 0 AND "new_duration_minutes" = "previous_duration_minutes" + "added_minutes"),
  CONSTRAINT "booking_extensions_status_check" CHECK ("status" IN ('pending', 'confirmed', 'cancelled', 'failed', 'needs_review'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_extensions_booking_idx" ON "booking_extensions" ("booking_id");--> statement-breakpoint

-- New purchase type for extensions.
ALTER TABLE "purchases" DROP CONSTRAINT IF EXISTS "purchases_type_check";--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_type_check" CHECK ("type" IN ('individual', 'package', 'studio_tour', 'manual', 'extension'));--> statement-breakpoint

-- Refunds requested by the customer from Manage Booking.
ALTER TABLE "refunds" DROP CONSTRAINT IF EXISTS "refunds_source_check";--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_source_check" CHECK ("source" IN ('admin', 'stripe', 'customer'));--> statement-breakpoint

-- Approved package copy (owner, 2026-11-11). Prices are never touched, and
-- only rows still holding the original seeded text are changed, so copy
-- edited in the CRM is kept.
UPDATE "services"
   SET "description" = 'Record a professional solo podcast or talking-head video with one camera, one broadcast-quality microphone, studio lighting and on-site technical support.',
       "features" = '["1 camera", "1 microphone", "1 on-camera participant", "Videographer / studio technician", "Camera and lighting setup", "Professional studio lighting", "Raw camera file and separate audio track", "Google Drive delivery within 24 hours"]'::jsonb,
       "updated_at" = now()
 WHERE "name" = 'Single Podcaster' AND "category" = 'podcast'
   AND "features" = '["1 camera", "1 microphone", "Recording Only"]'::jsonb;--> statement-breakpoint

UPDATE "services"
   SET "description" = 'Our most popular multi-camera podcast package, with up to three cameras, two microphones, professional lighting and an on-site technician.',
       "features" = '["Up to 3 cameras", "Up to 2 microphones", "Up to 6 people in the studio", "Professional lighting and sound setup", "Videographer / studio technician", "Raw camera files and separate audio tracks", "Google Drive delivery within 24 hours"]'::jsonb,
       "updated_at" = now()
 WHERE "name" = 'Podcast Pro' AND "category" = 'podcast'
   AND "features" = '["Up to 3 cameras", "Up to 2 microphones", "Professional studio lighting", "Sound setup", "Producer / technician on site", "Raw files delivered"]'::jsonb;--> statement-breakpoint

UPDATE "services" SET "badge" = 'Most Popular', "updated_at" = now()
 WHERE "name" = 'Podcast Pro' AND "category" = 'podcast' AND "badge" IS NULL;--> statement-breakpoint

UPDATE "services"
   SET "description" = 'Recording plus professional post-production, including multi-camera editing, audio cleanup, color correction and integration of your existing brand assets.',
       "features" = '["Up to 3 cameras and 2 microphones", "Up to 6 people in the studio", "Videographer / studio technician", "Raw files within 24 hours", "Edited full episode within 3 days", "Multi-camera sync and switching", "Audio cleanup and color correction", "Your logo, intro/outro and brand assets added", "2 revision rounds"]'::jsonb,
       "updated_at" = now()
 WHERE "name" = 'Full Podcast Package' AND "category" = 'podcast'
   AND "features" = '["Recording", "Professional Editing"]'::jsonb;
