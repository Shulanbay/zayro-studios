# Marketing and conversion analytics

## Architecture

```
Browser (public pages only)                       Server (Next.js routes, post-commit)
───────────────────────────                       ────────────────────────────────────
Consent banner ── zayro_consent cookie            checkout created  ─┐
Consent Mode v2 defaults (denied) → GTM           free tour/booking ─┤  hooks.ts (never throws)
trackEvent()  ── /api/analytics/collect ───────▶  Stripe webhook   ─┤  ├─ analytics_events (unique ID)
   ├─ dataLayer (GA4 via GTM, Analytics consent)  contact accepted ─┤  ├─ analytics_attributions (once/booking)
   └─ pixels (Advertising consent)                refund succeeded ─┘  └─ analytics_deliveries (unique event+dest)
trackConversion() ← verified success page /                                   │
   contact response, same event ID as server                     processDueDeliveries() → GA4 MP, Meta CAPI,
                                                                 Reddit CAPI, Pinterest CAPI, TikTok Events API
                                                                 (retry job: /api/analytics/deliveries)
Postgres (Neon) is the source of truth for bookings, purchases, refunds, the funnel, attribution and the internal
dashboard. GA4, Google Ads, Meta, Reddit, Pinterest and TikTok are external destinations only.
```

Analytics can never break the business: every hook runs after the booking /
payment transaction commits, catches its own errors, is idempotent
(deterministic event IDs + unique constraints) and bounds inline delivery to
2.5 s; leftovers are retried by the job. A vendor outage, missing
configuration or bad token never cancels a booking, blocks a payment or the
webhook, changes a purchase, delays the confirmation email, Calendar or
Sheets, or returns an error to a customer.

Code map:

| Area | Files |
| --- | --- |
| Event catalogue, funnels, destinations, platform mapping | `src/lib/analytics/catalog.ts` |
| Consent model + Consent Mode signals | `src/lib/analytics/consent.ts`, `src/components/analytics/AnalyticsHead.tsx`, `ConsentBanner.tsx`, `AnalyticsProvider.tsx`, `CookiePreferencesButton.tsx` |
| UTM / click IDs / sanitising / channels / attribution models | `src/lib/analytics/attribution.ts` |
| Browser payload validation | `src/lib/analytics/validation.ts` |
| Browser tracker + vendor loaders | `src/lib/analytics/browser/tracker.ts`, `vendors.ts` |
| Storage (visitors, sessions, events, attribution, consent) | `src/lib/analytics/server/store.ts` |
| Server hooks used by booking/payment/contact code | `src/lib/analytics/server/hooks.ts` |
| Destination adapters, delivery queue, retention | `server/destinations.ts`, `server/deliveries.ts`, `server/retention.ts` |
| Config status (never values) | `server/config.ts` |
| Dashboard metrics | `server/metrics.ts`, `src/app/admin/(crm)/analytics/page.tsx` |
| Routes | `/api/analytics/collect`, `/api/analytics/consent`, `/api/analytics/deliveries` (cron), `/api/admin/analytics/export`, `/api/admin/analytics/deliveries` |
| Migration | `drizzle/0018_marketing_analytics.sql` |

## Tables (migration 0018, additive and idempotent)

- `analytics_visitors` — hashed random visitor key, first touch (landing path, referrer host, UTMs, channel), encrypted first click IDs, consent state.
- `analytics_sessions` — hashed session key, visitor, landing/exit path, referrer host, device category, first-touch + session source/medium/campaign/content/term, channel, platform, click-ID types + encrypted click IDs, encrypted vendor IDs (`_ga`, `_fbp`, `_fbc`, `_ttp`, `_epik`, `_rdt_uuid`), page views, engaged, converted, returning.
- `analytics_events` — `external_event_id` (unique), visitor/session/booking/purchase links, name, version, source (browser/server), time, path, allowlisted properties, value/currency (server only), consent flags.
- `analytics_attributions` — one row per booking (`booking_id` unique): first / last-non-direct / conversion touch (JSON, no raw IDs), encrypted click + vendor IDs, consent, window.
- `analytics_deliveries` — one row per (event, destination): channel (server/browser), external event ID, status (pending / delivered / failed / dead / skipped), attempts, sanitised last error, test mode, next retry, delivered at.
- `analytics_consents` — proof of consent: hashed random consent ID, version, categories, action, time.
- `roles` — adds the system role **Marketing Analyst** (`ON CONFLICT DO NOTHING`).

