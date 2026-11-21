# ZAYRO Studios — analytics, conversion tracking and attribution setup

This is the operator's guide: what is connected, which events exist, which
environment variables to set, and what the owner has to do in each ad
platform. Deeper reference:

- `docs/analytics.md` — architecture, tables, consent, retention
- `docs/marketing-event-matrix.md` — every internal event × every platform (kept in sync by a unit test)
- `docs/marketing-campaign-tracking.md` — UTM naming rules, click IDs, attribution models
- `docs/analytics-rollout.md` — controlled production rollout and rollback

Source of truth in code: `src/lib/analytics/catalog.ts` (events, platform
mappings, destinations), `src/lib/analytics/attribution.ts` (UTM / click IDs /
channels), `src/lib/analytics/consent.ts` (consent + Consent Mode v2 + GPC).

---

## 1. What is connected

| Integration | Browser | Server | Consent category | Needs |
| --- | --- | --- | --- | --- |
| First-party analytics (own DB) | `/api/analytics/collect` | Stripe webhook, contact form | Analytics | nothing — always on |
| Google Tag Manager | `gtm.js` + `dataLayer` | — | Analytics (Consent Mode v2) | `NEXT_PUBLIC_GTM_CONTAINER_ID` |
| GA4 | via GTM or `gtag.js` | Measurement Protocol | Analytics | `NEXT_PUBLIC_GA4_MEASUREMENT_ID` (+ `GA4_API_SECRET`) |
| Google Ads | `gtag('event','conversion')` or GTM | — | Advertising | `GOOGLE_ADS_CONVERSION_ID` + labels |
| Meta Pixel + Conversions API | `fbq` | Graph API `/{pixel}/events` | Advertising | `NEXT_PUBLIC_META_PIXEL_ID` (+ `META_CONVERSIONS_API_TOKEN`) |
| TikTok Pixel + Events API | `ttq` | `open_api/v1.3/event/track` | Advertising | `NEXT_PUBLIC_TIKTOK_PIXEL_ID`, `TIKTOK_PIXEL_CODE` (+ token) |
| Reddit Pixel + Conversions API | `rdt` | `api/v3/pixels/{id}/conversion_events` | Advertising | `NEXT_PUBLIC_REDDIT_PIXEL_ID`, `REDDIT_PIXEL_ID` (+ token) |
| X (Twitter) Pixel + Conversion API | `twq` (uwt.js) | `ads-api.x.com/12/measurement/conversions/{pixel}` (OAuth 1.0a) | Advertising | `NEXT_PUBLIC_X_PIXEL_ID`, `X_EVENT_ID_*` (+ 4 OAuth values) |
| Pinterest Tag + Conversions API | `pintrk` | `v5/ad_accounts/{id}/events` | Advertising | `NEXT_PUBLIC_PINTEREST_TAG_ID` … |

New platforms are added as one adapter in `src/lib/analytics/server/destinations.ts`
(server), one loader in `src/lib/analytics/browser/vendors.ts` (browser) and
one mapping column in `PLATFORM_EVENTS` (`catalog.ts`). Components never call
a vendor directly — they call `trackEvent()` / `trackConversion()` or are
picked up by click delegation in `AnalyticsProvider`.

**Master switch.** No third-party tag loads and no server delivery is sent
unless `ANALYTICS_VENDORS_ENABLED=1` **and** the deployment is Production
(`VERCEL_ENV=production`; for a preview test also `ANALYTICS_ALLOW_NON_PRODUCTION=1`
with test properties). While it is off, first-party analytics still works and
server deliveries wait in the queue (`pending`), they are not lost.

**Status in the admin.** `/admin/analytics` → "Diagnostics" shows for each
destination: configured / missing variables (names only), consent state,
test events sent, delivery health and failures. Owner also sees it in
Admin → Integrations.

### Privacy guarantees (enforced in code and tests)

