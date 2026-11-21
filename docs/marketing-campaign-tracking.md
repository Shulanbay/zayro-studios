# Marketing campaign tracking

How to tag ad and social links so `/admin/analytics`, GA4 and the ad platforms
agree on where bookings come from.

## URL standard

Always link to a real landing page and add all five UTM parameters:

```
https://zayro.studio/podcast-studio-nyc?utm_source=<platform>&utm_medium=<medium>&utm_campaign=<campaign>&utm_content=<creative>&utm_term=<audience>
```

Reddit:

```
https://zayro.studio/podcast-studio-nyc?utm_source=reddit&utm_medium=paid_social&utm_campaign=<campaign>&utm_content=<creative>&utm_term=<audience>
```

Pinterest:

```
https://zayro.studio/podcast-studio-nyc?utm_source=pinterest&utm_medium=paid_social&utm_campaign=<campaign>&utm_content=<pin>&utm_term=<audience>
```

TikTok:

```
https://zayro.studio/podcast-studio-nyc?utm_source=tiktok&utm_medium=paid_social&utm_campaign=<campaign>&utm_content=<creative>&utm_term=<audience>
```

X (Twitter):

```
https://zayro.studio/podcast-studio-nyc?utm_source=twitter&utm_medium=paid_social&utm_campaign=<campaign>&utm_content=<creative>&utm_term=<audience>
```

Meta: `utm_source=facebook` or `utm_source=instagram`, `utm_medium=paid_social`.
Google Ads: keep auto-tagging (gclid) on; add `utm_source=google&utm_medium=cpc`.

## Naming rules

- lowercase, ASCII where practical;
- one separator style: underscores between parts, hyphens inside a part;
- never customer data: no email, phone, names or anything personal;
- no random or one-off names — the same campaign keeps the same name.

Campaign: `<location>_<service>_<objective>_<date>` → `nyc_podcast_studio_bookings_2026q4`

Content: `<format>_<concept>_<version>` → `video_studio-tour_v1`

Term: the audience → `creators`, `small-business`, `lookalike-1pct`.

Values are lowercased and limited to 150 characters when captured; anything
that looks like an email address or phone number is dropped.

## Platform click IDs

The platforms add their own click IDs to ad links: `gclid`, `gbraid`,
`wbraid` (Google), `fbclid` (Meta), `rdt_cid` (Reddit), `epik` (Pinterest),
`ttclid` (TikTok), `twclid` (X). **Never
replace them with UTM values or remove them in the ad setup** — UTM tags and
native click IDs must coexist. The site:

- accepts click IDs only from those exact parameters, with strict characters and length limits;
- keeps them only with Advertising consent, AES-GCM encrypted, linked to the first-party session and copied into the booking's attribution snapshot;
- never shows them in the dashboard or exports, never writes them to Google Sheets, logs or booking notes;
- removes them from the visible URL (history.replaceState) after the pixels had a moment to read them, so they aren't bookmarked or shared;
- never puts tracking parameters in canonical / Open Graph URLs (those are fixed paths) or Manage Booking links.

## Channel normalisation

| Signal | Source / medium | Channel | Dashboard platform |
| --- | --- | --- | --- |
| `utm_source=reddit&utm_medium=paid_social` or `rdt_cid` | reddit / paid_social | paid_social | Reddit |
| `utm_source=pinterest…` or `epik` | pinterest / paid_social | paid_social | Pinterest |
| `utm_source=tiktok…` or `ttclid` | tiktok / paid_social | paid_social | TikTok |
| `utm_source=facebook\|fb\|meta` + paid medium | facebook / paid_social | paid_social | Meta / Facebook |
| `utm_source=instagram\|ig` + paid medium | instagram / paid_social | paid_social | Instagram |
| `gclid` or `utm_source=google&utm_medium=cpc` | google / cpc | paid_search | Google Ads |
| referrer reddit.com, instagram.com… without paid tags | reddit / social | organic_social | Organic |
| search-engine referrer | google / organic | organic_search | Organic |
| other referrer | host / referral | referral | Referral |
| nothing | (direct) / (none) | direct | Direct |

Paid social is never mixed with organic social. A bare `fbclid` (Meta also
adds it to organic shares) counts as organic social unless the medium is paid.

## Attribution

- **Session**: a visit; ends after 30 minutes without activity, or when the visitor arrives again with different campaign tags or a new ad click.
- **First touch**: the visitor's first recorded session.
- **Last non-direct touch** (default dashboard model): the latest non-direct session within the attribution window (`ANALYTICS_ATTRIBUTION_WINDOW_DAYS`, default 90). A later direct visit never overwrites a valid paid-social or search touch. If there is none in the window, the conversion touch is used.
- **Conversion touch**: the session in which the booking was created.

Attribution is snapshotted once, when the booking is created (Stripe Checkout
start or free confirmation), and never rewritten: a reschedule is not a new
acquisition, an extension's revenue is credited to the original booking's
source (labelled as extension revenue), and a refund lowers net revenue
without changing the acquisition record. Within the window, the latest valid
click per platform is the one sent to that platform's Conversions API.

Visitors who did not allow analytics have no session; their bookings and
revenue still count in totals, under "Unattributed".

There is no ad spend import, so the dashboard shows **revenue by source /
campaign** and says "cost data unavailable" — never ROAS.