No raw IP address and no full User-Agent is stored anywhere in these tables.
Rate limiting keeps using the existing salted IP hash in `rate_limits`.

## Consent

- Categories: Necessary (always), Analytics (first-party + GA4), Advertising (Google Ads, Meta, Reddit, Pinterest, TikTok — pixels, server APIs and click IDs).
- Before a choice: `analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization` all `denied` (inline script in `<head>` before GTM). A returning visitor's choice is applied in the same script.
- Banner: Accept all / Reject non-essential / Customize, same size and weight; nothing pre-ticked. "Cookie preferences" in the footer reopens it to change or withdraw.
- Stored: `zayro_consent` cookie (version, categories, time, random consent ID, 12 months) + a row in `analytics_consents`. Bumping `CONSENT_VERSION` asks everyone again.
- Without Analytics consent no identifier cookie is set (and any existing `zayro_vid` / `zayro_sid` is deleted); browser funnel events are kept only as unlinked counts. Without Advertising consent no pixel loads, no click ID is stored and no ad-platform delivery is sent (it is recorded as `skipped: no_consent`). Withdrawing skips every pending ad delivery for that browser and erases its stored click IDs.

## Event catalogue, funnels, attribution

See `docs/marketing-event-matrix.md` (every event, its source of truth and
platform mapping) and `docs/marketing-campaign-tracking.md` (UTM standard,
click IDs, channel rules, attribution models).

Funnels (dashboard, each step names its population):

1. Booking: landing (sessions) → pricing viewed → booking started → service → setup → date → time → extras → details → time reserved (sessions) → Checkout created (bookings, server) → paid booking (purchases, webhook).
2. Studio tour: tour CTA clicked → tour booking started → tour date → tour details submitted (sessions) → tour confirmed (bookings, database).
3. Contact: contact viewed → form started (sessions) → form accepted (server events).

Browser events can never be conversions: the collect endpoint rejects
`purchase`, `purchase_confirmed`, `refund`, `booking_confirmed`,
`booking_extended`, `checkout_created`, `tour_confirmed`,
`contact_submitted` and any property not in the allowlist (so no browser
value/revenue).

## Dashboard metrics (`/admin/analytics`)

| Metric | Definition |
| --- | --- |
| Unique visitors | Distinct consented first-party visitors with a session in the range |
| Sessions | Visits; 30 min inactivity or a new campaign/click starts a new one |
| Page views | All page_view events, including unlinked ones without analytics consent |
| Engaged sessions | 2+ pages or 10 s visible |
| Booking starts | Sessions with a first `booking_started` (+ unlinked count shown separately) |
| Checkout starts | Stripe Checkout sessions created by the server |
| Paid bookings | Individual purchases with money collected (paid / partially refunded / refunded) by purchase date |
| Studio tours | Confirmed free tours by booking-created date |
| Contact leads | Accepted contact form messages |
| Visitor → paid booking | Paid bookings that have a consented visit ÷ unique visitors |
| Booking start → checkout | Sessions with a checkout ÷ sessions with a booking start |
| Checkout → purchase | Checkouts in range that were paid ÷ checkouts in range |
| Gross / refunds / net | Exactly `moneyMetrics` (CRM dashboard): collected totals incl. tax by purchase date; succeeded refunds by refund date; gross − refunds |
| Average order value | Booking revenue ÷ paid bookings (extensions excluded) |

Breakdowns: source/platform (Google, Meta, Instagram, Reddit, Pinterest,
TikTok, Organic, Direct, Referral, Other, Unattributed), campaign / content /
landing page, device, new vs returning, weekday, hour, services. Visits use
the visit date, money the purchase/refund date (America/New_York). Rows with
fewer than 3 sessions and no conversions are grouped as "Other (small)".
No customer-level rows, no drill-down, no click IDs, no ROAS (no spend data).

Delivery health: per destination configured / test mode, delivered, pending,
failed, skipped, last delivery; owners (integrations.read) also see the
sanitised last error and missing variable names; `integrations.retry` can
re-queue failed deliveries. Browser/server dedup coverage per platform and
the share of paid bookings without a Pinterest click ID.

## Marketing Analyst (CRM role)

Permissions `analytics.read` (+ `analytics.export`), nothing else. Server-side
checks on the page, every analytics route and the export; all other CRM
pages/APIs already require their own permission and return 403 (covered by
`analytics.integration.test.ts` for bookings, customers, purchases, refunds,
prices, add-ons, availability, integrations, settings, team, roles and the
operational CSV exports). The analyst's `/admin` home redirects to
`/admin/analytics`. Role invitations and changes are audited
(`team.invite`, `team.change_role`); exports are audited
(`analytics.export`). The CRM role grants no GTM, GA4 or ad-account access.

