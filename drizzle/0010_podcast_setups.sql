-- The four podcast setups customers choose between while booking.
-- Additive and idempotent. The studio is still one room: a booking holds
-- the room whichever setup it uses.
INSERT INTO "setups" ("room_id", "slug", "name", "description", "capacity", "sort_order", "metadata") VALUES
  (1, 'sofa-lounge', 'Sofa Lounge', 'Curved sofa and armchair around a stone table, with warm arched niches.', 3, 1,
   '{"image": "/setups/sofa-lounge.webp", "categories": ["podcast"]}'::jsonb),
  (1, 'cream-lounge', 'Cream Lounge', 'Two boucle armchairs facing each other, soft cream tones and wood slats.', 2, 2,
   '{"image": "/setups/cream-lounge.webp", "categories": ["podcast"]}'::jsonb),
  (1, 'garden-lounge', 'Garden Lounge', 'Two armchairs in front of a sculpted wall and greenery.', 2, 3,
   '{"image": "/setups/garden-lounge.webp", "categories": ["podcast"]}'::jsonb),
  (1, 'library-table', 'Library Table', 'Round wooden table with two chairs in front of a lit bookshelf.', 2, 4,
   '{"image": "/setups/library-table.webp", "categories": ["podcast"]}'::jsonb)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

-- The generic placeholder set is replaced by the four real ones (kept, not deleted: bookings may reference it).
UPDATE "setups" SET "active" = false, "updated_at" = now() WHERE "slug" = 'podcast-set' AND "active" = true;--> statement-breakpoint

UPDATE "setups" SET "metadata" = "metadata" || '{"categories": ["photography"]}'::jsonb
 WHERE "slug" = 'photo-studio' AND NOT ("metadata" ? 'categories');
