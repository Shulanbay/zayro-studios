-- CRM, step 4 of 4: database-level double-booking protection.
--
-- The studio is one room. Two bookings that hold the room (confirmed,
-- completed or no-show) can never overlap in time, whatever code path
-- writes them. The application still takes a per-date advisory lock and
-- applies buffers; this constraint is the last line of defence.
--
-- Guarded twice so it can never fail the production build:
--  * btree_gist may not be installable → NOTICE, constraint skipped;
--  * existing overlapping rows would violate it → NOTICE, constraint
--    skipped. Admin → Integrations → Health shows whether it is installed.
DO $$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'btree_gist extension unavailable (%): overlap constraint skipped', SQLERRM;
    RETURN;
  END;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap') THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM "bookings" WHERE "starts_at" IS NULL OR "ends_at" IS NULL) THEN
    RAISE NOTICE 'bookings with no starts_at/ends_at exist: overlap constraint skipped';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "bookings" a
      JOIN "bookings" b ON a."id" < b."id" AND a."room_id" = b."room_id"
     WHERE a."status" IN ('confirmed', 'completed', 'no_show')
       AND b."status" IN ('confirmed', 'completed', 'no_show')
       AND tstzrange(a."starts_at", a."ends_at", '[)') && tstzrange(b."starts_at", b."ends_at", '[)')
  ) THEN
    RAISE NOTICE 'overlapping confirmed bookings exist: overlap constraint skipped (resolve them, then re-run this statement)';
    RETURN;
  END IF;

  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
    EXCLUDE USING gist ("room_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
    WHERE ("status" IN ('confirmed', 'completed', 'no_show'));
END $$;