## Retention

| Data | Kept | Setting |
| --- | --- | --- |
| Raw analytics events (not linked to a booking/purchase) | 13 months | `ANALYTICS_RETENTION_EVENTS_MONTHS` |
| Sessions / visitors (not referenced by an attribution) | 25 months | `ANALYTICS_RETENTION_SESSIONS_MONTHS` |
| Failed / dead / skipped deliveries | 90 days | `ANALYTICS_RETENTION_FAILED_DELIVERY_DAYS` |
| Consent records | 25 months | `ANALYTICS_RETENTION_CONSENT_MONTHS` |
| Attribution snapshots and conversion events linked to purchases | with the financial record (never deleted by the job) | — |

Run: `GET /api/analytics/deliveries?cleanup=1` with
`Authorization: Bearer $CRON_SECRET` (batched deletes of 2 000,
counts-only log, idempotent; never touches bookings, purchases, refunds or
customers). Settings are environment variables: only the owner (Vercel) can
change them.

## Environment variables

All optional. Names only (see `.env.example`):

- Master switch: `ANALYTICS_VENDORS_ENABLED` — only `1` or `true` enables it; missing/empty/`0`/`false`/`no` = off. While off no GTM, GA4, Google Ads, Meta, Reddit, Pinterest or TikTok script loads and no vendor API is called; queued deliveries stay pending. Status visible to Owner in Admin → Integrations; changed only in Vercel.
- First-party: `ANALYTICS_ENCRYPTION_SECRET`, `CRON_SECRET` (the only cron secret: Vercel Cron sends `Bearer $CRON_SECRET` automatically and supports no other name), `ANALYTICS_ATTRIBUTION_WINDOW_DAYS`, `ANALYTICS_EXCLUDED_IPS`, `ANALYTICS_ALLOW_NON_PRODUCTION`, `ANALYTICS_RETENTION_*`
- GTM / GA4: `NEXT_PUBLIC_GTM_CONTAINER_ID`, `NEXT_PUBLIC_GA4_MEASUREMENT_ID`, `GA4_API_SECRET`, `GA4_DEBUG` (legacy `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` still read)
- Google Ads: `GOOGLE_ADS_CONVERSION_ID`, `GOOGLE_ADS_BOOKING_CONVERSION_LABEL`, `GOOGLE_ADS_TOUR_CONVERSION_LABEL`, `GOOGLE_ADS_CONTACT_CONVERSION_LABEL`
- Meta: `NEXT_PUBLIC_META_PIXEL_ID`, `META_CONVERSIONS_API_TOKEN`, `META_TEST_EVENT_CODE`, `META_GRAPH_API_VERSION`
- Reddit: `NEXT_PUBLIC_REDDIT_PIXEL_ID`, `REDDIT_PIXEL_ID`, `REDDIT_CONVERSIONS_ACCESS_TOKEN`, `REDDIT_TEST_MODE`
- Pinterest: `NEXT_PUBLIC_PINTEREST_TAG_ID`, `PINTEREST_AD_ACCOUNT_ID`, `PINTEREST_CONVERSIONS_ACCESS_TOKEN`, `PINTEREST_TEST_MODE`
- TikTok: `NEXT_PUBLIC_TIKTOK_PIXEL_ID`, `TIKTOK_PIXEL_CODE`, `TIKTOK_EVENTS_ACCESS_TOKEN`, `TIKTOK_TEST_EVENT_CODE`

Tokens and secrets are read only by server code (`server/config.ts →
serverCredentials()`); the browser receives only `publicAnalyticsConfig()`
(public IDs + booleans). Vendor tags and APIs are active only when
`VERCEL_ENV=production` (or `ANALYTICS_ALLOW_NON_PRODUCTION=1` for a test
property) — preview, local and test traffic never reaches production datasets.

## Manual setup (owner)

### GA4
1. Create a web data stream; copy the Measurement ID → `NEXT_PUBLIC_GA4_MEASUREMENT_ID`.
2. Admin → Data streams → Measurement Protocol API secrets → create → `GA4_API_SECRET` (server-side conversions; the browser then sends `zayro_conversion` instead of GA4 conversion events, so nothing doubles).
3. Mark key events: `purchase`, `studio_tour_confirmed`, `contact_form_submitted` (optionally `begin_checkout`). Not every event.
4. Data settings → define internal traffic for the studio's IP and activate the filter; also set `ANALYTICS_EXCLUDED_IPS`.
5. Verify with DebugView: use a separate test property with `ANALYTICS_ALLOW_NON_PRODUCTION=1` and `GA4_DEBUG=1` on a preview deployment — never the production property.

