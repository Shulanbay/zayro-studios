-- Admin-panel language per team member (ru / kk / en). NULL = not chosen yet
-- (the role default applies: Russian for Marketing Analyst, else English).
-- Additive and idempotent: one nullable column, no data changes.
ALTER TABLE "admin_profiles" ADD COLUMN IF NOT EXISTS "locale" varchar(5);--> statement-breakpoint
ALTER TABLE "admin_profiles" DROP CONSTRAINT IF EXISTS "admin_profiles_locale_check";--> statement-breakpoint
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_locale_check" CHECK ("locale" IS NULL OR "locale" IN ('ru', 'kk', 'en'));
