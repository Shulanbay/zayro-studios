# ZAYRO Studios CRM — Architecture

Status: implemented on branch `feat/crm` (see `crm-roadmap.md` for what is
done and what is deliberately deferred).

## 1. Principles

1. **The Neon Postgres database is the source of truth.** Google Calendar,
   Google Sheets, Stripe and Resend are integrations. The CRM never reads
   availability or bookings back from Google.
2. **Extend, don't replace.** The public site, booking flow, Stripe Checkout,
   Calendar/Sheets sync and magic-link login keep working unchanged from the
   customer's point of view. New behaviour is added through additive
   migrations and new modules.
3. **Every mutation is authorised on the server** (`requirePermission`), is
   validated with Zod and writes an audit record. Hidden buttons are only a
   convenience.
4. **Money is integer cents** in every new table. The legacy `decimal`
   columns on `bookings`/`payments`/`services` are kept (never altered) and
   are mirrored into immutable purchase snapshots.
5. **Side effects never undo a committed state change.** A failed email,
   Calendar or Sheets call is logged, shown in *Integrations* and can be
   retried; the booking/payment/refund stays correct.

## 2. Current architecture (before the CRM)

```
Browser ──> Next.js 14 App Router (Vercel)
             ├─ public pages (marketing, pricing, booking flow)
             ├─ /api/booking/*   holds, free confirmation, availability
             ├─ /api/payment/*   Stripe Checkout + webhook
             ├─ /api/admin/*     magic-link admin, cancellation, retry sync
             └─ /admin           single admin page
                    │
                    ├─ Neon Postgres (Drizzle ORM, postgres-js)
                    ├─ Stripe (Checkout, webhook)
                    ├─ Resend (confirmation + owner email, magic link)
                    └─ Google Calendar + Sheets (service account)
```

## 3. Target architecture

```
/admin/(crm)/layout.tsx  — auth gate + sidebar (desktop) / drawer (mobile)
  ├─ Dashboard            SQL aggregates (lib/crm/metrics.ts)
  ├─ Calendar             day / week / month / list over bookings, holds, blocks
  ├─ Sessions             list, filters, CSV, detail, manual booking
  ├─ Customers            list, profile, notes, merge
  ├─ Purchases            list, detail, refunds
  ├─ Packages             plans, customer packages, credit ledger
  ├─ Services             catalog management (soft delete)
  ├─ Availability         weekly hours, booking rules, date overrides, preview
  ├─ Blocked Time         blocks (single / repeated), soft delete
  ├─ Integrations         Stripe events, email log, Calendar, Sheets, health
  ├─ Reports              CSV exports
  ├─ Team & Roles         admin profiles, roles, permission matrix
  ├─ Audit Log            filterable audit trail
  └─ Settings             tax, business info, env status (names only)

src/lib/crm/            domain modules (server-only)
  auth.ts               requireAdmin / requirePermission, owner bootstrap
  permissions.ts        permission catalogue + system role matrix (pure)
  audit.ts              writeAudit + payload sanitiser
  time.ts               America/New_York wall-clock <-> UTC helpers (pure)
  customers.ts          normalised-email upsert, stats refresh, merge
  purchases.ts          purchase + immutable line items, order numbers
  bookings.ts           manual booking, reschedule, complete, no-show, cancel
  refunds.ts            Stripe refunds with idempotency keys
  webhook.ts            Stripe event processing (idempotent, transactional)
  packages.ts           plans, assignment, credit ledger (grant/redeem/...)
  emailLog.ts           email log + safe retry
  metrics.ts            dashboard aggregates
  csv.ts                CSV writer with formula-injection guard
  rateLimit.ts          DB-backed fixed-window rate limiter
```

### Request flow for an admin mutation

```
fetch(POST /api/admin/...)  (same-origin, SameSite=Lax cookie)
  └─ requirePermission('bookings.cancel', request)
        ├─ verifies HMAC session cookie
        ├─ checks Origin header (CSRF defence in depth)
        ├─ loads admin_profiles + roles (status must be active)
        └─ on failure: audit 'auth.denied' + 401/403
  └─ Zod-validate body
  └─ domain function in a transaction (advisory locks where slots change)
  └─ writeAudit(before, after)
  └─ post-commit side effects (Calendar / Sheets / email), each logged
```

