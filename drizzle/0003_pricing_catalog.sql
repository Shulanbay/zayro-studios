-- Pricing catalog: photography services, monthly podcast packages and the
-- Free Studio Tour. Idempotent — every insert is skipped when a service with
-- that name (or, for the tour, any 'tour' service) already exists, and
-- existing prices are never touched. Runs in its own transaction after
-- 0002 has committed the new enum values.

-- Existing podcast sessions: display order only. Podcast Pro gets the agreed
-- feature list, but only if nobody has edited its original seed values.
UPDATE "services" SET "display_order" = 10 WHERE "name" = 'Single Podcaster' AND "category" = 'podcast' AND "display_order" = 0;--> statement-breakpoint
UPDATE "services" SET "display_order" = 20 WHERE "name" = 'Podcast Pro' AND "category" = 'podcast' AND "display_order" = 0;--> statement-breakpoint
UPDATE "services" SET "display_order" = 30 WHERE "name" = 'Full Podcast Package' AND "category" = 'podcast' AND "display_order" = 0;--> statement-breakpoint
UPDATE "services"
SET "description" = 'Our main professional podcast recording package.',
    "features" = '["Up to 3 cameras", "Up to 2 microphones", "Professional studio lighting", "Sound setup", "Producer / technician on site", "Raw files delivered"]'::jsonb
WHERE "name" = 'Podcast Pro' AND "category" = 'podcast'
  AND "features" = '["3 cameras", "2 microphones", "Recording Only"]'::jsonb;--> statement-breakpoint

-- Free Studio Tour
INSERT INTO "services" ("name", "description", "base_price", "duration_minutes", "category", "features", "is_active", "display_order")
SELECT 'Free Studio Tour',
       'Visit ZAYRO Studios before you book — see the space, the sets and the gear.',
       0, 30, 'tour',
       '["30-minute walkthrough", "See the podcast and photo setups", "No payment required"]'::jsonb,
       true, 100
WHERE NOT EXISTS (SELECT 1 FROM "services" WHERE "category" = 'tour');--> statement-breakpoint

-- Photography
INSERT INTO "services" ("name", "description", "base_price", "duration_minutes", "category", "features", "is_active", "display_order")
SELECT 'Headshot Session',
       'A focused studio headshot session for one person.',
       250, 45, 'photography',
       '["Up to 45 minutes", "One person, one look", "Professional studio lighting", "Posing guidance", "Online gallery to choose your shots", "3 professionally retouched photos", "Additional photos available separately"]'::jsonb,
       true, 10
WHERE NOT EXISTS (SELECT 1 FROM "services" WHERE "name" = 'Headshot Session');--> statement-breakpoint
INSERT INTO "services" ("name", "description", "base_price", "duration_minutes", "category", "features", "is_active", "display_order")
SELECT 'Studio Photoshoot',
       'A full studio photoshoot for personal branding, creative portraits and fashion content.',
       350, 90, 'photography',
       '["Up to 90 minutes", "Up to 2 looks", "Multiple lighting and backdrop setups", "Posing guidance", "Online gallery", "8 professionally retouched photos"]'::jsonb,
       true, 20
WHERE NOT EXISTS (SELECT 1 FROM "services" WHERE "name" = 'Studio Photoshoot');--> statement-breakpoint
INSERT INTO "services" ("name", "description", "base_price", "duration_minutes", "category", "features", "is_active", "display_order", "is_featured", "badge")
SELECT 'Brand Content Session',
       'Headshots, portraits and lifestyle content for your website and social media.',
       550, 120, 'photography',
       '["Up to 2 hours", "Up to 3 looks", "Multiple lighting setups", "Headshots and portraits", "Lifestyle and personal-brand content", "Photos for your website and social media", "Online gallery", "15 professionally retouched photos"]'::jsonb,
       true, 30, true, 'Most Popular'
WHERE NOT EXISTS (SELECT 1 FROM "services" WHERE "name" = 'Brand Content Session');--> statement-breakpoint

-- Monthly packages: Studio Recording Membership (priced from Podcast Pro)
INSERT INTO "services" ("name", "description", "base_price", "duration_minutes", "category", "features", "is_active", "display_order", "is_featured", "badge", "session_count", "validity_days", "package_type", "package_base_service_id")
SELECT v.name, v.description, v.price, 60, 'package', f.features::jsonb, true, v.ord, v.featured, v.badge, v.sessions, 30, 'studio_recording',
       (SELECT "id" FROM "services" WHERE "name" = 'Podcast Pro' AND "category" = 'podcast' ORDER BY "id" LIMIT 1)
FROM (VALUES
  ('2 Sessions per Month', 'Two Podcast Pro recording sessions, prepaid for one month.', 360, 2, 10, false, NULL),
  ('4 Sessions per Month', 'Four Podcast Pro recording sessions, prepaid for one month.', 680, 4, 20, true, 'Most Popular'),
  ('8 Sessions per Month', 'Eight Podcast Pro recording sessions, prepaid for one month.', 1280, 8, 30, false, NULL)
) AS v(name, description, price, sessions, ord, featured, badge)
CROSS JOIN LATERAL (SELECT '["Podcast Pro session each time", "Up to 3 cameras", "Up to 2 microphones", "Studio setup, lighting and sound", "Technician / producer on site", "Raw files after every session"]' AS features) f
WHERE NOT EXISTS (SELECT 1 FROM "services" s WHERE s."name" = v.name);--> statement-breakpoint

-- Monthly packages: Full Production Membership (priced from Full Podcast Package)
INSERT INTO "services" ("name", "description", "base_price", "duration_minutes", "category", "features", "is_active", "display_order", "is_featured", "badge", "session_count", "validity_days", "package_type", "package_base_service_id")
SELECT v.name, v.description, v.price, 60, 'package', f.features::jsonb, true, v.ord, v.featured, v.badge, v.sessions, 30, 'full_production',
       (SELECT "id" FROM "services" WHERE "name" = 'Full Podcast Package' AND "category" = 'podcast' ORDER BY "id" LIMIT 1)
FROM (VALUES
  ('2 Full Production Sessions', 'Two Full Podcast Package sessions, prepaid for one month.', 810, 2, 10, false, NULL),
  ('4 Full Production Sessions', 'Four Full Podcast Package sessions, prepaid for one month.', 1530, 4, 20, true, 'Best Value'),
  ('8 Full Production Sessions', 'Eight Full Podcast Package sessions, prepaid for one month.', 2880, 8, 30, false, NULL)
) AS v(name, description, price, sessions, ord, featured, badge)
CROSS JOIN LATERAL (SELECT '["Full Podcast Package session each time", "Recording + professional editing per session", "Same editing scope as the single Full Podcast Package"]' AS features) f
WHERE NOT EXISTS (SELECT 1 FROM "services" s WHERE s."name" = v.name);
