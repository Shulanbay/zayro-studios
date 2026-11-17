# Marketing analytics — controlled rollout

Status on 2026-11-17: implementation complete on local `main`, **not committed,
not pushed, not deployed**. No real event has been sent to GA4, Google Ads,
Meta, Reddit, Pinterest or TikTok: automated tests use a fake transport (the
real one refuses network access under Vitest), local/preview runs have vendor
delivery disabled, and production delivery additionally requires the owner to
set `ANALYTICS_VENDORS_ENABLED=1`.

## 1. What goes into the commit

Modified (24): `.env.example`, `docs/crm-security.md`, `docs/database-schema.md`,
`drizzle/meta/_journal.json`, `src/app/(booking)/booking/success/page.tsx`,
`src/app/(public)/pricing/page.tsx`, `src/app/(public)/privacy/page.tsx`,
`src/app/admin/(crm)/page.tsx`, `src/app/api/booking/confirm-free/route.ts`,
`src/app/api/booking/verify-booking/route.ts`, `src/app/api/booking/verify-session/route.ts`,
`src/app/api/contact/route.ts`, `src/app/api/payment/create-checkout-session/route.ts`,
`src/app/layout.tsx`, `src/components/booking/BookingFlow.tsx`, `src/components/layout/Footer.tsx`,
`src/components/sections/ContactForm.tsx`, `src/components/sections/PricingSection.tsx`,
`src/lib/crm/crm.integration.test.ts`, `src/lib/crm/crm.unit.test.ts`, `src/lib/crm/nav.ts`,
`src/lib/crm/permissions.ts`, `src/lib/crm/webhook.ts`, `src/lib/db/migrations.test.ts`.

New: `drizzle/0018_marketing_analytics.sql`, `vercel.json`, `docs/analytics.md`,
`docs/analytics-rollout.md`, `docs/marketing-campaign-tracking.md`,
`docs/marketing-event-matrix.md`, `src/lib/analytics/**`, `src/components/analytics/**`,
`src/components/crm/analytics.tsx`, `src/app/admin/(crm)/analytics/page.tsx`,
`src/app/api/analytics/{collect,consent,deliveries}/route.ts`,
`src/app/api/admin/analytics/{export,deliveries}/route.ts`.

