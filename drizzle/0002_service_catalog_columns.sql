-- New service categories and catalog/display fields. Idempotent.
ALTER TYPE "service_category" ADD VALUE IF NOT EXISTS 'photography';--> statement-breakpoint
ALTER TYPE "service_category" ADD VALUE IF NOT EXISTS 'package';--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "is_featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "badge" varchar(40);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "session_count" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "validity_days" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "package_type" varchar(40);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "package_base_service_id" integer;
