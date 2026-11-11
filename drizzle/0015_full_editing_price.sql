-- Owner request (2026-11-11): Full Podcast Editing costs $250 (was $200).
-- Express Editing stays above it at $300. Only the untouched seeded price is
-- changed; purchases keep their own line-item snapshots.
UPDATE "service_addons" SET "price_cents" = 25000, "updated_at" = now()
 WHERE "slug" = 'full-podcast-editing' AND "price_cents" = 20000;
