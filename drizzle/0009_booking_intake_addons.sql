-- Booking intake questions, hourly sessions and priced add-ons.
-- Additive and idempotent: new table, new defaulted columns, two CHECK
-- constraints widened by one value each. Existing rows are not rewritten.

CREATE TABLE IF NOT EXISTS "service_addons" (
  "id" serial PRIMARY KEY,
  "slug" varchar(80) NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" text,
  "price_cents" integer NOT NULL,
  -- 'session': charged once per booking; 'hour': charged per booked hour.
  "unit" varchar(10) NOT NULL DEFAULT 'session',
  "max_quantity" integer NOT NULL DEFAULT 1,
  -- Service categories this add-on can be bought with.
  "categories" jsonb NOT NULL DEFAULT '["podcast"]'::jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "service_addons_slug_unique" UNIQUE ("slug"),
  CONSTRAINT "service_addons_unit_check" CHECK ("unit" IN ('session', 'hour')),
  CONSTRAINT "service_addons_price_check" CHECK ("price_cents" >= 0),
  CONSTRAINT "service_addons_quantity_check" CHECK ("max_quantity" BETWEEN 1 AND 20)
);--> statement-breakpoint

INSERT INTO "service_addons" ("slug", "name", "description", "price_cents", "unit", "max_quantity", "sort_order") VALUES
  ('full-podcast-editing', 'Full Podcast Editing', 'Professional edit of your recorded episode.', 20000, 'session', 1, 10),
  ('studio-photoshoot', 'Professional Studio Photoshoot', 'A studio photoshoot added to your session.', 35000, 'session', 1, 20),
  ('additional-microphone', 'Additional Microphone', 'One more microphone for an extra speaker.', 2500, 'hour', 4, 30),
  ('additional-camera', 'Additional Camera', 'One more camera angle.', 5000, 'hour', 3, 40),
  ('social-clips-3', '3 Social Media Clips', 'Three short clips cut from your session for social media.', 15000, 'session', 1, 50),
  ('express-editing', 'Express Editing', 'Priority turnaround for your edit.', 15000, 'session', 1, 60),
  ('teleprompter', 'Teleprompter', 'Teleprompter set up for your recording.', 3000, 'hour', 1, 70),
  ('livestream-setup', 'Livestream Setup', 'Live streaming set up for your session.', 15000, 'hour', 1, 80),
  ('social-clips-10', '10 Social Media Clips', 'Ten short clips cut from your session for social media.', 40000, 'session', 1, 90),
  ('behind-the-scenes', 'Behind the Scenes Photos and Videos', 'Behind-the-scenes photos and video of your session.', 7500, 'session', 1, 100),
  ('professional-headshots', 'Professional Headshots', 'Headshots taken during your visit.', 25000, 'session', 1, 110)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

-- Answers to the booking questions (people, recording type, editing, project, guests).
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "intake" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint

-- What a hold was quoted for: number of hours and add-ons (server-validated).
ALTER TABLE "temporary_holds" ADD COLUMN IF NOT EXISTS "selection" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint

-- Purchase line items may now be add-ons.
ALTER TABLE "purchase_items" DROP CONSTRAINT IF EXISTS "purchase_items_type_check";--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_type_check" CHECK ("item_type" IN ('service', 'package', 'adjustment', 'addon'));--> statement-breakpoint

-- Emails may now go to a booking's guests.
ALTER TABLE "email_logs" DROP CONSTRAINT IF EXISTS "email_logs_recipient_type_check";--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_recipient_type_check" CHECK ("recipient_type" IN ('customer', 'owner', 'admin', 'guest'));
--> statement-breakpoint

-- Owner request (2026-10-05): the Free Studio Tour is 15 minutes, not 30.
-- Only the untouched default is changed; existing bookings keep their length.
UPDATE "services" SET "duration_minutes" = 15, "updated_at" = now()
 WHERE "category" = 'tour' AND "name" = 'Free Studio Tour' AND "duration_minutes" = 30;