- No name, email, phone, address, booking notes, payment or card data is sent
  to GTM, `dataLayer`, GA4, any pixel or any server API. Event properties are
  allowlisted per event (zod schemas); anything that looks like an email or
  phone number is rejected.
- Enhanced Conversions (Google) and Advanced Matching (Meta, TikTok, Reddit,
  X, Pinterest) are **off**: they need hashed email/phone, which this site does
  not send. Server conversions match on click IDs (`gclid`, `fbclid`/`fbc`,
  `ttclid`, `rdt_cid`, `twclid`, `epik`) plus IP/user-agent where the
  platform requires it.
- Tokens and secrets are server-only env vars, are never logged and are
  redacted from stored delivery errors.
- Before a choice every Consent Mode signal is `denied`; ad tags do not load
  without Advertising consent. Global Privacy Control (`navigator.globalPrivacyControl`
  or `Sec-GPC: 1`) keeps Advertising denied even after "Accept all".
- Admin, API and Manage Booking pages never load tags.

---

## 2. Events

Names in the left column are the names requested for this project; the
internal name is what the code and the first-party database use; the GA4 /
`dataLayer` name is what GTM sees. Full platform mapping:
`docs/marketing-event-matrix.md`.

| Requested event | Internal event | `dataLayer` / GA4 name | Where it fires | Sent to ad platforms as |
| --- | --- | --- | --- | --- |
| page_view | `page_view` | `page_view` | every public route change (once) | Meta PageView, TikTok page, Reddit PageVisit, X page_view, Pinterest page |
| view_section | `view_section` | `view_section` | a `main section[id]` / `[data-analytics-section]` is 50 % visible (once per page) | — |
| view_service | `view_item` | `view_item` | service landing pages (`/podcast-studio-nyc`, `/video-production-studio-nyc`, `/studio`) | ViewContent / X view_content |
| view_package | `view_package` | `view_package` | a monthly-package card is 50 % visible | ViewContent / X view_content |
| (pricing page) | `pricing_viewed` | `view_item_list` | `/pricing`, `/packages` | ViewContent / X view_content |
| select_service | `service_selected` | `select_item` | service chosen in the booking flow | — |
| select_package | `select_package` | `select_package` | "Buy Monthly Package" clicked | — |
| click_cta | `click_cta` | `click_cta` | any other `.button` / `.crm-btn` / `[data-analytics-cta]` click | — |
| click_book_now | `click_book_now` | `click_book_now` | any link to `/booking` (not the free tour) | TikTok ClickButton |
| (free tour CTA) | `tour_cta_clicked` | `studio_tour_started` | "Book a free tour" links | — |
| form_start | `contact_started` / `details_started` | `contact_form_started` / `booking_details_started` | first focus in the contact form / contact-details step of booking | — |
| form_submit, generate_lead | `contact_submitted` (server) | `contact_form_submitted` (+ GA4 `generate_lead` via GTM if wanted) | server accepted the contact form | Meta Lead, TikTok SubmitForm, Reddit Lead, X lead, Google Ads contact label |
| begin_booking | `booking_started` | `booking_started` | first booking interaction | — |
| select_booking_date | `date_selected` | `booking_date_selected` | date picked | — |
| select_booking_time | `time_selected` | `booking_time_selected` | time picked | — |
| booking_step_completed | (derived) | `booking_step_completed` with `booking_step` (1–8), `booking_step_name` | pushed to `dataLayer` alongside each booking step | — |
| (checkout) | `checkout_created` (server) | `begin_checkout` | server created a Stripe Checkout session | InitiateCheckout / X checkout |
| booking_abandoned | `booking_abandoned` (server) | `booking_abandoned` (GA4 MP) | Stripe Checkout expired / failed / left, once per booking | — (audiences are built from checkout-without-purchase instead) |
| booking_completed | `purchase_confirmed` (server) | `purchase` | signature-verified Stripe webhook: payment **and** booking confirmed | Purchase / CompletePayment / X purchase / Google Ads booking label |
| booking_completed (free tour) | `tour_confirmed` (server) | `studio_tour_confirmed` | free studio tour confirmed in the DB | Meta Schedule, TikTok Schedule, Reddit Lead, X tour, Google Ads tour label |
| click_phone | `phone_clicked` | `click_phone` | `tel:` link | Meta Contact, TikTok Contact |
| click_email | `email_clicked` | `click_email` | `mailto:` link | Meta Contact, TikTok Contact |
| click_instagram | `click_instagram` | `click_instagram` | instagram.com link | — |
| click_whatsapp | `click_whatsapp` | `click_whatsapp` | wa.me / whatsapp.com link | Meta Contact, TikTok Contact |
| click_map | `directions_clicked` | `click_map` | Google / Apple Maps link | Meta FindLocation |
| view_gallery | `view_gallery` | `view_gallery` | studio setups gallery 50 % visible | — |
| play_video | `play_video` | `play_video` | any `<video>` starts (once per video) | — |
| scroll_depth | `scroll_depth` | `scroll_depth` with `percent` 25/50/75/90 | each mark once per page | — |
| (engagement) | `engaged` | `engaged` | 10 s visible on a page | — |
| (refund) | `refund_succeeded` (server) | `refund` | Stripe refund succeeded | — (lowers net revenue) |

