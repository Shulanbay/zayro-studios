// Read-only CRM migration report: record counts, duplicate / conflict
// checks and (once the CRM migrations exist) backfill reconciliation.
//
//   node --env-file=.env.local scripts/crm-dry-run.mjs
//
// Runs inside a READ ONLY transaction, so it cannot change anything. Prints
// counts only — never names, emails, phone numbers or any other row content.
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

async function tableExists(tx, name) {
  const rows = await tx.unsafe(`SELECT to_regclass($1) AS t`, [`public.${name}`]);
  return rows[0].t !== null;
}

async function columnExists(tx, table, column) {
  const rows = await tx.unsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function scalar(tx, text) {
  const rows = await tx.unsafe(text);
  return Number(Object.values(rows[0])[0]);
}

async function grouped(tx, text) {
  const rows = await tx.unsafe(text);
  return Object.fromEntries(rows.map((r) => [String(r.k), Number(r.n)]));
}

const report = {};

try {
  await client.begin('READ ONLY', async (tx) => {
    const hasJournal = (await tx.unsafe(`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`))[0].t !== null;
    report.appliedMigrations = hasJournal
      ? await scalar(tx, `SELECT count(*) FROM "drizzle"."__drizzle_migrations"`)
      : 0;

    report.counts = {};
    for (const t of [
      'services', 'customers', 'bookings', 'payments', 'temporary_holds', 'availability',
      'blocked_times', 'business_settings', 'integration_logs',
      // CRM tables (absent before 0005)
      'roles', 'admin_profiles', 'audit_logs', 'rooms', 'setups', 'purchases', 'purchase_items',
      'refunds', 'webhook_events', 'email_logs', 'customer_notes', 'availability_overrides',
      'package_plans', 'package_plan_items', 'customer_packages', 'package_credit_transactions',
    ]) {
      report.counts[t] = (await tableExists(tx, t)) ? await scalar(tx, `SELECT count(*) FROM "${t}"`) : 'absent';
    }

    report.bookingsByStatus = await grouped(tx, `SELECT status::text AS k, count(*) AS n FROM bookings GROUP BY 1 ORDER BY 1`);
    report.bookingsByPaymentStatus = await grouped(tx, `SELECT payment_status::text AS k, count(*) AS n FROM bookings GROUP BY 1 ORDER BY 1`);
    report.paymentsByStatus = await grouped(tx, `SELECT status::text AS k, count(*) AS n FROM payments GROUP BY 1 ORDER BY 1`);
    report.servicesByCategory = await grouped(tx, `SELECT category::text AS k, count(*) AS n FROM services GROUP BY 1 ORDER BY 1`);
    report.integrationLogsByType = await grouped(tx, `SELECT integration_type::text || ':' || status::text AS k, count(*) AS n FROM integration_logs GROUP BY 1 ORDER BY 1`);

    report.checks = {
      // Customers that would collapse into one when emails are normalised.
      customerEmailGroupsWithDuplicates: await scalar(
        tx,
        `SELECT count(*) FROM (SELECT lower(btrim(email)) FROM customers GROUP BY 1 HAVING count(*) > 1) d`
      ),
      bookingsWithMissingCustomer: await scalar(
        tx,
        `SELECT count(*) FROM bookings b WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = b.customer_id)`
      ),
      bookingsWithMissingService: await scalar(
        tx,
        `SELECT count(*) FROM bookings b WHERE NOT EXISTS (SELECT 1 FROM services s WHERE s.id = b.service_id)`
      ),
      // Would block the exclusion constraint added in 0006.
      overlappingConfirmedBookingPairs: await scalar(
        tx,
        `SELECT count(*) FROM bookings a JOIN bookings b
           ON a.id < b.id AND a.booking_date = b.booking_date
          AND a.status IN ('confirmed', 'completed') AND b.status IN ('confirmed', 'completed')
          AND a.start_time < b.end_time AND b.start_time < a.end_time`
      ),
      bookingsEndingAtOrBeforeStart: await scalar(tx, `SELECT count(*) FROM bookings WHERE end_time <= start_time`),
      paidBookingsWithoutPaymentRow: await scalar(
        tx,
        `SELECT count(*) FROM bookings b WHERE b.total_amount > 0 AND b.stripe_session_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id)`
      ),
      paymentsWithoutBooking: await scalar(
        tx,
        `SELECT count(*) FROM payments p WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = p.booking_id)`
      ),
      bookingsPaidAfterCancellation: await scalar(
        tx,
        `SELECT count(*) FROM bookings WHERE status = 'cancelled' AND payment_status = 'succeeded' AND total_amount > 0`
      ),
      blockedTimesTotal: await scalar(tx, `SELECT count(*) FROM blocked_times`),
    };

    report.bookingSettings = await grouped(
      tx,
      `SELECT setting_key AS k, CASE WHEN setting_value ~ '^[0-9.]+$' THEN setting_value ELSE NULL END AS n
         FROM business_settings
        WHERE setting_key IN ('tax_rate', 'buffer_before_booking', 'buffer_after_booking',
                              'booking_increment_minutes', 'min_advance_notice_hours', 'max_booking_horizon_days')`
    );
    report.availability = (
      await tx.unsafe(`SELECT day_of_week::text AS d, start_time, end_time, is_available FROM availability ORDER BY id`)
    ).map((r) => `${r.d} ${r.start_time}-${r.end_time}${r.is_available ? '' : ' (closed)'}`);

    // Reconciliation once the CRM migrations have run.
    if (await columnExists(tx, 'bookings', 'purchase_id')) {
      report.reconciliation = {
        bookingsWithoutPurchase: await scalar(tx, `SELECT count(*) FROM bookings WHERE purchase_id IS NULL`),
        bookingsWithoutStartsAt: await scalar(tx, `SELECT count(*) FROM bookings WHERE starts_at IS NULL OR ends_at IS NULL`),
        purchasesWithoutItems: await scalar(
          tx,
          `SELECT count(*) FROM purchases p WHERE NOT EXISTS (SELECT 1 FROM purchase_items i WHERE i.purchase_id = p.id)`
        ),
        purchaseTotalMismatches: await scalar(
          tx,
          `SELECT count(*) FROM purchases p JOIN bookings b ON b.purchase_id = p.id
            WHERE p.type <> 'package' AND p.total_cents <> round(b.total_amount * 100)::int`
        ),
        customersWithoutNormalizedEmail: await scalar(tx, `SELECT count(*) FROM customers WHERE normalized_email IS NULL`),
        blockedTimesNotShifted: await scalar(tx, `SELECT count(*) FROM blocked_times WHERE tz_version IS NULL`),
        exclusionConstraintInstalled:
          (await scalar(tx, `SELECT count(*) FROM pg_constraint WHERE conname = 'bookings_no_overlap'`)) > 0,
        ownerRoleExists: (await scalar(tx, `SELECT count(*) FROM roles WHERE name = 'Owner'`)) > 0,
        packagePlans: await scalar(tx, `SELECT count(*) FROM package_plans`),
      };
    }
  });

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error('[crm-dry-run] failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
