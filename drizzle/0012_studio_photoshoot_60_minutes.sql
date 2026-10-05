-- Owner request (2026-10-05): Studio Photoshoot is 1 hour, not 90 minutes.
-- The price stays the same. Only the untouched values are changed; existing
-- bookings keep the length they were booked with.
UPDATE "services" SET "duration_minutes" = 60, "updated_at" = now()
 WHERE "name" = 'Studio Photoshoot' AND "category" = 'photography' AND "duration_minutes" = 90;--> statement-breakpoint

UPDATE "services"
   SET "features" = (
         SELECT jsonb_agg(CASE WHEN f = '"Up to 90 minutes"'::jsonb THEN '"Up to 1 hour"'::jsonb ELSE f END ORDER BY ord)
           FROM jsonb_array_elements("features") WITH ORDINALITY AS t(f, ord)
       ),
       "updated_at" = now()
 WHERE "name" = 'Studio Photoshoot' AND "category" = 'photography'
   AND jsonb_typeof("features") = 'array' AND "features" @> '["Up to 90 minutes"]'::jsonb;