**Never commit:** `extract_c9617_fat.py` (owner's untracked file). `.DS_Store`,
`.env*.local`, `.next`, `.vercel` and the service-account JSON are already
ignored. Stage paths explicitly (no `git add -A`).

Migration applied at deployment: **only `0018_marketing_analytics.sql`**
(6 new tables + one role row; additive, idempotent; runs in the Vercel
production build via `scripts/migrate.mjs`).

Booking / Stripe / Calendar / Sheets / email logic is unchanged. The existing
routes only gained post-commit, never-throwing analytics calls, plus spam
protection (rate limit 10 / 10 min per IP hash and a honeypot) on the contact
form. With vendors configured, inline delivery can add up to 2.5 s to the
webhook and Checkout responses (bounded; the rest goes to the cron).

## 2. Vercel Production environment (names only — values were never read)

| Variable | Status | Action |
| --- | --- | --- |
| ANALYTICS_VENDORS_ENABLED | missing (= off) | keep missing until go-live; then `1` or `true` (Production only). Missing, empty, `0`, `false`, `no` or anything else = off. Shown to Owner in Admin → Integrations; changed only in Vercel |
| ANALYTICS_ENCRYPTION_SECRET | missing | **needs owner action** (Production, sensitive) |
| CRON_SECRET | missing | **needs owner action** (Production, sensitive). The only cron secret: Vercel Cron sends `Bearer $CRON_SECRET` automatically and supports no other name; not used by any other job |
| NEXT_PUBLIC_GTM_CONTAINER_ID | missing | needs owner action |
| NEXT_PUBLIC_GA4_MEASUREMENT_ID | missing — legacy `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` is configured (Production + Preview) and is used as fallback | needs owner action: confirm the legacy value is the right G- ID or set the new name; Preview should use a test property or nothing |
| GA4_API_SECRET | missing | needs owner action |
| GOOGLE_ADS_CONVERSION_ID | missing — legacy `NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID` is configured (Production + Preview) and used as fallback | needs owner action: confirm value; wrong environment for Preview |
| GOOGLE_ADS_BOOKING_CONVERSION_LABEL | missing | needs owner action |
| GOOGLE_ADS_TOUR_CONVERSION_LABEL | missing | needs owner action |
| GOOGLE_ADS_CONTACT_CONVERSION_LABEL | missing | needs owner action |
| NEXT_PUBLIC_META_PIXEL_ID | configured (Production + Preview) | wrong environment for Preview (use a test dataset there); owner to confirm it is the live Pixel |
| META_CONVERSIONS_API_TOKEN | missing | needs owner action |
| NEXT_PUBLIC_REDDIT_PIXEL_ID | missing | needs owner action |
| REDDIT_PIXEL_ID | missing | needs owner action |
| REDDIT_CONVERSIONS_ACCESS_TOKEN | missing | needs owner action |
| NEXT_PUBLIC_PINTEREST_TAG_ID | missing | needs owner action (when Pinterest starts) |
| PINTEREST_AD_ACCOUNT_ID | missing | needs owner action (when Pinterest starts) |
| PINTEREST_CONVERSIONS_ACCESS_TOKEN | missing | needs owner action (when Pinterest starts) |
| NEXT_PUBLIC_TIKTOK_PIXEL_ID | missing | needs owner action (when TikTok starts) |
| TIKTOK_PIXEL_CODE | missing | needs owner action (when TikTok starts) |
| TIKTOK_EVENTS_ACCESS_TOKEN | missing | needs owner action (when TikTok starts) |

Because three vendor IDs already exist in Production, the master switch is
what keeps a deploy from starting real Meta / Google Ads traffic on its own.
Note: today's live site still loads GA **without consent**; after this deploy
GA loads only with Analytics consent and only once `ANALYTICS_VENDORS_ENABLED=1`.

Priority when legacy and new names are both set: `NEXT_PUBLIC_GA4_MEASUREMENT_ID`
over `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID`; `GOOGLE_ADS_CONVERSION_ID` over
`NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID`. `NEXT_PUBLIC_META_PIXEL_ID` is the
current name (not legacy). A value that isn't a plain ID (letters, digits,
`_`, `-`, 2–64 chars — e.g. a placeholder like `G-...`) is ignored. All of them
are ignored while the master switch is off.

While the switch is off, server deliveries that are already queued stay
`pending` (never marked delivered or skipped); turning it on sends each of
them once, and delivered events are never re-sent.

Mark tokens/secrets as **Sensitive**, Production scope only. `NEXT_PUBLIC_*`
are public IDs by design.

## 3. Where the owner gets each value