### Google Tag Manager
1. Create a web container → `NEXT_PUBLIC_GTM_CONTAINER_ID`. The site loads it once, after Consent Mode defaults, never on `/admin`, `/api` or `/booking/manage`.
2. GA4 configuration (Google tag) with **send_page_view off**; a GA4 event tag triggered by the custom event `page_view` (the site pushes one per route change — do not add a History Change trigger).
3. GA4 event tags for the other dataLayer events you want (names in the matrix). If `GA4_API_SECRET` is set, do not create a GA4 `purchase` tag.
4. Google Ads conversion tags (booking / tour / contact labels) triggered by `purchase` (or `zayro_conversion` with `conversion_name = purchase_confirmed`), `studio_tour_confirmed` and `contact_form_submitted`; use `transaction_id` for deduplication. Enable "consent checks" (built-in Consent Mode) on every tag.
5. Do **not** add Meta, Reddit, Pinterest or TikTok pixels in GTM — the site already loads them (with consent); adding them again double-counts.
6. Preview in Tag Assistant on a preview deployment with a test container/environment; the owner publishes.

### Google Ads
1. Create conversion actions: Paid booking (primary), Studio tour, Contact lead. Copy the conversion ID → `GOOGLE_ADS_CONVERSION_ID`, labels → `GOOGLE_ADS_*_CONVERSION_LABEL`.
2. Keep auto-tagging on (gclid). Enhanced Conversions stay **off** in code; enabling them later needs consent review and a code change.
3. Without GTM the site fires the conversions itself (gtag, `transaction_id`); with GTM configure them in GTM (step 4 above).

### Meta (Pixel + Conversions API)
1. Events Manager → Dataset/Pixel → `NEXT_PUBLIC_META_PIXEL_ID`.
2. Conversions API → generate access token → `META_CONVERSIONS_API_TOKEN` (server-only).
3. Test: `META_TEST_EVENT_CODE` from "Test events" on a preview deployment with a test dataset; remove it for production.
4. Optimise campaigns for **Purchase** only (tours: Schedule, contact: Lead). Browser and server share `event_id`; check "Event deduplication" in Events Manager. Advanced matching stays off.

### Reddit
1. Ads Manager → Events Manager → Pixel ID → `NEXT_PUBLIC_REDDIT_PIXEL_ID` and `REDDIT_PIXEL_ID`.
2. Conversions API access token → `REDDIT_CONVERSIONS_ACCESS_TOKEN`; `REDDIT_TEST_MODE=1` while testing.
3. Optimise for Purchase. Conversion ID = internal event ID (dedup). Advanced matching off.

### Pinterest
1. Ads → Conversions → Tag ID → `NEXT_PUBLIC_PINTEREST_TAG_ID`; ad account ID → `PINTEREST_AD_ACCOUNT_ID`.
2. Conversions API token → `PINTEREST_CONVERSIONS_ACCESS_TOKEN`; `PINTEREST_TEST_MODE=true` while testing.
3. Optimise paid bookings for `checkout` (tours/contact: `lead`). The CAPI needs a match key; with advanced matching off only `epik` is sent, so deliveries without it are recorded as `skipped: no_match_keys` (visible as "missing epik" in delivery health).

### TikTok
1. Ads Manager → Events → Web events → Pixel code → `NEXT_PUBLIC_TIKTOK_PIXEL_ID` and `TIKTOK_PIXEL_CODE`.
2. Events API access token → `TIKTOK_EVENTS_ACCESS_TOKEN`; test events code → `TIKTOK_TEST_EVENT_CODE` (remove for production).
3. Optimise for CompletePayment. Pixel and Events API share `event_id`.

Adapters target GA4 MP, Meta Graph `v21.0` (override `META_GRAPH_API_VERSION`),
Reddit `api/v3/pixels/{id}/conversion_events`, Pinterest `v5`, TikTok
`open_api/v1.3/event/track`. Verify each against the vendor's current docs
in test mode before going live.

## External access for the targetologist

