# Google Calendar & Google Sheets integration

Every confirmed booking is mirrored to Google:

| Booking | Google Calendar | Google Sheet tab |
| --- | --- | --- |
| Paid podcast or photography session (Stripe payment succeeded) | event | **Paid Bookings** |
| Service with category `tour` (e.g. Free Studio Tour) | event | **Studio Tours** |
| Any other $0 service | event | — (not recorded) |
| Monthly package (category `package`) | — (never a time slot) | — (requested via contact form, not a studio session) |
| Pending / payment_pending / failed / cancelled | — | — |

A $0 price never makes a booking a tour — only the service category `tour` does.

## How it works

- **Auth** (`src/lib/googleAuth.ts`): one Google service account, one JWT client with the
  `calendar` and `spreadsheets` scopes. The account has **no project IAM roles**; it can only
  touch the one calendar and the one spreadsheet that were explicitly shared with it.
- **Calendar** (`src/lib/googleCalendar.ts`): events use `America/New_York` wall-clock time (Google
  applies EST/EDT). The event ID is derived from the booking ID, so a retry or a concurrent run
  gets `409 Conflict` and reuses the existing event instead of creating a second one. Events carry
  `extendedProperties.private.bookingId` / `bookingType`. The customer is **not** added as an
  attendee (they already get our confirmation email).
- **Sheets** (`src/lib/googleSheets.ts`): validates that both tabs exist with the exact header
  rows, never creates/renames/clears anything. Upsert order: the row saved in
  `bookings.google_sheets_row_id` (if it still holds this Booking ID) → bounded lookup of the
  Booking ID column (last 10,000 rows) → append. User-entered text is written as plain text, so
  values starting with `=`, `+`, `-`, `@` can't become formulas.
- **Orchestration** (`src/lib/integrationSync.ts`): each sync runs under a per-booking Postgres
  advisory lock, re-reads the booking, and stores the result (`google_calendar_event_id` is only
  written if still empty). One `integration_logs` row per attempt (`google_calendar` /
  `google_sheets`, `success` / `failed`) with a short, secret-free message.
- A failure in any integration is logged and never changes the booking's status or payment.
- **Admin** (`/admin`): yes/no configuration status, last successful sync times, recent
  Calendar/Sheets log entries, a read-only **Test connection** button, and a **Retry sync**
  button on confirmed bookings missing an event or a row (Calendar + Sheets only — never Stripe,
  never emails).

## Environment variables (Vercel → Production)

| Name | Value |
| --- | --- |
| `GOOGLE_CALENDAR_EMAIL` | `client_email` from the service account JSON key |
| `GOOGLE_CALENDAR_PRIVATE_KEY` | `private_key` from the JSON key (literal `\n` sequences or real line breaks both work) |
| `GOOGLE_CALENDAR_ID` | Calendar ID of the "ZAYRO Studios Bookings" calendar |
| `GOOGLE_SHEETS_ID` | The part of the spreadsheet URL between `/d/` and `/edit` |

`GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` are accepted as aliases.
The old `GOOGLE_SHEETS_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY` and `GOOGLE_SHEETS_SHEET_NAME` are
**not used** and can be deleted from Vercel.

Mark the private key as **Sensitive** in Vercel. Never paste it into chat, a terminal command,
a commit, or `.env.example`.

## One-time setup

### 1. Enable the two APIs

Google Cloud console → project **ZAYRO Studios Booking** → *APIs & Services → Library* → enable
**Google Calendar API** and **Google Sheets API**.

### 2. Create the service account key (organization policy)

Key creation fails with *"An organization policy that blocks service account key creation has
been enforced on your organization"*. That is the constraint **Disable service account key
creation** — not *Disable service account creation*, which is a different policy.

It exists in two variants; check both:

- `iam.managed.disableServiceAccountKeyCreation` (managed constraint — the one in the error)
- `iam.disableServiceAccountKeyCreation` (legacy constraint)

Make a temporary exception **for this one project only**:

1. You need the **Organization Policy Administrator** role on the *organization*. If the policy
   page is read-only: switch the project picker to the organization → *IAM & Admin → IAM* →
   *Grant access* → your account → role *Organization Policy Administrator* → Save.
2. Switch the project picker back to **ZAYRO Studios Booking** (the project, not the organization).
3. *IAM & Admin → Organization Policies* → filter for `disableServiceAccountKeyCreation`.
4. Open **Disable service account key creation** (`iam.managed.disableServiceAccountKeyCreation`)
   → *Manage policy* → *Policy source*: **Override parent's policy** → *Add a rule* →
   *Enforcement*: **Off** (Not enforced) → **Set policy**.
5. If the legacy `iam.disableServiceAccountKeyCreation` also shows as enforced, do the same for it.
6. Wait ~2–5 minutes for it to propagate.
7. *IAM & Admin → Service Accounts* → `zayro-booking-integration` → *Keys* → *Add key* →
   *Create new key* → **JSON** → *Create*. Create exactly one key.