| Service | Where in the interface | Vercel variable |
| --- | --- | --- |
| GA4 | Admin → Data collection and modification → Data streams → (web stream) → **Measurement ID** (G-…) | `NEXT_PUBLIC_GA4_MEASUREMENT_ID` |
| GA4 | same stream → **Measurement Protocol API secrets** → Create | `GA4_API_SECRET` (sensitive) |
| GTM | tagmanager.google.com → container list / top bar → **Container ID** (GTM-…) | `NEXT_PUBLIC_GTM_CONTAINER_ID` |
| Google Ads | Goals → Conversions → Summary → (conversion) → Tag setup → Install the tag yourself → **send_to `AW-XXXXXXX/label`**: the part before `/` | `GOOGLE_ADS_CONVERSION_ID` |
| Google Ads | the same for each action ("Paid booking", "Studio tour", "Contact lead"): the part after `/` | `GOOGLE_ADS_BOOKING_CONVERSION_LABEL`, `GOOGLE_ADS_TOUR_CONVERSION_LABEL`, `GOOGLE_ADS_CONTACT_CONVERSION_LABEL` |
| Meta | Events Manager → Data sources → (Pixel/Dataset) → Settings → **Dataset ID** | `NEXT_PUBLIC_META_PIXEL_ID` |
| Meta | same Settings page → Conversions API → **Generate access token** | `META_CONVERSIONS_API_TOKEN` (sensitive) |
| Meta | Events Manager → Test events → **test code** (preview only) | `META_TEST_EVENT_CODE` (Preview only) |
| Reddit | Ads Manager → Events Manager → **Pixel ID** (t2_…) | `NEXT_PUBLIC_REDDIT_PIXEL_ID` and `REDDIT_PIXEL_ID` |
| Reddit | Events Manager → Conversions API → **Generate access token** | `REDDIT_CONVERSIONS_ACCESS_TOKEN` (sensitive); `REDDIT_TEST_MODE=1` on Preview |
| Pinterest | Ads → Conversions → Tag manager → **Tag ID**; ad account ID in Business → Ad accounts | `NEXT_PUBLIC_PINTEREST_TAG_ID`, `PINTEREST_AD_ACCOUNT_ID` |
| Pinterest | Ads → Conversions → Conversions API → **Generate access token** | `PINTEREST_CONVERSIONS_ACCESS_TOKEN` (sensitive); `PINTEREST_TEST_MODE=true` on Preview |
| TikTok | Ads Manager → Tools → Events → Web events → (pixel) → **Pixel code / ID** | `NEXT_PUBLIC_TIKTOK_PIXEL_ID`, `TIKTOK_PIXEL_CODE` |
| TikTok | same pixel → Settings → Events API → **Generate access token**; Test events → **test event code** | `TIKTOK_EVENTS_ACCESS_TOKEN` (sensitive); `TIKTOK_TEST_EVENT_CODE` (Preview only) |
| Site | generate locally: `openssl rand -base64 48` (twice) | `ANALYTICS_ENCRYPTION_SECRET`; `CRON_SECRET` |

Menu names change over time; if one moved, search the vendor's help for the
name in bold. Endpoints/versions used by the code are listed in
`docs/analytics.md` — verify them in test mode first.

## 4. Vercel Cron (`vercel.json`)

```json
{ "crons": [
  { "path": "/api/analytics/deliveries", "schedule": "*/10 * * * *" },
  { "path": "/api/analytics/deliveries?cleanup=1", "schedule": "30 8 * * *" }
] }
```

Retries every 10 minutes; retention cleanup daily 08:30 UTC (03:30/04:30 ET).
Vercel sends `Authorization: Bearer $CRON_SECRET`; the route accepts only
that (≥ 16 chars, constant-time compare),
so the secret is never in a URL, in the browser bundle or in a log. Crons run
only on the Production deployment. **Plan limit:** Vercel Hobby allows crons at
most once a day — every-10-minute retries need Pro; on Hobby, delete the first
entry (the cleanup still runs and inline delivery still works).

## 5. Preview testing plan

Setup: a Preview deployment of this branch with **test** properties only —
GA4 test property, GTM test environment, Meta test dataset + `META_TEST_EVENT_CODE`,
Reddit `REDDIT_TEST_MODE=1`, Pinterest `PINTEREST_TEST_MODE=true`, TikTok
`TIKTOK_TEST_EVENT_CODE`, plus `ANALYTICS_VENDORS_ENABLED=1` and
`ANALYTICS_ALLOW_NON_PRODUCTION=1` set **for Preview only**. Remove the
Production pixel/GA IDs from the Preview scope first. Stripe test mode keys only.

- [ ] First visit, DevTools → Network: no request to googletagmanager, facebook, redditstatic, pinimg or tiktok before a choice (GTM, if set, loads with all consent denied).
- [ ] Reject non-essential: no `zayro_vid` / `zayro_sid` / `_fbp` / `_ttp` / `_epik` / `_rdt_uuid` cookies; no pixel script; booking still works.
- [ ] Accept all: each pixel script loads exactly once; navigating 3 pages sends 3 page views per platform (Meta Test Events / Tag Assistant).
- [ ] Open `/podcast-studio-nyc?utm_source=reddit&utm_medium=paid_social&utm_campaign=test&rdt_cid=test1` → `/admin/analytics` shows the session under Reddit; repeat for `gclid`, `fbclid` + `utm_source=facebook&utm_medium=paid_social`, `epik`, `ttclid` → Google, Meta, Pinterest, TikTok. Click IDs vanish from the address bar after ~3 s.
- [ ] Book with Stripe test card 4242…: dashboard shows 1 checkout and 1 paid booking under the right source; `analytics_events` has one `purchase_confirmed`.
- [ ] Reload the success page 3×: still one purchase in GA4 DebugView / Meta Test Events / TikTok test events; browser and server copies show as deduplicated (same event ID).
- [ ] Re-send the webhook from the Stripe dashboard (test): still one purchase.
- [ ] Cookie preferences → Reject: `analytics_deliveries` for that browser's pending ad sends become `skipped / consent_withdrawn`.
- [ ] Set a wrong token (e.g. `TIKTOK_EVENTS_ACCESS_TOKEN=invalid`) on Preview, book again: booking, email, Calendar and Sheets succeed; delivery health shows TikTok failed with a sanitised error; fix the token, run the cron URL → delivered with the same event ID.
- [ ] Mobile 390 / 375 / 360 px: banner fits, buttons reachable.

