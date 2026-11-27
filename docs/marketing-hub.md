# Marketing hub

The marketer's control centre inside the admin (`/admin`, group **Marketing**).
Built on the existing stack (Next.js + Drizzle/Postgres + the CRM role system);
no extra services. Access is enforced on the server for every page and API
route; the database is never exposed to browsers, so there is no client-side
row-level security to configure.

## Sections

| Section | Path | Permission | What it does |
| --- | --- | --- | --- |
| Marketing hub | `/admin/marketing` | `analytics.read` | Spend, leads, conversions, revenue, CPL / CPA / ROAS vs the previous period; by platform, campaign and landing page; setup checklist |
| Leads | `/admin/leads` | `leads.read` (edit: `leads.manage`) | Pipeline board (New → In progress → Booked → Paid / Lost), filters, lead card with timeline, notes, revenue, attribution; CSV export; Google Ads offline-conversion export |
| Landing pages | `/admin/pages` | `pages.manage` | Block builder (hero, benefits, live catalogue prices, sets, gallery/video, testimonials, FAQ, lead form, CTA, text), templates, SEO, preview, publish |
| Ad spend | `/admin/ad-spend` | `marketing.spend` | Manual spend per day × platform × campaign, CSV paste import |
| Link builder | `/admin/utm` | `analytics.read` | UTM builder with platform presets and dynamic macros; shared link library |
| Tracking & pixels | `/admin/tracking` | `marketing.scripts` | Master switch, site-wide head/body code, consent category, verification meta tags, WhatsApp/Telegram, lead e-mail alerts, landing page as home page |

Per-page tracking code is in the page editor's **Tracking code** tab and also
needs `marketing.scripts`.

## Roles

- **Marketing Manager** (new system role): `analytics.read`, `analytics.export`,
  `leads.read`, `leads.manage`, `pages.manage`, `marketing.scripts`,
  `marketing.spend`. Sees lead contact details. Nothing about bookings,
  payments, prices, team or settings. Assigned by the owner in Admin → Team.
- **Marketing Analyst** (unchanged): aggregates only. Sees the hub, Analytics
  and the link builder; no lead contact details, pages, code or spend.
- **Studio Manager** additionally gets `leads.read` + `leads.manage` so the
  front desk can work WhatsApp / phone enquiries.

## Data

Migration `0023_marketing_hub.sql` adds `landing_pages`, `leads` (ids start at
1001), `lead_activities`, `marketing_settings` (single row), `ad_spend`,
`utm_links`. Existing data is not changed. Safe to re-run.

Leads come from the landing-page form (`POST /api/leads`), the contact form,
and manual entry. UTM values and the referrer are stored always; ad click IDs
(gclid, fbclid, ttclid, …) only with advertising consent and no Global Privacy
Control signal, encrypted with `ANALYTICS_ENCRYPTION_SECRET`. The form has a
honeypot and a rate limit (8 per 10 minutes per IP).

## Custom tracking code — safety rules

1. Off until the master switch is turned on.
2. Runs only on the production deployment (`VERCEL_ENV=production`), unless
   `MARKETING_CODE_ALLOW_NON_PRODUCTION=1` (or `ANALYTICS_ALLOW_NON_PRODUCTION=1`).
3. Waits for the visitor's consent in the chosen category (analytics /
   advertising / strictly necessary) and respects GPC.
4. Never runs on `/booking…`, `/packages/buy…`, admin or API routes.
5. Only `<script>` elements are injected (https sources, safe attributes);
   `<noscript>` and other HTML are dropped.
6. The editor shows what a snippet loads and warns about broken code,
   `document.write`, ad pixels under a non-advertising category, and pixels
   that duplicate a built-in integration (double counting).
7. Every change is audited with a fingerprint (length + hash), never the code.

## Spend and ROAS

No ad-platform reporting API is connected, so spend is what the team enters
on **Ad spend** (labelled "entered manually" everywhere). Nothing is
estimated: with no spend entered, CPL / CPA / ROAS show "—" and Analytics keeps
"Ad cost integration not configured". Campaign names match `utm_campaign`
(lowercase).

- Conversions = Stripe-verified online paid bookings + CRM leads marked Paid.
- Revenue = online gross + revenue recorded on paid leads (offline deals only;
  don't record revenue on a lead that paid online, or it counts twice).
- Leads in the platform table = max(lead events, CRM leads) to avoid double
  counting the same form submission.
