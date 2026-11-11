# Database schema (CRM)

Postgres (Neon) via Drizzle. Source of truth for the TypeScript types:
`src/lib/db/schema.ts`. Migrations are hand-written SQL in `drizzle/` and
applied by `scripts/migrate.mjs` (one transaction per file, advisory-locked).

Conventions for everything added by the CRM:

- **Money = integer cents** (`*_cents`). Legacy `decimal` columns on
  `bookings`, `payments`, `services` are untouched and still written.
- **Instants = `timestamptz` (UTC).** Studio wall-clock values stay as
  `date` + `HH:MM` on bookings/holds; `bookings.starts_at/ends_at` are derived.
- **Status columns are `varchar` + `CHECK`**, not Postgres enums, so adding a
  value later is a plain migration (no `ALTER TYPE` transaction limits).
- **Nothing financial is deleted.** Services are switched off/archived,
  customers merged, blocked time soft-deleted, purchase items immutable.

## Existing tables (extended)

### `bookings` (+ columns)
| column | notes |
| --- | --- |
| `purchase_id` → purchases | backfilled for every existing booking |
| `source` | `individual` · `package` · `studio_tour` · `admin` |
| `room_id` → rooms (default 1), `setup_id` → setups | one active room today |
| `customer_package_id` → customer_packages | set when paid with a credit |
| `internal_notes`, `cancellation_reason` | staff only |
| `cancelled_at`, `completed_at`, `no_show_at` | lifecycle timestamps |
| `created_by_admin_id`, `updated_by_admin_id` | staff attribution |
| `needs_refund_review`, `review_reason` | paid but can't go ahead |
| `starts_at`, `ends_at` | **trigger** `bookings_set_range` from date + times in the room's time zone |

Constraint **`bookings_no_overlap`**:
`EXCLUDE USING gist (room_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status IN ('confirmed','completed','no_show'))`.

New enum values: `booking_status.no_show`, `payment_status.partially_refunded`.

### `customers` (+ columns)
`normalized_email` (trigger: `lower(btrim(email))`), `status`
(`active`/`archived`/`merged`), `merged_into_id`, `stripe_customer_id`,
`total_spent_cents`, `booking_count`, `last_booking_at` (maintained by
`refreshCustomerStats`), `internal_notes`, `marketing_consent`.
Partial unique index `customers_normalized_email_live_unique` (where
`status <> 'merged'`) — created only if the data has no duplicates.

### `services` (+ columns)
`slug` (unique), `visible_in_booking`, `quote_only`, `metadata`, `archived_at`.

### `blocked_times` (+ columns)
`room_id`, `kind`, `series_id` (weekly repeats), `google_calendar_event_id`,
`deleted_at`/`deleted_by` (soft delete), `updated_at`, `tz_version`
(NULL = pre-CRM row stored as ET-as-UTC, converted once by 0007; 2 = real UTC).

## New tables

| table | purpose / key rules |
| --- | --- |
| `rooms` | id 1 = Main Studio, `America/New_York` |
| `setups` | Podcast Set, Photo Studio (informational) |
| `roles` | `permissions` JSONB; 4 system roles (`is_system`) |
| `admin_profiles` | unique `normalized_email`, `role_id`, `status` active/invited/disabled |
| `admin_login_tokens` | consumed magic-link `jti` (one-time links) |
| `audit_logs` | actor, operation, entity, outcome, sanitised before/after/metadata |
| `customer_notes` | timestamped staff notes |
| `purchases` | order, customer, type, status, cents, Stripe ids, review flag |
| `purchase_items` | **immutable** line snapshots (trigger rejects UPDATE/DELETE) |
| `refunds` | per refund; `stripe_refund_id` unique; `amount_cents > 0` |
| `webhook_events` | unique (`provider`, `external_event_id`); received → processing → processed/failed |
| `email_logs` | unique `dedupe_key`; pending/sent/failed/skipped; `context` for re-render |
| `availability_overrides` | one row per (room, date): holiday / day off / closure / custom hours |
| `package_plans`, `package_plan_items` | plan per package service; eligible services + credits |
| `customer_packages` | balance (`remaining_credits ≥ 0`), expiry, plan snapshot |
| `package_credit_transactions` | ledger: grant/redeem/restore/expire/adjustment; `balance_after ≥ 0`; one redeem and one restore per booking (partial unique indexes) |
| `rate_limits` | hashed keys, fixed windows |

### Purchase statuses
`pending` (awaiting payment) · `paid` · `partially_refunded` · `refunded`
(derived from succeeded refunds) · `approved` ($0: tours, comps) ·
`cancelled` (unpaid, released) · `failed`.

### Relationships

```
customers 1─* bookings *─1 services
customers 1─* purchases 1─* purchase_items
purchases 1─* bookings (booking purchase) / 1─1 customer_packages (package purchase)
purchases 1─* refunds *─0..1 bookings
customer_packages 1─* package_credit_transactions *─0..1 bookings
package_plans 1─* package_plan_items *─1 services ; package_plans 0..1─1 services (the package service)
roles 1─* admin_profiles
```

## Customer self-service (0016)

### `bookings` (+ columns)
| column | notes |
| --- | --- |
| `manage_token_hash` | sha256 of the Manage Booking link token; unique when set; lookup only |
| `manage_token_nonce` | random 32 bytes (hex); token = HMAC(`BOOKING_MANAGE_SECRET`, booking id + nonce) |
| `manage_token_issued_at`, `manage_token_revoked_at` | rotation / revocation (`lib/manageToken.ts`) |
| `policy_version`, `policy_accepted_at` | the policies (`lib/policies.ts → POLICY_VERSION`) the customer agreed to before paying |

The raw token is never stored, logged, sent to Stripe, Sheets or analytics.

### `temporary_holds` (+ columns)
`kind` (`booking` · `extension`, CHECK) and `booking_id` (the booking an
extension hold belongs to). An extension hold blocks its range like any hold.

### `booking_extensions` (new)
| column | notes |
| --- | --- |
| `booking_id` → bookings, `purchase_id` → purchases (unique) | the extension's own purchase, `type = 'extension'` |
| `hold_id` | the hold over the added range while paying |
| `added_minutes`, `previous_end_time`, `new_end_time`, `previous_duration_minutes`, `new_duration_minutes` | CHECK new = previous + added |
| `status` | `pending` → `confirmed` (webhook applied it) · `cancelled` (expired) · `failed` · `needs_review` (paid but the time can't be given — refund) |
| `stripe_checkout_session_id` (unique), `stripe_payment_intent_id`, `review_reason`, `confirmed_at` | |

Money for an extension lives only in its purchase and immutable line items
(service hours + hourly add-ons). The booking's legacy `subtotal` /
`total_amount` keep the original booking amount, so the purchase ↔ booking
reconciliation (`purchase_total_mismatches`) stays 0.

### Widened CHECKs
`purchases.type` + `extension`; `refunds.source` + `customer`.