## 4. Booking lifecycle

```
            create-hold (advisory lock per date)
                 │
      ┌──────────┴──────────┐
  free service          paid service
      │                     │
confirm-free            create-checkout-session
  │  purchase(approved)    │ booking(payment_pending) + purchase(pending)
  │                        │ Stripe Checkout (metadata: bookingId, holdId)
  ▼                        ▼
confirmed  <──── webhook checkout.session.completed / async_payment_succeeded
  │                (event row claimed once; amount checked against the
  │                 booking's own price snapshot; exclusion constraint)
  ├─ reschedule  (locks both dates, Calendar patch, Sheets update, email)
  ├─ completed / no_show
  └─ cancelled   (Calendar marked, Sheets row updated, optional email,
                  package credit restored, optional refund)
```

A payment that arrives for a cancelled booking, or for a slot that was taken
in the meantime, is recorded (`purchases.status = paid`) but the booking is
**not** confirmed; `needs_refund_review` is set and the admin dashboard,
session detail and purchase detail show a warning.

## 5. Stripe lifecycle

| Event | Handling |
| --- | --- |
| `checkout.session.completed` | `payment_status = paid` → confirm; `unpaid` (async method) → wait |
| `checkout.session.async_payment_succeeded` | confirm |
| `checkout.session.async_payment_failed` | purchase `failed`, booking cancelled, slot released |
| `payment_intent.payment_failed` | recorded on the purchase (Checkout may still be retried by the customer) |
| `charge.refunded` | refunds upserted by `stripe_refund_id`, purchase `refunded_cents` = `charge.amount_refunded` |
| `refund.updated` | refund status synced; purchase totals recomputed from succeeded refunds |

Idempotency: `webhook_events (provider, external_event_id)` is unique. An
event is *claimed* with a conditional update (`received|failed →
processing`); a duplicate delivery of a processed event returns 200 without
doing anything, an event that is being processed right now returns 409 so
Stripe retries later.

## 6. Integration retry strategy

| Side effect | Idempotency key | Retry |
| --- | --- | --- |
| Calendar event | deterministic event id from `booking_id` | *Retry sync* (Calendar + Sheets only) |
| Sheets row | `booking_id` in column B, stored row range | *Retry sync* |
| Email | `email_logs.dedupe_key` (template + entity + version) | *Retry email* — only failed/skipped rows, a sent email is never re-sent |
| Stripe refund | `refunds.id` as Stripe idempotency key | re-submitting the same refund row reuses Stripe's result |

Calendar/Sheets retries never send email; email retries never touch Google.

## 7. Time zones

All instants are stored as `timestamptz` (UTC). Bookings keep their original
`booking_date` + `HH:MM` wall-clock columns (America/New_York), and a trigger
derives `starts_at` / `ends_at` from them so every writer — including code
that predates the CRM — keeps them in sync. `src/lib/crm/time.ts` converts
between ET wall-clock and UTC using `Intl` (DST-safe, tested for both
transitions). Availability, cutoffs and blocked time are evaluated in ET.

## 8. Environment variables

Names only — values live in Vercel.

| Name | Used for |
| --- | --- |
| `DATABASE_URL` | Neon connection (runtime + migrations) |
| `NEXTAUTH_SECRET` | HMAC for magic links and admin sessions |
| `NEXTAUTH_URL` | fallback base URL |
| `ADMIN_EMAILS` | bootstrap Owners (first login creates an Owner profile) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe (test mode) |
| `RESEND_API_KEY`, `EMAIL_FROM`, `OWNER_EMAIL` | email |
| `GOOGLE_CALENDAR_EMAIL`, `GOOGLE_CALENDAR_PRIVATE_KEY`, `GOOGLE_CALENDAR_ID`, `GOOGLE_SHEETS_ID` | Google |
| `TEMPORARY_HOLD_DURATION_MINUTES` | hold length |
| `RUN_DB_MIGRATIONS` | force migrations in a non-production build |

Unused and safe to remove after verification: `GOOGLE_SHEETS_EMAIL`,
`GOOGLE_SHEETS_PRIVATE_KEY`, `GOOGLE_SHEETS_SHEET_NAME`, the `BUSINESS_HOURS_*`
variables (hours live in the database).
