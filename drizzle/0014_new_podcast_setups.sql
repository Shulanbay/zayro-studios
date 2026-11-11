-- Owner request (2026-11-11): the studio now offers these four podcast setups.
-- Sofa Lounge keeps its row (and bookings) with a new photo and description.
-- Cream Lounge, Garden Lounge and Library Table are retired, not deleted:
-- past bookings reference them. Idempotent.
UPDATE "setups"
   SET "name" = 'Sofa Lounge',
       "description" = 'Curved cream sofa and two armchairs around a round oak table. Room for up to 4 voices.',
       "capacity" = 4,
       "sort_order" = 1,
       "active" = true,
       "metadata" = "metadata" || '{"image": "/setups/sofa-lounge.webp", "categories": ["podcast"]}'::jsonb,
       "updated_at" = now()
 WHERE "slug" = 'sofa-lounge';--> statement-breakpoint

INSERT INTO "setups" ("room_id", "slug", "name", "description", "capacity", "sort_order", "metadata") VALUES
  (1, 'conversation-corner', 'Conversation Corner', 'Two terracotta armchairs face to face, with warm wood slats and olive trees.', 2, 2,
   '{"image": "/setups/conversation-corner.webp", "categories": ["podcast"]}'::jsonb),
  (1, 'conference-table', 'Conference Table Setup', 'An oak table for up to 4, with lit shelves behind. Built for panels and business talks.', 4, 3,
   '{"image": "/setups/conference-table.webp", "categories": ["podcast"]}'::jsonb),
  (1, 'bookshelf', 'Bookshelf Setup', 'Two armchairs between tall styled bookshelves. A classic interview backdrop.', 2, 4,
   '{"image": "/setups/bookshelf.webp", "categories": ["podcast"]}'::jsonb)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

UPDATE "setups" SET "active" = false, "updated_at" = now()
 WHERE "slug" IN ('cream-lounge', 'garden-lounge', 'library-table') AND "active" = true;
