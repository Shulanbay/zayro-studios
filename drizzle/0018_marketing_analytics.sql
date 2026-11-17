-- First-party marketing analytics, consent records, attribution snapshots,
-- external destination delivery state and the Marketing Analyst role.
-- Additive and idempotent: new tables only (IF NOT EXISTS), one role row
-- (ON CONFLICT DO NOTHING). No existing table or row is changed.
--
-- Privacy: no raw IP address, no full User-Agent, no customer contact data.
-- Visitor and session keys are stored only as HMAC hashes of the random
-- browser cookie values; advertising click IDs (gclid, fbclid, rdt_cid,
-- epik, ttclid) only AES-GCM encrypted, and only with Advertising consent.

CREATE TABLE IF NOT EXISTS "analytics_visitors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "anonymous_id_hash" varchar(64) NOT NULL,
  "first_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "first_landing_path" varchar(300),
  "first_referrer_host" varchar(255),
  "first_utm_source" varchar(150),
  "first_utm_medium" varchar(150),
  "first_utm_campaign" varchar(150),
  "first_utm_content" varchar(150),
  "first_utm_term" varchar(150),
  "first_channel" varchar(30),
  "first_click_id_types" varchar(100),
  "first_click_ids_encrypted" text,
  "consent_state" varchar(20) NOT NULL DEFAULT 'analytics',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_visitors_anonymous_id_hash_unique" UNIQUE ("anonymous_id_hash"),
  CONSTRAINT "analytics_visitors_consent_state_check" CHECK ("consent_state" IN ('analytics', 'advertising', 'denied'))
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "analytics_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_key_hash" varchar(64) NOT NULL,
  "visitor_id" uuid NOT NULL REFERENCES "analytics_visitors" ("id") ON DELETE CASCADE,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "landing_path" varchar(300),
  "exit_path" varchar(300),
  "referrer_host" varchar(255),
  "device_category" varchar(10),
  "first_touch_source" varchar(150),
  "first_touch_medium" varchar(150),
  "first_touch_campaign" varchar(150),
  "session_source" varchar(150),
  "session_medium" varchar(150),
  "session_campaign" varchar(150),
  "session_content" varchar(150),
  "session_term" varchar(150),
  "channel" varchar(30) NOT NULL DEFAULT 'direct',
  "platform" varchar(30) NOT NULL DEFAULT 'direct',
  "click_id_types" varchar(100),
  "click_ids_encrypted" text,
  "vendor_ids_encrypted" text,
  "page_view_count" integer NOT NULL DEFAULT 0,
  "engaged" boolean NOT NULL DEFAULT false,
  "converted" boolean NOT NULL DEFAULT false,
  "is_returning" boolean NOT NULL DEFAULT false,
  "consent_advertising" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_sessions_session_key_hash_unique" UNIQUE ("session_key_hash"),
  CONSTRAINT "analytics_sessions_device_check" CHECK ("device_category" IS NULL OR "device_category" IN ('desktop', 'mobile', 'tablet', 'other'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_sessions_visitor_idx" ON "analytics_sessions" ("visitor_id", "started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_sessions_started_idx" ON "analytics_sessions" ("started_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "analytics_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "external_event_id" varchar(80) NOT NULL,
  "visitor_id" uuid REFERENCES "analytics_visitors" ("id") ON DELETE SET NULL,
  "session_id" uuid REFERENCES "analytics_sessions" ("id") ON DELETE SET NULL,
  "booking_id" uuid,
  "purchase_id" uuid,
  "event_name" varchar(60) NOT NULL,
  "event_version" smallint NOT NULL DEFAULT 1,
  "source" varchar(10) NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "page_path" varchar(300),
  "properties" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "value_cents" integer,
  "currency" varchar(3),
  "consent_analytics" boolean NOT NULL DEFAULT false,
  "consent_advertising" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_events_external_event_id_unique" UNIQUE ("external_event_id"),
  CONSTRAINT "analytics_events_source_check" CHECK ("source" IN ('browser', 'server'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_name_time_idx" ON "analytics_events" ("event_name", "occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_session_idx" ON "analytics_events" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_booking_idx" ON "analytics_events" ("booking_id") WHERE "booking_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_occurred_idx" ON "analytics_events" ("occurred_at");--> statement-breakpoint

-- One acquisition snapshot per booking, written once when the booking is
-- created (Checkout start or free confirmation) and never rewritten.
CREATE TABLE IF NOT EXISTS "analytics_attributions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id" uuid NOT NULL,
  "purchase_id" uuid,
  "visitor_id" uuid REFERENCES "analytics_visitors" ("id") ON DELETE SET NULL,
  "session_id" uuid REFERENCES "analytics_sessions" ("id") ON DELETE SET NULL,
  "first_touch" jsonb,
  "last_non_direct_touch" jsonb,
  "conversion_touch" jsonb,
  "click_ids_encrypted" text,
  "vendor_ids_encrypted" text,
  "consent_analytics" boolean NOT NULL DEFAULT false,
  "consent_advertising" boolean NOT NULL DEFAULT false,
  "attribution_window_days" integer NOT NULL DEFAULT 90,
  "attributed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_attributions_booking_unique" UNIQUE ("booking_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_attributions_purchase_idx" ON "analytics_attributions" ("purchase_id") WHERE "purchase_id" IS NOT NULL;--> statement-breakpoint

-- Delivery state of one event to one external destination. The pair is
-- unique, so a duplicate webhook or a retry can never queue a second send.
CREATE TABLE IF NOT EXISTS "analytics_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "analytics_event_id" uuid NOT NULL REFERENCES "analytics_events" ("id") ON DELETE CASCADE,
  "destination" varchar(30) NOT NULL,
  "channel" varchar(10) NOT NULL DEFAULT 'server',
  "external_event_id" varchar(80) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error_sanitized" varchar(300),
  "test_mode" boolean NOT NULL DEFAULT false,
  "next_retry_at" timestamp with time zone NOT NULL DEFAULT now(),
  "locked_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_deliveries_event_destination_unique" UNIQUE ("analytics_event_id", "destination"),
  CONSTRAINT "analytics_deliveries_destination_check" CHECK ("destination" IN (
    'ga4', 'google_ads', 'meta_pixel', 'meta_capi', 'reddit_pixel', 'reddit_capi',
    'pinterest_tag', 'pinterest_capi', 'tiktok_pixel', 'tiktok_events_api')),
  CONSTRAINT "analytics_deliveries_channel_check" CHECK ("channel" IN ('server', 'browser')),
  CONSTRAINT "analytics_deliveries_status_check" CHECK ("status" IN ('pending', 'delivered', 'failed', 'dead', 'skipped'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_deliveries_due_idx" ON "analytics_deliveries" ("status", "next_retry_at");--> statement-breakpoint

-- Proof of each consent choice: version, categories and time, keyed by a
-- random consent identifier (never an email, IP or visitor ID).
CREATE TABLE IF NOT EXISTS "analytics_consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "consent_id_hash" varchar(64) NOT NULL,
  "consent_version" varchar(20) NOT NULL,
  "analytics" boolean NOT NULL,
  "advertising" boolean NOT NULL,
  "action" varchar(20) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "analytics_consents_action_check" CHECK ("action" IN ('accept_all', 'reject_all', 'custom', 'withdraw'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_consents_created_idx" ON "analytics_consents" ("created_at");--> statement-breakpoint

-- Marketing Analyst: aggregate analytics only. Kept in sync with
-- src/lib/crm/permissions.ts; an existing row is never overwritten.
INSERT INTO "roles" ("name", "description", "is_system", "permissions") VALUES
  ('Marketing Analyst', 'Aggregated marketing analytics and anonymised exports only. No customers, bookings, payments, prices or settings.', true,
   '["analytics.read","analytics.export"]'::jsonb)
ON CONFLICT ("name") DO NOTHING;
