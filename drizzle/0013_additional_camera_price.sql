-- Owner request (2026-10-05): Additional Camera costs $30 / hour (was $50).
-- Only the untouched seeded price is changed; purchases keep their snapshots.
UPDATE "service_addons" SET "price_cents" = 3000, "updated_at" = now()
 WHERE "slug" = 'additional-camera' AND "price_cents" = 5000;
