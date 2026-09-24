-- CRM, step 3 of 4: seed data and backfill of existing production rows.
-- Every statement only touches rows that haven't been processed yet, so
-- re-running is a no-op. Existing prices, bookings, payments and logs are
-- never modified except for the new CRM columns.

-- ---------------------------------------------------------------------
-- System roles (permissions are kept in sync with src/lib/crm/permissions.ts;
-- existing rows are left alone so a later edit is never overwritten).
-- ---------------------------------------------------------------------
INSERT INTO "roles" ("name", "description", "is_system", "permissions") VALUES
  ('Owner', 'Full access, including team, security and settings.', true, '["*"]'::jsonb),
  ('Studio Manager', 'Runs the studio: bookings, customers, purchases, refunds, services, availability and reports.', true,
   '["bookings.read","bookings.create","bookings.update","bookings.cancel","bookings.refund","customers.read","customers.update","customers.merge","notes.write","purchases.read","purchases.create","packages.read","packages.manage","services.manage","availability.manage","reports.read","reports.export","integrations.read","integrations.retry"]'::jsonb),
  ('Producer', 'Runs sessions: calendar, sessions, customer details and notes. No money, team or security.', true,
   '["bookings.read","bookings.create","bookings.update","customers.read","notes.write","packages.read"]'::jsonb),
  ('Operator', 'Read-only access to sessions, the calendar and customer basics.', true,
   '["bookings.read","customers.read"]'::jsonb)
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Setups in the single room (informational; the public flow is unchanged)
-- ---------------------------------------------------------------------
INSERT INTO "setups" ("room_id", "slug", "name", "description", "capacity", "sort_order") VALUES
  (1, 'podcast-set', 'Podcast Set', 'Up to 3 cameras, 2 microphones, studio lighting.', 4, 10),
  (1, 'photo-studio', 'Photo Studio', 'Backdrops and lighting for headshots and brand shoots.', 6, 20)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Customers: normalised email (the trigger covers new rows)