## 6. Marketing Analyst verification

Automated (`analytics.integration.test.ts`, passing): 19 direct API calls —
bookings, booking cancel/reschedule, customer search/update, refund, mark paid,
services list, price edit, add-ons, availability, integrations, analytics
retry, settings, team invite, roles, sessions/customers/purchases CSV — all
return 403 and are audited; aggregate export is allowed, has no PII or click
IDs, neutralises `=`/`+` formulas, and writes `analytics.export` to the audit
log; dashboard data contains no names, emails, phones, notes, Stripe IDs or
click IDs. Manual check (local, Nov 11): a Marketing Analyst sees only
"Analytics" in the menu, `/admin` redirects to `/admin/analytics`, and
Sessions, Customers, Purchases, Services, Integrations, Settings, Team,
Audit and Reports pages show "no access".

On Preview: invite a test address with the Marketing Analyst role at
`/admin/team`, sign in, repeat the page checks and download a CSV.

## 7. Production rollout checklist (after owner approval)

1. Owner/legal review of the Privacy Policy (`LEGAL REVIEW` marker) and banner text.
2. Vercel Production: add `ANALYTICS_ENCRYPTION_SECRET` and `CRON_SECRET`. Leave `ANALYTICS_VENDORS_ENABLED` unset.
3. Commit only the files in §1, open a PR, review, merge (owner approval).
4. Deploy; check the build log for `[migrate] applied migration created at 1791330000000` and the counts report.
5. Smoke test production with vendors off: banner, Reject/Accept, `/admin/analytics`, one free studio tour booking or a booking you refund (owner decides — no live payment by the agent).
6. Add vendor variables one platform at a time (start with GA4 + GTM), set `ANALYTICS_VENDORS_ENABLED=1`, redeploy, verify in each platform's real-time / test view; then the next platform.
7. Configure GTM (docs/analytics.md) and publish as Owner.
8. Confirm the crons appear under Vercel → Settings → Cron Jobs and return 200.
9. Invite the targetologist (Marketing Analyst) and grant external roles per docs/analytics.md.

## 8. Rollback

- Stop all external delivery instantly: remove `ANALYTICS_VENDORS_ENABLED` (or set `0`) and redeploy. First-party analytics and bookings keep working.
- Stop one platform: remove its variables and redeploy; queued sends become `skipped: not_configured`.
- Revert the release: redeploy the previous production deployment in Vercel ("Promote"). Migration 0018 only added tables and a role; old code ignores them.
- Remove data (owner decision): drop the six `analytics_*` tables and the Marketing Analyst role after reassigning its members.

## 9. Owner actions

1. Approve commit / PR / deploy.
2. Legal review of Privacy Policy + banner.
3. Create the two secrets (`ANALYTICS_ENCRYPTION_SECRET`, `CRON_SECRET`), check Vercel plan for the 10-minute cron.
4. Confirm or replace the three legacy IDs and remove them from Preview scope.
5. Collect IDs/tokens per §3; create test properties/datasets for Preview.
6. Configure GA4 key events, GTM tags, Google Ads conversion actions.
7. Invite the targetologist; grant GA4 Viewer/Analyst, GTM Read (no Publish), Ads Standard, Meta/Reddit/Pinterest/TikTok ad-account access — never share tokens or passwords.
8. Decide when to set `ANALYTICS_VENDORS_ENABLED=1`.
