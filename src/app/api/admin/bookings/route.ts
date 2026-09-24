import { NextRequest, NextResponse } from 'next/server';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { errorResponse, CrmError } from '@/lib/crm/errors';
import { manualBookingSchema } from '@/lib/crm/validation';
import { createManualBooking, type ManualPayment } from '@/lib/crm/bookings';

export const dynamic = 'force-dynamic';

/** Staff creates a booking for a customer. */
export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'bookings.create');
  if (!guard.ok) return guard.response;
  try {
    const v = manualBookingSchema.parse(await readJsonObject(request));
    // Recording money needs the purchases permission; comp / package / pay-later don't.
    if (v.paymentMode === 'offline_paid' && !guard.admin.can('purchases.create')) {
      throw new CrmError('Your role cannot record payments', 403);
    }
    if (v.overrideHours && !guard.admin.can('availability.manage') && !guard.admin.can('bookings.update')) {
      throw new CrmError('Your role cannot book outside opening hours', 403);
    }
    const payment: ManualPayment =
      v.paymentMode === 'package'
        ? { mode: 'package', customerPackageId: v.customerPackageId! }
        : v.paymentMode === 'offline_paid'
          ? { mode: 'offline_paid', method: v.paymentMethod! }
          : { mode: v.paymentMode };
    const { booking, effects } = await createManualBooking(
      {
        serviceId: v.serviceId,
        date: v.date,
        startTime: v.startTime,
        customer: v.customerId
          ? { customerId: v.customerId }
          : { email: v.email!, firstName: v.firstName, lastName: v.lastName, phone: v.phone, company: v.company },
        notes: v.notes,
        internalNotes: v.internalNotes,
        payment,
        overrideHours: v.overrideHours,
        sendConfirmation: v.sendConfirmation,
      },
      actorOf(guard.admin)
    );
    return NextResponse.json({ id: booking.id, bookingId: booking.booking_id, effects, message: `Booking ${booking.booking_id} created` });
  } catch (error) {
    return errorResponse(error, 'create booking');
  }
}