| Tool | Grant | Never share |
| --- | --- | --- |
| CRM | Team & Roles → invite with role **Marketing Analyst** | Owner role |
| GA4 | Viewer or Analyst (not Administrator) | — |
| GTM | Read, or Edit **without Publish** when needed; Owner keeps Approve/Publish | — |
| Google Ads | The minimum role to manage campaigns and view conversions (Standard) | — |
| Meta | Business Manager → partner/person access to the ad account and the Pixel/Dataset only | CAPI token |
| Reddit | Ad account access through Reddit business account (campaign/reporting role) | CAPI token, owner password |
| Pinterest | Business Access → the ad account and Tag only, not business owner | CAPI token |
| TikTok | Business Center → ad account + Pixel/Dataset assets | Events API token, login |

Never share owner passwords, Stripe, Vercel, database or Google
service-account credentials, the Resend key, or any CAPI token. The CRM role
and the ad-platform roles are separate; ad-platform access is managed inside
each platform.

### Inviting the targetologist to the CRM
1. Owner → `/admin/team` → Invite → their work email, role **Marketing Analyst** (audited as `team.invite`).
2. They sign in with the magic link; their only section is Analytics (aggregate data, CSV export).
3. To remove access: disable the member (takes effect on the next request).

## Preview verification checklist

- [ ] Preview deployment with test IDs only, `ANALYTICS_ALLOW_NON_PRODUCTION=1`, test event codes / test modes set.
- [ ] First visit: banner shown; Network shows no googletagmanager/facebook/reddit/pinimg/tiktok requests before a choice (GTM, if configured, loads with consent denied).
- [ ] Reject non-essential: no pixels, no `zayro_vid` cookie; booking works.
- [ ] Accept all: pixels load once; route changes send one page view each; click IDs disappear from the URL after ~2.5 s.
- [ ] Book with a Stripe **test** card: `/admin/analytics` shows checkout and paid booking under the right source; Meta/TikTok/Reddit/Pinterest test views show browser + server events deduplicated; GA4 DebugView shows one purchase.
- [ ] Refresh the success page: no second purchase anywhere.
- [ ] Cookie preferences → withdraw: pending ad deliveries become skipped.
- [ ] Sign in as a Marketing Analyst: only Analytics; direct URLs to sessions/customers/purchases/services return "no access".
- [ ] Mobile widths (390, 375, 360): banner fits, buttons reachable, dashboard tables scroll horizontally.

## Production rollout checklist

1. Owner/legal review of the Privacy Policy and banner copy (below).
2. Set `ANALYTICS_ENCRYPTION_SECRET` and `CRON_SECRET` in Vercel (Production).
3. Deploy — migration 0018 runs in the production build (additive; check the `[migrate]` log).
4. Crons are defined in `vercel.json` (every 10 min + daily cleanup); Vercel sends `Bearer $CRON_SECRET`. Every-10-minute crons need the Pro plan. Full rollout runbook: `docs/analytics-rollout.md`.
5. Add vendor IDs/tokens one platform at a time, starting with test modes; set `ANALYTICS_VENDORS_ENABLED=1` only when ready; remove test codes after verification.
6. Configure GTM (above) and publish as Owner.
7. Invite the targetologist; grant external roles per the table.

## Rollback

- Disable a destination: remove its variables in Vercel and redeploy — the site, booking and other destinations are unaffected; queued deliveries for it become `skipped: not_configured`.
- Disable all vendor delivery: unset `ANALYTICS_VENDORS_ENABLED` and redeploy; first-party analytics keeps working.
- Revert the code: redeploy the previous build. Migration 0018 only added tables and one role; old code ignores them. To remove the data entirely: `DROP TABLE analytics_deliveries, analytics_events, analytics_attributions, analytics_sessions, analytics_visitors, analytics_consents;` and delete the Marketing Analyst role after reassigning its members (owner decision; nothing else depends on them).

## Items requiring owner / legal review

- Privacy Policy text (`src/app/(public)/privacy/page.tsx`, marked `LEGAL REVIEW`) and the banner wording. This implementation is not a legal guarantee of compliance.
- Whether US state privacy laws (e.g. "sharing for cross-context behavioral advertising") require additional notices or honoring Global Privacy Control signals; GPC is not yet auto-applied.
- Retention periods above (13 / 25 months, 90 days) and the 12-month consent lifetime.
- Each platform's data processing / business terms and whether its use for ad targeting (not only measurement) is acceptable.
- Any future advanced matching (hashed email/phone, IP, User-Agent): disabled; would need explicit consent wording and owner approval.
