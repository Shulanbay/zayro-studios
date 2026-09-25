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
