# ZAYRO Studios CRM — Roadmap and risk register

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Audit, architecture docs, risk list, migration plan | done |
| 1 | Schema + migrations + backfill, roles/permissions, audit, typed modules | done |
| 2 | Admin shell, dashboard, sessions, customers, calendar, availability, blocked time | done |
| 3 | Purchases, webhook events, refunds, payment status, integration states | done |
| 4 | Packages + credits, reports/CSV, team & roles, settings | done |
| 5 | Browser verification, production deploy, migration verification | local browser + migration rehearsal done; **production deploy waits for owner approval** |

## MVP (all required)

1. Database migrations (0005–0008)
2. Owner and Studio Manager roles (+ Producer, Operator)
3. Closed `/admin` (server-side session + permission on every route)
4. Dashboard with real SQL metrics
5. Sessions list / detail
6. Manual booking
7. Reschedule
8. Cancellation
9. Completion / no-show
10. Customers list / detail
11. Purchases list / detail
12. Availability (weekly hours, rules, overrides, preview)
13. Blocked time
14. Services management
15. Stripe webhook idempotency
16. Double-booking protection (advisory lock + exclusion constraint)
17. Full / partial refunds
18. Google Calendar sync (create, reschedule, cancel)
19. Google Sheets sync (append, update in place)
20. Email statuses and retry
21. Integration diagnostics
22. Audit log
23. CSV export
24. Package plans and manual credit management
25. Public booking unchanged
26. Production verified — **pending owner approval to deploy**

## Deliberately not in the MVP

- Recurring Stripe subscriptions for memberships
- Online "Buy Now" for monthly packages. The public site keeps *Request
  Monthly Package*. The CRM already has everything a later online purchase
  needs (purchase → credit grant → redeem with duplicate protection →
  restore on cancel → expiry), but customer self-service identification
  (email login) does not exist yet, so credits are redeemed by staff when
  they create a booking for the customer.
- Multiple bookable rooms in the public flow (the schema supports rooms; one
  is active)
- Customer self-service portal, video hosting, dynamic pricing, AI features

## Next candidates (after MVP)

1. Customer magic-link portal → self-service package redemption → *Buy Now*
2. Vercel Cron for package expiry and hold clean-up (today both run lazily)
3. Stripe Customer objects (`stripe_customer_id`) and saved receipts
4. Multi-room availability in the public booking flow
5. Enforce `customers.normalized_email` uniqueness once duplicates are merged

## Risk register

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Webhook compared the paid amount with the *current* service price, so a price edit during checkout rejected a real payment | Compare with the booking's own price snapshot (fixed) |
| R2 | Blocked times and the booking cutoff were evaluated as if ET wall-clock were UTC | ET-aware evaluation + one-time data shift of existing `blocked_times` (migration 0007, `tz_version`) |
| R3 | Case-variant emails created duplicate customers | Normalised email + trigger + advisory-locked upsert; merge tool with preview |
| R4 | Double booking only prevented in application code | `bookings_no_overlap` exclusion constraint (btree_gist) + existing per-date advisory lock |
| R5 | Webhook idempotency relied on booking status | `webhook_events` unique event id + claim/processing state |
| R6 | Magic link could be reused within 15 minutes; link scanners could consume a one-time link | One-time `jti` consumed on POST from a confirmation page |
| R7 | Emails interpolated customer text without escaping | All templates escape user input |
| R8 | Old deployment serves traffic while the new build migrates | All migrations are additive; new NOT NULL columns have defaults; triggers keep derived columns correct for old code |
| R9 | Existing overlapping confirmed bookings would make the exclusion constraint fail the build | Constraint is only added when no overlap exists; otherwise a NOTICE is logged and *Integrations → Health* shows it as missing |
| R10 | `btree_gist` unavailable | Extension creation is guarded; the advisory lock still serialises writers |
| R11 | Refund issued in Stripe but a side effect fails | Refund row is committed first; Sheets/email failures are logged and retryable |
| R12 | Admin locks themselves out | The last active Owner cannot be demoted or disabled; `ADMIN_EMAILS` still bootstraps an Owner when no profile exists |
