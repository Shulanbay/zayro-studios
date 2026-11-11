# CRM security

## Authentication
- Magic link by email (`/api/admin/request-login`), rate limited (5 / 15 min
  per IP hash), same response whether or not the address is on the team.
- Link = HMAC-signed token (`NEXTAUTH_SECRET`) with a random one-time `jti`,
  valid 15 minutes. Opening it shows a confirmation page; only the button's
  POST consumes the `jti` (row in `admin_login_tokens`), so email link
  scanners can't burn it and a link can't be replayed.
- Session cookie `zayro_admin_session`: HMAC-signed, `HttpOnly`,
  `Secure` in production, `SameSite=Lax`, 8 hours.
- Every request re-reads `admin_profiles` + `roles`: disabling a member or
  changing a role takes effect immediately.
- Bootstrap: an address in `ADMIN_EMAILS` gets an Owner profile the first time
  it signs in (idempotent, unique email). After that the database decides.
  The last active Owner can't be demoted or disabled; nobody can change
  their own role or access.

## Authorisation
- `requirePermission(request, permission)` in every admin route handler;
  every CRM page checks `admin.can(...)`. Hidden buttons are convenience only.
- Denials are written to the audit log (`auth.permission_denied`).
- Financial fields are hidden from roles without `purchases.read`.

### Permission matrix (system roles)

| Permission | Owner | Studio Manager | Producer | Operator |
| --- | :-: | :-: | :-: | :-: |
| bookings.read | ✓ | ✓ | ✓ | ✓ |
| bookings.create | ✓ | ✓ | ✓ | |
| bookings.update | ✓ | ✓ | ✓ | |
| bookings.cancel | ✓ | ✓ | | |
| bookings.refund | ✓ | ✓ | | |
| customers.read | ✓ | ✓ | ✓ | ✓ |
| customers.update | ✓ | ✓ | | |
| customers.merge | ✓ | ✓ | | |
| notes.write | ✓ | ✓ | ✓ | |
| purchases.read | ✓ | ✓ | | |
| purchases.create | ✓ | ✓ | | |
| packages.read | ✓ | ✓ | ✓ | |
| packages.manage | ✓ | ✓ | | |
| services.manage | ✓ | ✓ | | |
| availability.manage | ✓ | ✓ | | |
| reports.read | ✓ | ✓ | | |
| reports.export | ✓ | ✓ | | |
| integrations.read | ✓ | ✓ | | |
| integrations.retry | ✓ | ✓ | | |
| team.manage | ✓ | | | |
| audit.read | ✓ | | | |
| settings.manage | ✓ | | | |

A unit test keeps this matrix, `src/lib/crm/permissions.ts` and the SQL seed
in `drizzle/0007_crm_backfill.sql` identical.

## CSRF
Session cookie is `SameSite=Lax` (not sent on cross-site POST/PATCH/DELETE)
and every state-changing admin request must carry a same-origin `Origin`
header (`isSameOrigin`), else 403 + audit. Mutations are JSON `fetch`
calls, not form posts (except the login confirmation, which carries its own
one-time token).

## Input validation
Zod on every admin and public mutation. Prices, taxes, durations, slot
availability and refundable amounts are always recomputed on the server.
Refunds and cancellations additionally require the order number / booking
ID repeated as a server-side confirmation, and refunds require the amount the
admin saw as refundable (stale dialogs are rejected).

## Public endpoints
- Rate limits (Postgres, salted-hash keys, fail-open): create-hold 30/10 min,
  checkout 20/10 min, free confirm 20/10 min, admin login 5/15 min.
- Honeypot field `website` rejected on booking endpoints.
- Rate limits also on release-hold 30/10 min, validate-hold 60/10 min,
  verify-booking 30/10 min, verify-session 60/10 min.
- Public verify/validate endpoints return no phone numbers, no full email
  addresses and no notes (`lib/publicBooking.ts`). Booking IDs are
  cryptographically random (`generateBookingId`).
- Services switched to *quote only* or *not bookable online* are refused by
  every public booking route, not just hidden in the UI.
- Stripe webhook: signature verified on the raw body before anything else.

## Data protection
- No card data is ever handled (Stripe Checkout). Stripe metadata carries
  only ids (bookingId, holdId, serviceId) — no names, emails or phones.
- `webhook_events.safe_payload` stores ids, amounts and statuses only.
- Audit payloads drop keys that look like secrets (token, key, password,
  secret, signature, card, …) and truncate long values.
- CSV exports: admin-only, audited, formula-injection guarded, no secrets.
- Integration errors shown in the UI are Google/Stripe/Resend messages with
  API keys masked; env values are never rendered (Settings shows set/not set).
- PII lives only behind `/admin` routes (all `noindex`).

## Secrets hygiene (checked 2026-09-25)
- `.env*` and `zayro-studios-booking-*.json` / `*service-account*.json` are
  gitignored; `git log --all` shows the key file was never committed. The only
  `PRIVATE KEY` strings in history are `.env.example` placeholders and a test
  fixture.
- The service-account JSON still sits in the repo root on the owner's
  machine — it is ignored by git; delete it once Google is verified.

## Manage Booking links (customer self-service)
- Token = HMAC-SHA256(`BOOKING_MANAGE_SECRET`, `booking id : random nonce`), 256-bit,
  base64url. The database keeps only sha256(token) and the nonce; rotating the
  nonce or setting `manage_token_revoked_at` kills every older link.
- Link format `/booking/manage#t=…`: the fragment never reaches the server,
  logs or Referer; the page moves it to `sessionStorage`, strips it from the
  address bar, sends it only in POST bodies, and Google Analytics is not
  initialised on `/booking/manage`. The page is `noindex, nofollow`,
  `Referrer-Policy: no-referrer`, and not in the sitemap.
- Unknown, malformed and revoked tokens all get the same 404 message.
- Only the booking owner's emails contain the link; guest emails never do.
- Every mutation re-checks status and the 24-hour rule on the server (inside
  the same transaction / compare-and-set as the change), is rate limited per
  IP (view 60, cancel/reschedule/extend 10 per 10 min), Origin-checked, and
  audited. Client-sent amounts, ids and Stripe references are never used.

### Secret separation
| Secret | Used only for | Rotating it affects |
| --- | --- | --- |
| `NEXTAUTH_SECRET` | admin magic links + sessions (and the salt of rate-limit keys) | admins sign in again; rate-limit windows restart |
| `BOOKING_MANAGE_SECRET` | customer Manage Booking links | every issued Manage Booking link stops working; customers use *Request a new link* |
| `STRIPE_SECRET_KEY` | Stripe API calls | nothing else |

No secret falls back to another. Missing `BOOKING_MANAGE_SECRET` fails
closed: the Manage Booking API answers 503, confirmation emails go out
without the link, and Admin → Integrations → Configuration shows it as
missing (name and state only, never the value).

### Request a new link (`/booking/manage/request-link`)
Booking reference + the email on the booking. Always the same answer
("If the booking details match our records…") and at least 1.2 s response
time, whatever happened. Rate limited per IP (5 / 15 min) and per booking
reference (5 / h), salted-hash keys. The link goes only to the booking's own
email (never a guest or a typed-in address), replaces earlier links, and is
sent at most once per booking per 10 minutes. Unpaid checkouts and links
revoked by staff get nothing. Audited without the token.
