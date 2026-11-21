# Marketing event matrix

One internal event per real-world action. The internal event ID is created
once and reused by every destination and every retry (never regenerated):

| Platform | Field that carries the internal event ID |
| --- | --- |
| GA4 | `transaction_id` for purchase / refund / extension, `event_id` parameter otherwise |
| Meta Pixel / CAPI | `eventID` (browser) / `event_id` (server) |
| Reddit Pixel / CAPI | `conversionId` (browser) / `metadata.conversion_id` (server) |
| Pinterest Tag / CAPI | `event_id` (both) |
| TikTok Pixel / Events API | `event_id` (both) |
| X Pixel / Conversion API | `conversion_id` (both) |

Server event IDs are deterministic (`sha256("zayro-analytics-event:<kind>:<internal id>")`
laid out as a UUID): `checkout_created` ← booking id, `purchase_confirmed` ←
purchase id, `refund_succeeded` ← refund id, `extension_purchased` ← extension
purchase id, free booking ← booking id, `contact_submitted` ← random
submission id. A purchase, its checkout and its refund therefore always have
three different IDs. IDs are never derived from an IP address.

The source of truth is `src/lib/analytics/catalog.ts` (`PLATFORM_EVENTS`,
`SERVER_DELIVERED`); a unit test checks this document lists every mapping.
Platform event names follow each vendor's documented standard events —
re-check them against current official docs before enabling a platform.

## Matrix

