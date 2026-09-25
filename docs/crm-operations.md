# CRM operations guide

All times in the CRM are New York time. Everything below is in `/admin`.

## Daily
- **Dashboard** — red banner = a customer paid but the booking can't go
  ahead (cancelled first, or the slot was taken). Open the purchase and
  either *Refund…* or *No refund needed…* (with a reason).
- **Integrations** — failed Stripe events, unsent emails and bookings
  without a Calendar event, each with its own retry button.

## Bookings
| Task | Where | Notes |
| --- | --- | --- |
| Book for a customer | Sessions → New booking (or click an empty hour in Calendar) | Same availability as the website. "Allow outside hours" books off-grid but never on top of someone. Payment: pay at studio, complimentary, already paid (not Stripe), or package credit. |
| Move / change service | Session → Reschedule | Calendar event is updated in place, sheet row updated, optional email. Price paid never changes. |
| Completed / no-show | Session (after it started) | Reversible with *Reopen*. |
| Cancel | Session → Cancel booking | Type the booking ID + reason. Frees the slot, marks the Calendar event CANCELLED, updates the sheet row, restores a package credit. **Never refunds.** |
| Refund | Purchase or Session → Refund… | Full or partial; two-step confirmation; optional "also cancel". Stripe refunds use the refund's id as idempotency key. |
| Record cash/terminal payment | Purchase → Mark as paid | Only for non-Stripe purchases. |

## Studio setup
- **Availability** — weekly hours, booking rules (interval, cutoff, buffers,
  horizon), holidays / special hours (refused if it would strand bookings),
  and a preview of what customers will see.
- **Blocked time** — single or weekly repeating; refused on top of a
  confirmed booking; mirrored to Google Calendar when configured.
- **Services** — prices affect new bookings only. Switch a service off to
  hide it; nothing is deleted.

## Packages (manual, staff-driven)
1. Customer → *Assign package* (or Packages → Assign): choose plan and
   payment → purchase + credits are created.
2. When booking for them, choose *Use a package credit*.
3. Cancelling that booking gives the credit back (once).
4. Package page shows the full ledger; *Adjust credits* needs a reason.
Credits expire automatically after the plan's validity (checked whenever
packages are viewed or used). The public site still says *Request Monthly
Package*.

## Customers
Duplicates (same person, two records): open the record to keep →
*Merge a duplicate…* → preview → type the confirmation phrase. The other
record is kept as "merged"; future bookings with its email land on the kept
one. Different emails need a longer phrase.

## Team
Team & Roles → add an email with a role; they sign in at `/admin/login`.
Change roles or disable access there. Owners only.

## Retry rules
- *Retry Calendar + Sheets* never sends email.
- *Retry email* never touches Calendar/Sheets and never re-sends a sent email.
- *Retry* on a Stripe event re-fetches it from Stripe; processing is
  idempotent, so it can't double-confirm or double-refund.

## Metrics definitions (Dashboard)
- Gross revenue = Σ purchase totals (incl. tax) with money collected
  (paid / partially refunded / refunded), by payment date in range.
- Net revenue = gross − succeeded refunds dated in range.
- Sales tax = Σ tax on those purchases.
- Revenue by service/category = Σ line-item amounts (pre-tax, before refunds).
- Bookings = confirmed + completed + no-show + cancelled starting in range
  (abandoned checkouts excluded); Paid = room-holding with a collected
  non-zero payment; Free tours = room-holding tour bookings.
- Utilisation = booked minutes ÷ open minutes (weekly hours + overrides −
  blocked time) in range.

## Local development
`.env.development.local` (gitignored) points `next dev` at a local database
and blanks Stripe/Resend/Google so nothing real is touched. Rebuild a local
DB: see `docs/crm-migration-and-rollback.md` → Rehearsal.
