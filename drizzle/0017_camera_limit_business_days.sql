-- Owner decisions (2026-11-11). Additive and idempotent; prices and
-- purchase snapshots are never touched.

-- 1. Cameras each podcast package already includes. The server allows
--    Additional Camera only up to 3 cameras per session (lib/bookingOptions.ts
--    → addonLimit): Single Podcaster may add 2, Podcast Pro and the Full
--    Podcast Package none. Only set where the CRM hasn't set it.
UPDATE "services" SET "metadata" = "metadata" || '{"includedCameras": 1}'::jsonb, "updated_at" = now()
 WHERE "name" = 'Single Podcaster' AND "category" = 'podcast' AND NOT ("metadata" ? 'includedCameras');--> statement-breakpoint
UPDATE "services" SET "metadata" = "metadata" || '{"includedCameras": 3}'::jsonb, "updated_at" = now()
 WHERE "name" IN ('Podcast Pro', 'Full Podcast Package') AND "category" = 'podcast' AND NOT ("metadata" ? 'includedCameras');--> statement-breakpoint

-- 2. Edited episodes are delivered within 3 business days. Replaces only the
--    exact bullet written by 0016, keeping its position in the list.
UPDATE "services"
   SET "features" = (
         SELECT jsonb_agg(CASE WHEN f = 'Edited full episode within 3 days' THEN 'Your edited episode will be delivered within 3 business days.' ELSE f END ORDER BY ord)
           FROM jsonb_array_elements_text("features") WITH ORDINALITY AS t(f, ord)
       ),
       "updated_at" = now()
 WHERE "name" = 'Full Podcast Package' AND "category" = 'podcast'
   AND "features" @> '["Edited full episode within 3 days"]'::jsonb;
