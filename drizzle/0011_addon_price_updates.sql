-- Owner request (2026-10-05):
--  * Professional Studio Photoshoot is charged per hour ($350 / hour), not per session.
--  * Express Editing costs $300 (it must cost more than Full Podcast Editing at $200).
-- Only rows still at their seeded values are changed, so edits made in the
-- CRM are never overwritten. Purchases keep their own line-item snapshots.
UPDATE "service_addons" SET "unit" = 'hour', "updated_at" = now()
 WHERE "slug" = 'studio-photoshoot' AND "unit" = 'session' AND "price_cents" = 35000;--> statement-breakpoint

UPDATE "service_addons" SET "price_cents" = 30000, "updated_at" = now()
 WHERE "slug" = 'express-editing' AND "price_cents" = 15000;
