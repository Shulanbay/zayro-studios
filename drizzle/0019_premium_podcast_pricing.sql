-- Owner request (2026-11-19): premium repositioning of the three podcast packages.
-- Purchases keep their own line-item snapshots, so confirmed bookings and
-- payment history are never repriced. Idempotent (fixed values by name).
UPDATE "services" SET
  "name" = 'Solo Session', "base_price" = 200, "duration_minutes" = 60, "badge" = NULL,
  "description" = 'A premium single-host recording with cinema-grade video and audio.',
  "features" = '["1 Sony FX30 cinema camera", "1 professional microphone", "Professional studio lighting", "Premium studio setup", "Recording assistance", "RAW video and audio files"]'::jsonb,
  "metadata" = "metadata" || '{"minHours": 2, "pricingUnit": "hour"}'::jsonb, "updated_at" = now()
 WHERE "category" = 'podcast' AND "name" IN ('Single Podcaster', 'Solo Session');--> statement-breakpoint

UPDATE "services" SET
  "base_price" = 250, "duration_minutes" = 60, "badge" = 'Most Popular',
  "description" = 'Multi-camera podcast production with a dedicated camera and audio operator.',
  "features" = '["3 Sony FX30 cinema cameras", "2 professional microphones", "Professional cinematic lighting", "Dedicated camera/audio operator", "Multi-camera recording", "RAW video and audio files"]'::jsonb,
  "metadata" = "metadata" || '{"minHours": 2, "pricingUnit": "hour"}'::jsonb, "updated_at" = now()
 WHERE "category" = 'podcast' AND "name" = 'Podcast Pro';--> statement-breakpoint

UPDATE "services" SET
  "name" = 'Full Production', "base_price" = 550, "duration_minutes" = 120, "badge" = 'Premium Experience',
  "description" = 'A complete, professionally edited episode — recording, production and post-production.',
  "features" = '["Up to 2 hours of recording", "3 Sony FX30 cinema cameras", "2 professional microphones", "Dedicated production operator", "Professional lighting and audio", "Multi-camera video editing", "Audio enhancement", "Color correction", "1 professionally edited podcast episode", "1 revision round"]'::jsonb,
  "metadata" = ("metadata" - 'minHours') || '{"pricingUnit": "episode", "includesEditing": true}'::jsonb, "updated_at" = now()
 WHERE "category" = 'podcast' AND "name" IN ('Full Podcast Package', 'Full Production');
