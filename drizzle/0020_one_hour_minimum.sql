-- Owner decision (2026-11-19): the minimum booking is 1 hour, not 2.
-- Removes the minHours setting added by 0019; prices stay as they are.
-- Idempotent; bookings and purchases are not touched.
UPDATE "services" SET "metadata" = "metadata" - 'minHours', "updated_at" = now()
 WHERE "category" = 'podcast' AND "name" IN ('Solo Session', 'Podcast Pro') AND "metadata" ? 'minHours';
