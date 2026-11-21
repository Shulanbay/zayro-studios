-- X (Twitter) Ads destinations for the analytics delivery queue.
-- Additive and idempotent: widens one CHECK constraint, no data changes.
ALTER TABLE "analytics_deliveries" DROP CONSTRAINT IF EXISTS "analytics_deliveries_destination_check";--> statement-breakpoint
ALTER TABLE "analytics_deliveries" ADD CONSTRAINT "analytics_deliveries_destination_check" CHECK ("destination" IN (
  'ga4', 'google_ads', 'meta_pixel', 'meta_capi', 'reddit_pixel', 'reddit_capi',
  'pinterest_tag', 'pinterest_capi', 'tiktok_pixel', 'tiktok_events_api', 'x_pixel', 'x_capi'
));
