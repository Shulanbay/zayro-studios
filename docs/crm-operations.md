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

## Customer self-service (Manage Booking)
Every confirmation email has a private *Manage Your Booking* link. Customers can:
- **Reschedule** at least 24 h before the start (same service, length, setup, extras). Calendar event and sheet row are updated in place; the customer and guests get an email (guests with an updated calendar file).
- **Cancel** at least 24 h before the start: the booking is cancelled and everything paid for it (booking + any extension) is refunded to the original card through the same refund code as the CRM (`source = customer`). A failed refund flags the booking/purchase for review and emails the owner.
- **Add more time** right after the session when the next slot is free (bookings, holds, blocked time, opening hours, 9-hour maximum). They pay through Stripe Checkout; only the webhook extends the booking. Paid-but-unavailable extensions appear as *needs refund review*.
Inside 24 h the link shows the policy and *Contact Studio*.
A customer who lost the link (or booked before Manage Booking existed) uses
*Request a new link* (`/booking/manage/request-link`): booking reference + the
email on the booking; a new link is emailed to that address only.

### Google Sheets — extra-time columns (one-time manual step)
The app never changes the sheet's layout itself. To see extra-time payments,
type these four headers into **Paid Bookings → U1:X1**, exactly:
`Extension Payments (net)` · `Total Paid (net of refunds)` · `Current Duration (min)` · `Current End Time`.
Column O "Total" keeps the original booking total. Until the headers exist the
sheet keeps working as before (Integrations → Test connection says
"Upgrade recommended"). Existing rows fill in the next time each booking syncs
(or use *Retry Calendar + Sheets* on a session).

### Camera configuration
Each podcast package needs `services.metadata.includedCameras` (integer 1–3;
migration 0017 sets Single Podcaster 1, Podcast Pro 3, Full Podcast Package 3).
If it is missing or invalid, Additional Camera is switched off for that
package (and online extra time for bookings that have extra cameras) until it
is fixed; Integrations → Configuration shows the problem. Audit operations: `booking.cancel_by_customer`, `booking.reschedule_by_customer`, `booking.extension_started`, `booking.extend`.

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