| Internal event | Trigger / source of truth | GA4 event | Google Ads conversion | Meta Pixel / CAPI | Reddit Pixel / CAPI | Pinterest Tag / CAPI | TikTok Pixel / Events API | Browser / server | Consent | Event ID | Value / currency | Key event |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `page_view` | Public App Router navigation (once per route) | page_view | — | PageView | PageVisit | pagevisit (`pintrk('page')`) | PageView (`ttq.page()`) | browser | Analytics (first-party, GA4); Advertising (pixels) | random per view | — | no |
| `pricing_viewed` | /pricing or /packages opened | view_item_list | — | ViewContent | ViewContent | viewcategory | ViewContent | browser | as above | random | — | no |
| `view_item` | Service landing page opened | view_item | — | ViewContent | ViewContent | viewcategory | ViewContent | browser | as above | random | — | no |
| `booking_started` | First booking interaction (service chosen) | booking_started | — | — | — | — | — | browser | Analytics | random | — | no |
| `service_selected` | Service picked | select_item | — | — | — | — | — | browser | Analytics | random | — | no |
| `setup_selected` | Studio setup picked | booking_setup_selected | — | — | — | — | — | browser | Analytics | random | — | no |
| `date_selected` | Date picked | booking_date_selected | — | — | — | — | — | browser | Analytics | random | — | no |
| `time_selected` | Time picked | booking_time_selected | — | — | — | — | — | browser | Analytics | random | — | no |
| `extras_reached` | Extras step shown | booking_extras_viewed | — | — | — | — | — | browser | Analytics | random | — | no |
| `extra_added` | Extra quantity increased | booking_extra_added | — | — | — | — | — | browser | Analytics | random | — | no |
| `details_started` | Contact-details step shown | booking_details_started | — | — | — | — | — | browser | Analytics | random | — | no |
| `hold_created` | Server reserved the slot (create-hold OK) | booking_hold_created | — | — | — | — | — | browser | Analytics | random | — | no |
| `checkout_created` | Server created a Stripe Checkout session (not a click) | begin_checkout | — | InitiateCheckout | Custom (InitiateCheckout) | custom (initiate_checkout) | InitiateCheckout | both | Advertising for ad platforms, Analytics for GA4 | `checkout_created` ← booking id | quoted total, USD | secondary |
| `purchase_confirmed` | Signature-verified Stripe webhook confirmed payment **and** booking | purchase | booking label | Purchase | Purchase | checkout | CompletePayment | both (server authoritative; browser mirror only on the verified success page) | as above | `purchase_confirmed` ← purchase id | collected total incl. tax, USD; tax separate; immutable purchase items | **yes — primary paid-booking event on every platform** |
| `tour_confirmed` | Database confirmed a free studio tour | studio_tour_confirmed | tour label | Schedule | Lead | lead | Schedule | both | as above | free booking ← booking id | 0 USD | yes |
| `booking_confirmed` | Database confirmed a free (non-tour) booking | — | — | — | — | — | — | server | — | free booking ← booking id | 0 USD | no |
| `contact_submitted` | Server accepted the contact form (rate limit + honeypot passed, email delivered) | contact_form_submitted | contact label | Lead | Lead | lead | SubmitForm | both | as above | `contact_submitted` ← random submission id | — | yes |
| `extension_purchased` | Webhook applied a paid session extension | booking_extended | — | — | — | — | — | server | Analytics | `extension_purchased` ← extension purchase id | collected total, USD (extension revenue, original booking's attribution) | no |
| `refund_succeeded` | Stripe refund became `succeeded` (webhook) | refund | — | — | — | — | — | server | Analytics | `refund_succeeded` ← refund id; `transaction_id` = original purchase ID | refund amount, USD | no |
| `booking_rescheduled` | (reserved, not yet emitted) | booking_rescheduled | — | — | — | — | — | server | — | — | — | no |
| `booking_cancelled` | (reserved, not yet emitted) | booking_cancelled | — | — | — | — | — | server | — | — | — | no |
| `booking_abandoned` | Stripe Checkout expired / failed / left (webhook or cancel page), once per booking | booking_abandoned | — | — | — | — | — | server | Analytics | `booking_abandoned` ← booking id | — | no |
| `tour_cta_clicked` | Click on a “Book a free tour” link | studio_tour_started | — | — | — | — | — | browser | Analytics | random | — | no |
| `contact_started` | First focus in the contact form | contact_form_started | — | — | — | — | — | browser | Analytics | random | — | no |
| `phone_clicked` / `email_clicked` / `directions_clicked` | tel: / mailto: / maps link clicked | click_phone / click_email / click_map | — | Contact / Contact / FindLocation | — | — | Contact / Contact / — | browser | Analytics; Advertising (pixels) | random | — | no |
| `click_instagram` / `click_whatsapp` | instagram.com / wa.me link clicked | click_instagram / click_whatsapp | — | — / Contact | — | — | — / Contact | browser | as above | random | — | no |
| `click_book_now` | Any link to /booking (not the tour) | click_book_now | — | — | — | — | ClickButton | browser | as above | random | — | no |
| `click_cta` | Any other `.button` link / button, or `data-analytics-cta` | click_cta | — | — | — | — | — | browser | Analytics | random | — | no |
| `scroll_depth` | 25 / 50 / 75 / 90 % of the page, once each | scroll_depth | — | — | — | — | — | browser | Analytics | random | — | no |
| `view_section` | A `<section id>` or `data-analytics-section` half visible, once per page | view_section | — | — | — | — | — | browser | Analytics | random | — | no |
| `view_package` | A monthly package card half visible | view_package | — | ViewContent | ViewContent | viewcategory | ViewContent | browser | as above | random | — | no |
| `select_package` | “Buy Monthly Package” clicked | select_package | — | — | — | — | — | browser | Analytics | random | — | no |
| `view_gallery` | Studio setups gallery half visible | view_gallery | — | — | — | — | — | browser | Analytics | random | — | no |
| `play_video` | Any `<video>` starts playing, once per video | play_video | — | — | — | — | — | browser | Analytics | random | — | no |

### X (Twitter) Ads

The X Pixel and Conversion API use event IDs created in X Events Manager
(`tw-<pixel>-<event>`), set per key in `X_EVENT_ID_<KEY>`:

| Internal event | X event key (env var) |
| --- | --- |
| `page_view` | page_view (`X_EVENT_ID_PAGE_VIEW`) |
| `pricing_viewed`, `view_item`, `view_package` | view_content (`X_EVENT_ID_VIEW_CONTENT`) |
| `checkout_created` | checkout (`X_EVENT_ID_CHECKOUT`) |
| `purchase_confirmed` | purchase (`X_EVENT_ID_PURCHASE`) — the one paid-booking conversion |
| `tour_confirmed` | tour (`X_EVENT_ID_TOUR`) |
| `contact_submitted` | lead (`X_EVENT_ID_LEAD`) |

No refund event is invented for ad platforms that don't support one; refunds
reduce **net revenue** in the internal dashboard and in GA4 only.

## Avoiding double counting

- **GA4**: if `GA4_API_SECRET` is set, GA4 conversions are sent server-side
  (Measurement Protocol) and the browser pushes `zayro_conversion` instead of
  the GA4 event name. Without it the browser pushes the GA4 event to the
  dataLayer. Never both. Mark only `purchase`, `studio_tour_confirmed`,
  `contact_form_submitted` (and optionally `begin_checkout`) as key events.
- **Google Ads**: without GTM the site fires `gtag('event','conversion')`
  with `transaction_id`. With GTM, configure Google Ads conversion tags in GTM
  on the dataLayer events instead — the site then does not fire them.
- **Meta / Reddit / Pinterest / TikTok**: browser and server copies of the
  same conversion carry the same event ID and event name, so the platform
  deduplicates them. The delivery table stores both channels, which is how the
  dashboard measures deduplication coverage.
- A purchase is only created from the webhook; a reload of the success page
  reuses the same deterministic ID and is fired at most once per tab.
- Pinterest: `checkout` is the paid-booking event; tours use `lead`. Do not
  also send `schedule` for paid bookings.