8. Put its values into Vercel (see step 5 below), then **delete the downloaded JSON file** and
   empty the Trash.
9. Restore protection: reopen each policy you changed → *Manage policy* → **Inherit parent's
   policy** → *Set policy*. The key you created keeps working; only new keys are blocked again.

Do **not** grant the service account `Owner`, `Editor` or any other role on the project — it
doesn't need any.

### 3. Share the spreadsheet

Open **ZAYRO Studios — Bookings & Tours** → *Share* → add the service account's `client_email`
→ **Editor** → uncheck *Notify people* → *Share*. Leave General access as *Restricted*.

Tabs must be named exactly `Paid Bookings` and `Studio Tours`, and row 1 must contain these
headers, in this order:

- **Paid Bookings (A–T):** Created At, Booking ID, Booking Date, Start Time, End Time, Service,
  Category, Customer First Name, Customer Last Name, Customer Email, Customer Phone, Company,
  Subtotal, Tax, Total, Payment Status, Stripe Session ID, Stripe Payment ID, Calendar Event ID, Notes
- **Studio Tours (A–M):** Created At, Booking ID, Tour Date, Start Time, End Time, Customer First
  Name, Customer Last Name, Customer Email, Customer Phone, Company, Calendar Event ID, Status, Notes

### 4. Share the calendar

1. Google Calendar → *Other calendars* **+** → *Create new calendar* → name
   **ZAYRO Studios Bookings**, time zone **(GMT-05:00) Eastern Time – New York** (skip if it exists).
2. *Settings* → under *Settings for my calendars* pick **ZAYRO Studios Bookings**.
3. *Share with specific people or groups* → *Add people and groups* → the service account's
   `client_email` → permission **Make changes to events** → *Send*.
4. *Integrate calendar* → copy **Calendar ID** (looks like `…@group.calendar.google.com`).

If the permission list only offers free/busy, Google Workspace is limiting external calendar
sharing: Admin console → *Apps → Google Workspace → Calendar → Sharing settings → External
sharing options for primary calendars / secondary calendars* must allow sharing all information
and allow managing calendars.

### 5. Vercel

Vercel → project → *Settings → Environment Variables* → **Production**: set
`GOOGLE_CALENDAR_EMAIL`, `GOOGLE_CALENDAR_PRIVATE_KEY` (Sensitive), `GOOGLE_CALENDAR_ID`,
`GOOGLE_SHEETS_ID`. Then *Deployments* → latest production deployment → ⋯ → **Redeploy**.

### 6. Verify

`/admin` → *Google Calendar & Sheets*: all six rows should say **yes**. Click
**Test connection (read-only)** — it reads calendar metadata and both header rows; it writes
nothing. Then make one Stripe **test-mode** booking and one Free Studio Tour booking and confirm
the event and the row appear.

## Free Studio Tour service

Tours are services with category `tour` (migration `drizzle/0001_service_category_tour.sql`,
applied automatically on the production build). Create it in `/admin` → *Services*: name
"Free Studio Tour", price 0, duration as desired, category **tour**. It is booked through the
normal flow: free confirmation without Stripe, the slot is blocked like any other booking.

## Troubleshooting

| Symptom in logs / Test connection | Fix |
| --- | --- |
| `…not configured: GOOGLE_…` | Variable missing in Vercel Production, or not redeployed |
| `GOOGLE_CALENDAR_PRIVATE_KEY (not a valid PEM private key)` | Paste the whole `private_key` value, including the BEGIN/END lines |
| `Google Calendar API has not been used in project…` / `…Sheets API…` | Step 1 |
| `Not Found (HTTP 404)` for the calendar | Wrong `GOOGLE_CALENDAR_ID`, or calendar not shared with the service account |
| `You need to have writer access to this calendar` | Share permission must be *Make changes to events* |
| `The caller does not have permission (HTTP 403)` for Sheets | Spreadsheet not shared with the service account as Editor |
| `Tab "…" was not found` / `Header row of "…" is wrong: column X…` | Fix the tab name / header cell exactly as listed; nothing is written until it matches |

After fixing, use **Retry sync** on affected bookings in `/admin`.

## Why not Workload Identity Federation?

Keyless auth via Vercel OIDC → Google Workload Identity Federation would avoid long-lived keys
entirely and isn't affected by the key-creation policy. It needs a workload identity pool and
provider trusting Vercel's OIDC issuer, `roles/iam.workloadIdentityUser` on the service account,
the IAM Service Account Credentials API, and a different auth client in `googleAuth.ts`. Because
a project-scoped policy exception is available and the key is stored only as a Sensitive Vercel
variable, the service account key flow was chosen. If the organization ever forbids exceptions,
switching to WIF only requires changing `getGoogleAuth()`; nothing else depends on the key.
