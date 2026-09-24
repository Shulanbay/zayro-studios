import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { temporaryHolds, services, bookings, integrationLogs } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { pgErrorCode } from '@/lib/db/types';
import { lockStudioDates } from '@/lib/availability';
import { upsertCustomer, refreshCustomerStats } from '@/lib/crm/customers';
import { createPurchase, orderNumberForBooking } from '@/lib/crm/purchases';
import { enforceRateLimit, isHoneypotTripped } from '@/lib/crm/rateLimit';
import { calculatePricing } from '@/lib/pricing';
import { checkBookable } from '@/lib/catalogData';
import { generateBookingId, isValidEmail, isValidPhone, toDateOnly } from '@/lib/utils';
import { runPostConfirmationSideEffects } from '@/lib/postConfirmation';

export const dynamic = 'force-dynamic';

async function logIntegration(bookingId: string | null, status: 'success' | 'failed', message: string) {
  try {
    await db.insert(integrationLogs).values({
      integration_type: 'stripe',
      booking_id: bookingId,
      status,
      error_message: status === 'failed' ? message : null,
      response_data: { message, timestamp: new Date().toISOString() },
    });
  } catch (err) {
    console.error('Error logging integration:', err);
  }
}

/**
 * Confirms a booking without Stripe. Only reachable when the server's own
 * pricing calculation for the hold's service comes out to $0 — the client
 * cannot pick this path for a paid service by sending a fake price, because
 * the price used here is recomputed from the database, not from the request
 * body.
 */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'confirm-free', 20, 600);
  if (limited) return limited;
  try {
    const body = await request.json();
    if (isHoneypotTripped(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const { holdId, firstName, lastName, email, phone, company, notes } = body;

    if (!holdId || !firstName || !lastName || !email || !phone) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    if (!isValidPhone(phone)) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }

    const hold = await db.query.temporaryHolds.findFirst({
      where: eq(temporaryHolds.id, holdId),
    });

    if (!hold) {
      await logIntegration(null, 'failed', 'Free confirm: hold not found');
      return NextResponse.json({ error: 'Booking hold not found' }, { status: 404 });
    }

    const now = new Date();

    if (hold.hold_expires_at <= now) {
      await logIntegration(null, 'failed', 'Free confirm: hold expired');
      return NextResponse.json(
        { error: 'Booking hold has expired. Please select a new time slot.' },
        { status: 410 }
      );
    }

    if (hold.status !== 'active') {
      // Idempotency: if this hold was already converted, return the booking
      // that resulted from it instead of erroring, so a duplicate/retried
      // request from the client doesn't look like a failure.
      if (hold.status === 'converted_to_booking') {
        const existing = await db.query.bookings.findFirst({
          where: and(eq(bookings.customer_email, hold.customer_email), eq(bookings.service_id, hold.service_id)),
          orderBy: (b, { desc }) => [desc(b.created_at)],
        });
        if (existing && toDateOnly(existing.booking_date) === toDateOnly(hold.booking_date) && existing.start_time === hold.start_time) {
          return NextResponse.json({ status: 'already_confirmed', bookingId: existing.booking_id });
        }
      }
      await logIntegration(null, 'failed', 'Free confirm: hold not active');
      return NextResponse.json({ error: 'Booking hold is no longer active' }, { status: 409 });
    }

    if (hold.customer_email.trim().toLowerCase() !== String(email).trim().toLowerCase()) {
      return NextResponse.json({ error: 'This hold belongs to a different customer' }, { status: 403 });
    }

    const service = await db.query.services.findFirst({
      where: eq(services.id, hold.service_id),
    });

    if (!service || !service.is_active) {
      await logIntegration(null, 'failed', 'Free confirm: service not found or inactive');
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    // Monthly packages are never booked into a time slot.
    const bookable = checkBookable(service);
    if (!bookable.ok) {
      await logIntegration(null, 'failed', 'Free confirm: service is a package');
      return NextResponse.json({ error: bookable.error }, { status: bookable.status });
    }

    const pricing = await calculatePricing(hold.service_id);
    if (!pricing) {
      await logIntegration(null, 'failed', 'Free confirm: pricing calculation failed');
      return NextResponse.json({ error: 'Could not calculate pricing' }, { status: 500 });
    }

    // The whole point of this endpoint: reject anything that isn't actually
    // free, server-side, regardless of what the client believes the price is.
    if (pricing.total > 0) {
      await logIntegration(null, 'failed', 'Free confirm: service is not free');
      return NextResponse.json(
        { error: 'This service requires payment and cannot be booked for free.', requiresPayment: true },
        { status: 400 }
      );
    }

    const bookingIdString = generateBookingId();
    const bookingUuid = crypto.randomUUID();

    const bookingDate = toDateOnly(hold.booking_date);
    const isTour = service.category === 'tour';

    // Atomic: under the studio date lock, convert the hold and confirm the
    // booking together. If the hold was converted by a concurrent request,
    // the guarded update affects 0 rows; an overlap the checks missed is
    // rejected by the bookings_no_overlap constraint.
    let confirmed: typeof bookings.$inferSelect | null;
    try {
      confirmed = await db.transaction(async (tx) => {
        await lockStudioDates(tx, [bookingDate]);
        const updatedHolds = await tx
          .update(temporaryHolds)
          .set({ status: 'converted_to_booking' })
          .where(and(eq(temporaryHolds.id, holdId), eq(temporaryHolds.status, 'active')))
          .returning();
        if (updatedHolds.length === 0) return null;

        const customer = await upsertCustomer(tx, { email, firstName, lastName, phone, company }, { updateContact: true });
        const purchase = await createPurchase(tx, {
          orderNumber: orderNumberForBooking(bookingIdString),
          customerId: customer.id,
          type: isTour ? 'studio_tour' : 'individual',
          status: 'approved',
          taxCents: pricing.taxAmount,
          paymentMethod: 'comp',
          purchasedAt: now,
          items: [
            {
              itemType: 'service',
              referenceId: service.id,
              description: `${service.name} — ${bookingDate} ${hold.start_time}–${hold.end_time} ET`,
              unitPriceCents: pricing.subtotal,
              metadata: { bookingId: bookingIdString, category: service.category, durationMinutes: hold.duration_minutes },
            },
          ],
        });

        const inserted = await tx
          .insert(bookings)
          .values({
            id: bookingUuid,
            booking_id: bookingIdString,
            customer_id: customer.id,
            service_id: hold.service_id,
            // Always a plain YYYY-MM-DD: the driver may hand back a Date, which
            // Postgres would otherwise convert using the session time zone.
            booking_date: bookingDate,
            start_time: hold.start_time,
            end_time: hold.end_time,
            duration_minutes: hold.duration_minutes,
            customer_first_name: firstName,
            customer_last_name: lastName,
            customer_email: email,
            customer_phone: phone,
            company_name: company || null,
            notes: notes || null,
            status: 'confirmed',
            payment_status: 'succeeded',
            subtotal: (pricing.subtotal / 100).toFixed(2),
            tax_amount: (pricing.taxAmount / 100).toFixed(2),
            total_amount: (pricing.total / 100).toFixed(2),
            purchase_id: purchase.id,
            source: isTour ? 'studio_tour' : 'individual',
            created_at: now,
            updated_at: now,
          })
          .returning();
        await refreshCustomerStats(tx, customer.id);
        return inserted[0];
      });
    } catch (txError) {
      if (pgErrorCode(txError) === '23P01') {
        await logIntegration(null, 'failed', 'Free confirm: slot was taken by another booking');
        return NextResponse.json({ error: 'That time was just booked by someone else. Please pick another slot.' }, { status: 409 });
      }
      throw txError;
    }

    if (!confirmed) {
      await logIntegration(null, 'failed', 'Free confirm: hold was no longer active at confirmation time');
      return NextResponse.json({ error: 'Booking hold is no longer active' }, { status: 409 });
    }

    await logIntegration(confirmed.id, 'success', 'Free booking confirmed');

    await runPostConfirmationSideEffects(confirmed, service).catch((err) =>
      console.error('Post-confirmation side effects failed:', err)
    );

    return NextResponse.json({
      status: 'confirmed',
      bookingId: confirmed.booking_id,
    });
  } catch (error: any) {
    console.error('Error confirming free booking:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