Every `dataLayer` push carries `page_path` and `page_title`. Conversions carry
`event_id` / `transaction_id` = the internal event ID, `value`, `currency`
(USD), and `items` (service / add-on IDs and names, never customer data).

**Purchases are server-verified only.** The browser cannot create a purchase,
checkout, tour, lead or abandonment — the collect endpoint rejects those
names. The success page only mirrors an already-verified server event, with
the same event ID, so platforms deduplicate it.

---

## 3. Environment variables

All values live in Vercel → Project → Settings → Environment Variables
(Production scope; tokens marked **Sensitive**). `NEXT_PUBLIC_*` values are
public IDs by design. The complete list with comments is in `.env.example`.

| Variable | Purpose |
| --- | --- |
| `ANALYTICS_VENDORS_ENABLED` | master switch (`1` = on) |
| `ANALYTICS_ENCRYPTION_SECRET` | encrypts stored click IDs (`openssl rand -base64 48`) |
| `CRON_SECRET` | delivery retry + retention cron |
| `ANALYTICS_ATTRIBUTION_WINDOW_DAYS`, `ANALYTICS_EXCLUDED_IPS`, `ANALYTICS_RETENTION_*` | optional tuning |
| `ANALYTICS_VIEWER_EMAILS` | read-only analytics users (see §8) |
| `NEXT_PUBLIC_GTM_CONTAINER_ID` | GTM-XXXXXXX |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID`, `GA4_API_SECRET`, `GA4_DEBUG` | GA4 |
| `GOOGLE_ADS_CONVERSION_ID`, `GOOGLE_ADS_BOOKING_CONVERSION_LABEL`, `GOOGLE_ADS_TOUR_CONVERSION_LABEL`, `GOOGLE_ADS_CONTACT_CONVERSION_LABEL` | Google Ads |
| `NEXT_PUBLIC_META_PIXEL_ID`, `META_CONVERSIONS_API_TOKEN`, `META_TEST_EVENT_CODE`, `META_GRAPH_API_VERSION` | Meta |
| `NEXT_PUBLIC_TIKTOK_PIXEL_ID`, `TIKTOK_PIXEL_CODE`, `TIKTOK_EVENTS_ACCESS_TOKEN`, `TIKTOK_TEST_EVENT_CODE` | TikTok |
| `NEXT_PUBLIC_REDDIT_PIXEL_ID`, `REDDIT_PIXEL_ID`, `REDDIT_CONVERSIONS_ACCESS_TOKEN`, `REDDIT_TEST_MODE` | Reddit |
| `NEXT_PUBLIC_X_PIXEL_ID`, `X_EVENT_ID_PAGE_VIEW`, `X_EVENT_ID_VIEW_CONTENT`, `X_EVENT_ID_LEAD`, `X_EVENT_ID_CHECKOUT`, `X_EVENT_ID_PURCHASE`, `X_EVENT_ID_TOUR` | X Pixel |
| `X_ADS_CONSUMER_KEY`, `X_ADS_CONSUMER_SECRET`, `X_ADS_ACCESS_TOKEN`, `X_ADS_ACCESS_TOKEN_SECRET`, `X_ADS_API_VERSION` | X Conversion API |
| `NEXT_PUBLIC_PINTEREST_TAG_ID`, `PINTEREST_AD_ACCOUNT_ID`, `PINTEREST_CONVERSIONS_ACCESS_TOKEN`, `PINTEREST_TEST_MODE` | Pinterest |

Values that are not plain IDs (e.g. placeholders like `G-...`) are ignored.
Never put any of these in source code, GTM variables or client logs.

---

## 4. Platform setup (owner)

Where to find each value in each interface: `docs/analytics-rollout.md` §3.

### Google Tag Manager
1. Create a Web container → `NEXT_PUBLIC_GTM_CONTAINER_ID`. The site loads it once, after the Consent Mode v2 defaults, never on admin / API / Manage Booking.
2. Google tag (GA4 config) with **send_page_view = false**; a GA4 event tag on the custom event `page_view` (the site pushes one per route change — do not add a History Change trigger).
3. GA4 event tags for the `dataLayer` events you want (§2). If `GA4_API_SECRET` is set, GA4 conversions arrive server-side: do **not** create GA4 `purchase` / `begin_checkout` / `studio_tour_confirmed` / `contact_form_submitted` tags (the browser then pushes `zayro_conversion` instead).
4. Google Ads conversion tags on `purchase` (or `zayro_conversion` where `conversion_name = purchase_confirmed`), `studio_tour_confirmed`, `contact_form_submitted`, with **Transaction ID = `{{DLV - transaction_id}}`**. Add a Conversion Linker tag.
5. Turn on the built-in consent checks for every tag (Consent Overview).
6. Do **not** add Meta, TikTok, Reddit, X or Pinterest tags in GTM — the site loads them itself with consent; a second copy double-counts.
7. Test in Preview (Tag Assistant), then publish (owner keeps Publish rights).

### GA4
1. Web data stream → Measurement ID → `NEXT_PUBLIC_GA4_MEASUREMENT_ID`; Measurement Protocol API secret → `GA4_API_SECRET`.
2. Key events: `purchase` (primary), `studio_tour_confirmed`, `contact_form_submitted`; optionally `begin_checkout`. Not engagement events.
3. Custom definitions (event-scoped) worth registering: `service_id`, `service_name`, `package_id`, `button_name`, `button_location`, `section_name`, `percent`, `step_name`.
4. Admin → Data filters → internal traffic (studio IP) + `ANALYTICS_EXCLUDED_IPS`.
5. Link GA4 to Google Ads (Admin → Product links) to import audiences.

### Google Ads
1. Goals → Conversions → create **Paid booking** (primary, value = dynamic), **Studio tour** (secondary), **Contact lead** (secondary). `AW-…` → `GOOGLE_ADS_CONVERSION_ID`; labels → the three `GOOGLE_ADS_*_LABEL` variables.
2. Keep auto-tagging on (adds `gclid`, and `gbraid` / `wbraid` on iOS — all captured).
3. Without GTM the site fires the conversions itself with `transaction_id`; with GTM configure them in GTM (above), not both.
4. Enhanced Conversions: leave off (no PII is sent — see §1).
5. Bid on Paid booking only; tours and leads observe.

### Meta (Facebook / Instagram) — Pixel + Conversions API
1. Events Manager → Dataset (Pixel) ID → `NEXT_PUBLIC_META_PIXEL_ID`.
2. Settings → Conversions API → Generate access token → `META_CONVERSIONS_API_TOKEN`.
3. Test events tab → test code → `META_TEST_EVENT_CODE` (Preview only; remove for Production).
4. Browser and server events share `event_id` → check "Deduplication" in the event details. Optimize campaigns for **Purchase**.
5. Aggregated Event Measurement / domain verification for `zayro.studio` in Business Settings → Brand safety → Domains.

### TikTok — Pixel + Events API
1. Ads Manager → Tools → Events → Web events → pixel code → `NEXT_PUBLIC_TIKTOK_PIXEL_ID` and `TIKTOK_PIXEL_CODE`.
2. Settings → Events API → Generate access token → `TIKTOK_EVENTS_ACCESS_TOKEN`; Test events code → `TIKTOK_TEST_EVENT_CODE` (Preview only).
3. Optimize for **CompletePayment**; pixel and Events API share `event_id`.

### Reddit — use the existing pixel, do not create a new one
1. In Reddit Ads → Events Manager, copy the **existing** Pixel ID (`t2_…`) used by the running campaign → `NEXT_PUBLIC_REDDIT_PIXEL_ID` and `REDDIT_PIXEL_ID`. Do not create a second pixel: the campaign's optimization history lives on the current one.
2. The pixel is not currently in the site code or in Vercel. If it was installed some other way (GTM, a website builder snippet), **remove that copy in the same publish** in which `ANALYTICS_VENDORS_ENABLED=1` goes live; if a `rdt` object is already on the page the site reuses it and does not initialize it twice, but its own PageVisit would still double.
3. Conversions API → access token → `REDDIT_CONVERSIONS_ACCESS_TOKEN`; `REDDIT_TEST_MODE=1` on Preview only.
4. In the campaign, keep the conversion event the same (Purchase for bookings). The conversion ID equals the internal event ID, so pixel + CAPI deduplicate. The running campaign is not touched by code.

### X (Twitter) Ads — Pixel + Conversion API
1. Ads Manager → Tools → Events Manager → add the X Pixel → base pixel ID (e.g. `o8z6j`) → `NEXT_PUBLIC_X_PIXEL_ID`.
2. Create one **event** per key and copy its ID (`tw-<pixel>-<event>`): Page view → `X_EVENT_ID_PAGE_VIEW`, Content view → `X_EVENT_ID_VIEW_CONTENT`, Lead → `X_EVENT_ID_LEAD`, Checkout initiated → `X_EVENT_ID_CHECKOUT`, **Purchase → `X_EVENT_ID_PURCHASE`**, Studio tour (custom/lead) → `X_EVENT_ID_TOUR`. Choose "Pixel and Conversion API" as the event source.
3. Conversion API: developer.x.com → an app with Ads API access, user with access to the ad account → OAuth 1.0a consumer key/secret and access token/secret → the four `X_ADS_*` variables. `X_ADS_API_VERSION` defaults to `12`.
4. The browser `twq('event')` and the server conversion carry the same `conversion_id` = internal event ID → X deduplicates. Server conversions need a `twclid` (from the ad click); without one they are recorded as `skipped: no_match_keys`.

### Pinterest
See `docs/analytics.md` → Pinterest (optional; not used for current campaigns).

---

## 5. Conversions and retargeting audiences

Only visitors who granted **Advertising** consent reach any ad platform, so
audiences are smaller than total traffic — that is expected.

**Conversions to optimize for** (everywhere): paid booking (`purchase` /
Purchase / CompletePayment / X purchase). Secondary (observe only): studio
tour, contact lead, checkout started.

**Recommended audiences** (build in each platform from pixel events):

| Audience | Rule | Use |
| --- | --- | --- |
| Site visitors 30 / 90 days | PageView / page_view | broad retargeting |
| Service / pricing viewers 30 days | ViewContent (`view_item`, `pricing_viewed`, `view_package`) | warm retargeting |
| Checkout abandoners 14 days | InitiateCheckout **and not** Purchase in 14 days | highest-intent retargeting ("your slot is still open") |
| Tour bookers 60 days | Schedule / tour | upsell to paid session |
| **Buyers 180 days — exclusion** | Purchase in 180 days | exclude from acquisition and abandoner campaigns |
| Buyers 30 days — exclusion | Purchase in 30 days | exclude from all retargeting (they just booked) |
| Lookalike / similar 1 % | seed = Buyers 180 days (min. ~100 people) | prospecting |

Platform notes:
- **Meta**: Audiences → Custom audience → Website → events above; Lookalike from the Purchase audience. Exclusions in the ad set.
- **Google Ads**: GA4 audiences (`purchase` → exclusion list; `begin_checkout` without `purchase` → abandoners), imported via the GA4 link. Customer Match is not used (it needs email upload). Visitors with `ad_personalization = denied` are not added — Consent Mode does this automatically.
- **TikTok**: Assets → Audiences → Website traffic by event (CompletePayment / InitiateCheckout); Lookalike from CompletePayment.
- **Reddit**: Audiences → Retargeting → events (Purchase / InitiateCheckout / ViewContent); exclude Purchase.
- **X**: Audiences → Website activity → by the event IDs above; exclude the Purchase audience.

---

## 6. Verifying it works

Use a **Preview deployment with test properties** (test GA4 property, test GTM
environment, Meta test event code, TikTok test event code, `REDDIT_TEST_MODE=1`)
and `ANALYTICS_ALLOW_NON_PRODUCTION=1`. Never use real cards: Stripe stays in
test mode (`4242 4242 4242 4242`).

1. **Consent**: open the site in a private window → banner shown, nothing loaded (DevTools → Network: no `gtm.js`, `fbevents.js`, `analytics.tiktok.com`, `redditstatic`, `uwt.js`). "Reject non-essential" → still nothing. "Accept all" → tags load; Tag Assistant shows `ad_storage: granted`. With GPC on (e.g. Brave, or Firefox with GPC enabled) → analytics loads, ad tags don't.
2. **GTM Preview** (Tag Assistant): navigate, click "Book", scroll — see `page_view`, `click_book_now`, `scroll_depth`, `booking_step_completed` in the event list; consent checks pass.
3. **GA4 DebugView** (`GA4_DEBUG=1` on Preview): page views, funnel events, then a test-card booking → `purchase` arrives from the server with `transaction_id`.
4. **Meta Events Manager → Test events**: PageView, ViewContent, then Purchase received twice (Browser + Server) and marked **Deduplicated**.
5. **TikTok Events Manager → Test events**, **Reddit Events Manager → Test mode**, **X Events Manager → event activity**: same check.
6. **Admin**: `/admin/analytics` → Diagnostics shows "Test events sent", consent choices, delivery health with no failures. The booking appears under its source / campaign in "Advertising platforms & campaigns".
7. Remove test codes (`META_TEST_EVENT_CODE`, `TIKTOK_TEST_EVENT_CODE`, `REDDIT_TEST_MODE`) for Production.

---

## 7. Ad cost integration — not configured

The dashboard computes **CPL, CPA and ROAS only from real spend**. No ad
platform cost API is connected yet, so the "Advertising platforms &
campaigns" table shows **"Ad cost integration not configured"** and `—` for
spend, CPL, CPA and ROAS. Nothing is estimated or imputed.

To add it later, one cost importer per platform (Google Ads API
`campaign.metrics.cost_micros`, Meta Marketing API insights `spend`, TikTok
Reporting API, Reddit Ads API, X Ads API stats) writes daily rows
(`date, platform, campaign, spend_cents, clicks, impressions`) to a new table;
the comparison table already joins on platform + campaign
(`src/lib/analytics/server/kpis.ts` → `platformComparison`, field `spend`).
Each needs read-only API credentials from the owner. Campaign names must match
`utm_campaign` (see §9).

---

## 8. Analytics access (Marketing Analyst)

`ANALYTICS_VIEWER_EMAILS` (comma-separated, server-only) lists people who may
sign in to the admin with **read-only analytics access**:

- On their first magic-link sign-in a CRM profile with role **Marketing Analyst** is created (audited as `team.invite`, source "environment bootstrap"). Permissions: `analytics.read`, `analytics.export` — nothing else. Bookings, customers, payments, refunds, prices, settings, integrations, team and roles return 403 on the server; `/admin` redirects them to `/admin/analytics`.
- They see aggregate KPIs, sources, campaigns and conversions; never customer names, emails, phones, payment data, tokens or settings.
- Audit log: magic-link request, sign-in, failed sign-in, `analytics.view`, `analytics.export`, role changes and team changes.
- Removing access: Owner → `/admin/team` → disable the member (effective on the next request). The env var never re-enables a disabled profile; also remove the email from the variable.
- Sign-in is passwordless (magic link to that inbox, single use, expires).

Current value for Production: the two emails the owner provided
(nurorm11@gmail.com, shulanbai.fbr@gmail.com).

Ad-platform access for the same people is granted inside each platform
(GA4 Viewer/Analyst, GTM Read or Edit without Publish, Meta partner access to
the ad account and dataset only, etc.) — see `docs/analytics.md` → External
access. Never share tokens, owner passwords, Stripe, Vercel or database access.

---

## 9. UTM templates

Always include all five UTM parameters and keep the platform's own click ID
(auto-tagging) on. Lowercase, underscores between parts.

```
Google Ads   https://zayro.studio/podcast-studio-nyc?utm_source=google&utm_medium=cpc&utm_campaign={campaign}&utm_content={creative}&utm_term={keyword}
Meta         https://zayro.studio/podcast-studio-nyc?utm_source=facebook&utm_medium=paid_social&utm_campaign={campaign}&utm_content={creative}&utm_term={audience}
Instagram    https://zayro.studio/podcast-studio-nyc?utm_source=instagram&utm_medium=paid_social&utm_campaign={campaign}&utm_content={creative}&utm_term={audience}
TikTok       https://zayro.studio/podcast-studio-nyc?utm_source=tiktok&utm_medium=paid_social&utm_campaign={campaign}&utm_content={creative}&utm_term={audience}
Reddit       https://zayro.studio/podcast-studio-nyc?utm_source=reddit&utm_medium=paid_social&utm_campaign={campaign}&utm_content={creative}&utm_term={subreddit_or_audience}
X            https://zayro.studio/podcast-studio-nyc?utm_source=twitter&utm_medium=paid_social&utm_campaign={campaign}&utm_content={creative}&utm_term={audience}
Organic IG   https://zayro.studio/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link
Email        https://zayro.studio/?utm_source=newsletter&utm_medium=email&utm_campaign={campaign}
```

Dynamic macros where the platform supports them: Meta
`utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}`;
TikTok `__CAMPAIGN_NAME__`, `__CID_NAME__`, `__AID_NAME__`; Google Ads
`{campaignid}`, `{keyword}` in the final URL suffix. Campaign naming:
`<location>_<service>_<objective>_<date>` → `nyc_podcast_bookings_2026q4`.

Captured click IDs: `gclid`, `gbraid`, `wbraid`, `fbclid`, `ttclid`,
`rdt_cid`, `twclid`, `epik` — stored only with Advertising consent, encrypted,
never shown in the dashboard or exports. Attribution models in the dashboard:
first touch, last non-direct touch (default), conversion touch.

---

## Owner checklist

1. Set `ANALYTICS_ENCRYPTION_SECRET` and `CRON_SECRET` (Production, Sensitive).
2. Create / confirm the IDs and tokens in §4; enter them in Vercel. For Reddit use the existing pixel.
3. Configure the GTM container (§4) and publish after Preview.
4. Test on a Preview deployment with test properties (§6).
5. Turn on `ANALYTICS_VENDORS_ENABLED=1` in Production and redeploy.
6. Build audiences and exclusions (§5); point campaigns at Paid booking.
7. Use the UTM templates (§9) on every ad.
8. Have legal review the Privacy Policy cookie section for the new X and TikTok processors.