-- ---------------------------------------------------------------------
UPDATE "customers" SET "normalized_email" = lower(btrim("email")) WHERE "normalized_email" IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Services: URL-safe slug, unique (id appended on a name collision)
-- ---------------------------------------------------------------------
WITH base AS (
  SELECT "id",
         coalesce(nullif(btrim(regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'service') AS slug
    FROM "services"
   WHERE "slug" IS NULL
), ranked AS (
  SELECT b."id", b.slug,
         row_number() OVER (PARTITION BY b.slug ORDER BY b."id") AS rn,
         EXISTS (SELECT 1 FROM "services" s WHERE s."slug" = b.slug) AS taken
    FROM base b
)
UPDATE "services" s
   SET "slug" = CASE WHEN r.rn = 1 AND NOT r.taken THEN r.slug ELSE r.slug || '-' || r."id" END
  FROM ranked r
 WHERE s."id" = r."id";--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Bookings: UTC range (same formula as the trigger) and source
-- ---------------------------------------------------------------------
UPDATE "bookings"
   SET "starts_at" = ("booking_date" + "start_time"::time) AT TIME ZONE 'America/New_York',
       "ends_at" = ("booking_date" + "end_time"::time
                    + CASE WHEN "end_time" <= "start_time" THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'America/New_York'
 WHERE ("starts_at" IS NULL OR "ends_at" IS NULL)
   AND "start_time" ~ '^\d{1,2}:\d{2}$' AND "end_time" ~ '^\d{1,2}:\d{2}$';--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "bookings" WHERE "starts_at" IS NULL OR "ends_at" IS NULL) THEN
    ALTER TABLE "bookings" ALTER COLUMN "starts_at" SET NOT NULL;
    ALTER TABLE "bookings" ALTER COLUMN "ends_at" SET NOT NULL;
  ELSE
    RAISE NOTICE 'bookings.starts_at left nullable: some rows have unparseable times';
  END IF;
END $$;--> statement-breakpoint
UPDATE "bookings" b SET "source" = 'studio_tour'
  FROM "services" s
 WHERE s."id" = b."service_id" AND s."category" = 'tour' AND b."source" = 'individual';--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Purchases: one per existing booking, with an immutable line-item
-- snapshot of the price that was actually charged (the booking's own
-- subtotal/tax/total), never the service's current price.
-- ---------------------------------------------------------------------
INSERT INTO "purchases" (
  "order_number", "customer_id", "type", "status", "subtotal_cents", "tax_cents", "total_cents",
  "refunded_cents", "currency", "payment_method", "stripe_checkout_session_id", "stripe_payment_intent_id",
  "needs_refund_review", "review_reason", "purchased_at", "created_at", "updated_at"
)
SELECT
  'ZO-' || regexp_replace(b."booking_id", '^ZAY-', ''),
  CASE WHEN EXISTS (SELECT 1 FROM "customers" c WHERE c."id" = b."customer_id") THEN b."customer_id" END,
  CASE WHEN s."category" = 'tour' THEN 'studio_tour' ELSE 'individual' END,
  CASE
    WHEN b."payment_status" = 'refunded' THEN 'refunded'
    WHEN b."payment_status" = 'failed' THEN 'failed'
    WHEN b."payment_status" = 'succeeded' AND b."total_amount" > 0 THEN 'paid'
    WHEN b."payment_status" = 'succeeded' THEN 'approved'
    WHEN b."status" = 'cancelled' THEN 'cancelled'
    ELSE 'pending'
  END,
  round(b."subtotal" * 100)::int,
  round(b."tax_amount" * 100)::int,
  round(b."total_amount" * 100)::int,
  CASE WHEN b."payment_status" = 'refunded' THEN round(b."total_amount" * 100)::int ELSE 0 END,
  'USD',
  CASE WHEN b."total_amount" > 0 THEN 'stripe' ELSE 'comp' END,
  b."stripe_session_id",
  b."stripe_payment_id",
  (b."status" = 'cancelled' AND b."payment_status" = 'succeeded' AND b."total_amount" > 0),
  CASE WHEN b."status" = 'cancelled' AND b."payment_status" = 'succeeded' AND b."total_amount" > 0
       THEN 'Paid booking was cancelled before the CRM existed; check whether it was refunded in Stripe' END,
  CASE WHEN b."payment_status" IN ('succeeded', 'refunded')
       THEN coalesce((SELECT max(p."updated_at") FROM "payments" p WHERE p."booking_id" = b."id" AND p."status" IN ('succeeded', 'refunded')),
                     b."updated_at", b."created_at") END,
  b."created_at",
  now()
FROM "bookings" b
JOIN "services" s ON s."id" = b."service_id"
WHERE b."purchase_id" IS NULL
ON CONFLICT ("order_number") DO NOTHING;--> statement-breakpoint
INSERT INTO "purchase_items" (
  "purchase_id", "item_type", "reference_id", "description_snapshot", "quantity", "unit_price_cents", "total_cents", "metadata", "created_at"
)
SELECT p."id", 'service', b."service_id"::text,
       s."name" || ' — ' || to_char(b."booking_date", 'YYYY-MM-DD') || ' ' || b."start_time" || '–' || b."end_time" || ' ET',
       1,
       round(b."subtotal" * 100)::int,
       round(b."subtotal" * 100)::int,
       jsonb_build_object('backfilled', true, 'bookingId', b."booking_id", 'serviceName', s."name",
                          'category', s."category"::text, 'durationMinutes', b."duration_minutes"),
       b."created_at"
  FROM "bookings" b
  JOIN "services" s ON s."id" = b."service_id"
  JOIN "purchases" p ON p."order_number" = 'ZO-' || regexp_replace(b."booking_id", '^ZAY-', '')
 WHERE b."purchase_id" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "purchase_items" i WHERE i."purchase_id" = p."id");--> statement-breakpoint
UPDATE "bookings" b
   SET "purchase_id" = p."id"
  FROM "purchases" p
 WHERE b."purchase_id" IS NULL
   AND p."order_number" = 'ZO-' || regexp_replace(b."booking_id", '^ZAY-', '');--> statement-breakpoint
-- Paid-after-cancel bookings need the same review flag as their purchase.
UPDATE "bookings" SET "needs_refund_review" = true,
       "review_reason" = 'Paid booking was cancelled before the CRM existed; check whether it was refunded in Stripe'
 WHERE "status" = 'cancelled' AND "payment_status" = 'succeeded' AND "total_amount" > 0 AND NOT "needs_refund_review";--> statement-breakpoint
UPDATE "bookings" SET "cancelled_at" = "updated_at" WHERE "status" = 'cancelled' AND "cancelled_at" IS NULL;--> statement-breakpoint
UPDATE "bookings" SET "completed_at" = "updated_at" WHERE "status" = 'completed' AND "completed_at" IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Customer stats (the app refreshes them after every change)
-- ---------------------------------------------------------------------
UPDATE "customers" c SET
  "total_spent_cents" = coalesce((
    SELECT sum(p."total_cents" - p."refunded_cents") FROM "purchases" p
     WHERE p."customer_id" = c."id" AND p."status" IN ('paid', 'partially_refunded', 'refunded')), 0),
  "booking_count" = (
    SELECT count(*) FROM "bookings" b
     WHERE b."customer_id" = c."id" AND b."status" IN ('confirmed', 'completed', 'no_show')),
  "last_booking_at" = (
    SELECT max(b."starts_at") FROM "bookings" b
     WHERE b."customer_id" = c."id" AND b."status" IN ('confirmed', 'completed', 'no_show'));--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Package plans from the existing monthly-package services
-- ---------------------------------------------------------------------
INSERT INTO "package_plans" ("service_id", "name", "slug", "package_type", "description", "total_credits", "validity_days", "price_cents", "active", "sort_order")
SELECT s."id", s."name", coalesce(s."slug", 'package-' || s."id"), s."package_type", s."description",
       s."session_count", coalesce(s."validity_days", 30), round(s."base_price" * 100)::int, s."is_active", s."display_order"
  FROM "services" s
 WHERE s."category" = 'package' AND coalesce(s."session_count", 0) > 0
ON CONFLICT ("service_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "package_plan_items" ("plan_id", "service_id", "credits")
SELECT pp."id", s."package_base_service_id", pp."total_credits"
  FROM "package_plans" pp
  JOIN "services" s ON s."id" = pp."service_id"
 WHERE s."package_base_service_id" IS NOT NULL
   AND EXISTS (SELECT 1 FROM "services" b WHERE b."id" = s."package_base_service_id")
ON CONFLICT ("plan_id", "service_id") DO NOTHING;--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Blocked time: pre-CRM rows hold the owner's ET wall-clock time stored as
-- if it were UTC (the admin form's datetime-local value parsed on a UTC
-- server). Reinterpret each one as America/New_York so it keeps blocking
-- the hours the owner meant. Runs once per row (tz_version).
-- ---------------------------------------------------------------------
UPDATE "blocked_times"
   SET "start_datetime" = ("start_datetime" AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York',
       "end_datetime" = ("end_datetime" AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York',
       "tz_version" = 2
 WHERE "tz_version" IS NULL;--> statement-breakpoint
ALTER TABLE "blocked_times" ALTER COLUMN "tz_version" SET DEFAULT 2;--> statement-breakpoint

-- ---------------------------------------------------------------------
-- One live customer per normalised email — only enforced when the data
-- already satisfies it; otherwise duplicates are merged in the CRM first.
-- ---------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "customers" WHERE "status" <> 'merged' GROUP BY "normalized_email" HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "customers_normalized_email_live_unique"
      ON "customers" ("normalized_email") WHERE "status" <> 'merged';
  ELSE
    RAISE NOTICE 'customers_normalized_email_live_unique not created: duplicate customers exist (merge them in the CRM)';
  END IF;
END $$;
