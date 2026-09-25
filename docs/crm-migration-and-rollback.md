# CRM migration and rollback

## What runs
`npm run build` → `scripts/migrate.mjs` (Vercel production builds only, or
`RUN_DB_MIGRATIONS=1`). Each file is its own transaction under an advisory
lock; a failure fails the build and the previous deployment keeps serving.

| File | Contents | Risk controls |
| --- | --- | --- |
| `0005_crm_enum_values` | `booking_status.no_show`, `payment_status.partially_refunded` | `ADD VALUE IF NOT EXISTS`; committed before use |
| `0006_crm_schema` | new tables, new nullable/defaulted columns, triggers, setting defaults | additive only; `IF NOT EXISTS`; old code keeps working |
| `0007_crm_backfill` | roles, setups, customer emails, service slugs, booking ranges/source, purchases + items for every booking, customer stats, package plans, blocked-time ET fix, conditional unique index | every statement only touches unprocessed rows; purchase amounts copied from each booking's own subtotal/tax/total |
| `0008_booking_overlap_guard` | `btree_gist` + `bookings_no_overlap` | skipped with a NOTICE if the extension is unavailable or overlapping bookings exist |

The build log prints a **counts-only** report before and after
(`[migrate] before: {...}` / `after: {...}`) plus any NOTICEs.

## Pre-deploy checklist
1. Optional dry run (read-only, counts only) from a machine that can reach the
   production database:
   `DATABASE_URL=… node scripts/crm-dry-run.mjs`
   Check `checks.overlappingConfirmedBookingPairs` (should be 0) and
   `customerEmailGroupsWithDuplicates` (duplicates just mean the unique index
   waits until they're merged).
2. Neon: create a branch / point-in-time restore point just before deploying
   (Neon console → Branches → *Create branch* from `main` "now").
3. Deploy; read the `[migrate]` lines in the Vercel build log.

## Post-deploy reconciliation (expected)
- `bookings` unchanged; `bookings_without_purchase = 0`;
  `purchase_total_mismatches = 0`; `purchases = bookings` (plus any purchases
  created by new traffic).
- `overlap_constraint = 1` (else see NOTICE and Integrations → Health).
- `roles = 4`; admin profile created at first Owner sign-in.
- `blocked_times` count unchanged; each pre-existing block now shows the
  same ET hours it blocked before (it was stored as ET-as-UTC).
- Admin → Integrations → Health shows migrations = 9.

## Rollback
The migrations are additive, so the **previous deployment runs unchanged
against the migrated database** (extra columns/tables are ignored; the
booking trigger fills the new columns for rows old code writes).

1. **Code rollback (normal):** Vercel → Deployments → previous production
   deployment → *Promote to Production*. No database change needed.
   - One behavioural difference while rolled back: old code reads blocked
     times as ET-as-UTC, but they are now real UTC → blocks would be shifted
     by 4–5 hours. If you roll back for longer than a few minutes, reverse the
     shift (below) or re-enter blocks.
2. **Undo the blocked-time shift** (only if staying on old code):
   ```sql
   UPDATE blocked_times
      SET start_datetime = (start_datetime AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC',
          end_datetime   = (end_datetime   AT TIME ZONE 'America/New_York') AT TIME ZONE 'UTC',
          tz_version = NULL
    WHERE tz_version = 2;
   ```
3. **Full database restore:** restore the Neon branch created before the
   deploy. Loses any bookings made after it — prefer 1.
4. **Removing the CRM schema** is never required for a rollback and is not
   recommended (it would delete purchases/refunds/audit history).

## Rehearsal (done locally)
A production-like database (0000–0004 applied, podcast seed, 08:00–22:00
hours, case-variant duplicate customers, paid/cancelled/refunded/pending/
completed bookings, a pre-CRM blocked time) was migrated with the real runner:
- counts preserved; 0 bookings without purchase; 0 total mismatches;
- paid-after-cancel booking flagged for refund review;
- blocked time 13:00Z → 13:00 EDT (17:00Z);
- unique customer index correctly skipped (duplicates present);
- overlap constraint installed; re-running every CRM migration: no change.
The same checks run in CI (`src/lib/db/migrations.test.ts`,
`src/lib/crm/crm.integration.test.ts`).
