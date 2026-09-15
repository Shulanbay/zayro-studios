import { db } from './db';
import { bookings, temporaryHolds, blockedTimes, availability as availabilityTable, businessSettings } from './db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getDayOfWeek(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

async function getBusinessHours(dayOfWeek: string) {
  const hours = await db.query.availability.findFirst({
    where: eq(availabilityTable.day_of_week, dayOfWeek as any),
  });
  return hours;
}

async function getSetting(key: string): Promise<string | null> {
  const result = await db.query.businessSettings.findFirst({
    where: eq(businessSettings.setting_key, key),
  });
  return result?.setting_value || null;
}

async function getConfirmedBookings(serviceId: number, bookingDate: string) {
  return await db.query.bookings.findMany({
    where: and(
      eq(bookings.service_id, serviceId),
      eq(bookings.booking_date, bookingDate),
      eq(bookings.status, 'confirmed'),
    ),
  });
}

async function getActiveHolds(serviceId: number, bookingDate: string) {
  const now = new Date();
  return await db.query.temporaryHolds.findMany({
    where: and(
      eq(temporaryHolds.service_id, serviceId),
      eq(temporaryHolds.booking_date, bookingDate),
      eq(temporaryHolds.status, 'active'),
      gte(temporaryHolds.hold_expires_at, now),
    ),
  });
}

async function expireOldHolds(serviceId: number, bookingDate: string) {
  const now = new Date();
  await db.update(temporaryHolds)
    .set({ status: 'expired' })
    .where(
      and(
        eq(temporaryHolds.service_id, serviceId),
        eq(temporaryHolds.booking_date, bookingDate),
        eq(temporaryHolds.status, 'active'),
        lte(temporaryHolds.hold_expires_at, now),
      )
    );
}

function overlaps(slot1Start: number, slot1End: number, slot2Start: number, slot2End: number): boolean {
  return slot1Start < slot2End && slot2Start < slot1End;
}

export async function getAvailableTimeSlotsForDate(
  serviceId: number,
  bookingDate: string,
  durationMinutes: number
): Promise<TimeSlot[]> {
  try {
    // Get date object from ISO string
    const date = new Date(bookingDate + 'T00:00:00Z');
    const dayOfWeek = getDayOfWeek(date);

    // Get business hours
    const businessHours = await getBusinessHours(dayOfWeek);
    if (!businessHours) {
      return [];
    }

    // Expire old holds
    await expireOldHolds(serviceId, bookingDate);

    // Get all conflicting bookings
    const confirmedBookings = await getConfirmedBookings(serviceId, bookingDate);
    const activeHolds = await getActiveHolds(serviceId, bookingDate);

    // Get blocked times for this date
    const dateStart = new Date(bookingDate + 'T00:00:00Z');
    const dateEnd = new Date(bookingDate + 'T23:59:59Z');
    const blockedForDate = await db.query.blockedTimes.findMany({
      where: and(
        lte(blockedTimes.start_datetime, dateEnd),
        gte(blockedTimes.end_datetime, dateStart),
      ),
    });

    // Get settings
    const bufferBefore = parseInt(await getSetting('buffer_before_booking') || '0');
    const bufferAfter = parseInt(await getSetting('buffer_after_booking') || '0');
    const increment = parseInt(await getSetting('booking_increment_minutes') || '30');
    const minAdvanceHours = parseInt(await getSetting('min_advance_notice_hours') || '24');

    // Parse business hours
    const businessStart = timeToMinutes(businessHours.start_time);
    const businessEnd = timeToMinutes(businessHours.end_time);

    // Check advance notice
    const now = new Date();
    const bookingDateTime = new Date(bookingDate + 'T00:00:00Z');
    const minAdvanceMs = minAdvanceHours * 60 * 60 * 1000;
    const minStartTime = now.getTime() + minAdvanceMs;
    const bookingDateMs = bookingDateTime.getTime();

    let minSlotStart = businessStart;
    if (bookingDateMs <= minStartTime) {
      // Same day or advance notice not met
      const minStartMinutes = Math.ceil((minStartTime - bookingDateMs) / 60000);
      minSlotStart = Math.max(businessStart, minStartMinutes);
    }

    // Generate time slots
    const slots: TimeSlot[] = [];
    for (let slotStart = minSlotStart; slotStart + durationMinutes <= businessEnd; slotStart += increment) {
      const slotEnd = slotStart + durationMinutes;

      // Check for conflicts
      let isAvailable = true;

      // Check confirmed bookings
      for (const booking of confirmedBookings) {
        const bookingStart = timeToMinutes(booking.start_time);
        const bookingEnd = timeToMinutes(booking.end_time);
        if (overlaps(slotStart, slotEnd, bookingStart - bufferBefore, bookingEnd + bufferAfter)) {
          isAvailable = false;
          break;
        }
      }

      // Check active holds
      if (isAvailable) {
        for (const hold of activeHolds) {
          const holdStart = timeToMinutes(hold.start_time);
          const holdEnd = timeToMinutes(hold.end_time);
          if (overlaps(slotStart, slotEnd, holdStart - bufferBefore, holdEnd + bufferAfter)) {
            isAvailable = false;
            break;
          }
        }
      }

      // Check blocked times
      if (isAvailable && blockedForDate.length > 0) {
        const slotStartDate = new Date(bookingDate + 'T' + minutesToTime(slotStart) + ':00Z');
        const slotEndDate = new Date(bookingDate + 'T' + minutesToTime(slotEnd) + ':00Z');
        for (const blocked of blockedForDate) {
          if (slotStartDate < blocked.end_datetime && blocked.start_datetime < slotEndDate) {
            isAvailable = false;
            break;
          }
        }
      }

      slots.push({
        start: minutesToTime(slotStart),
        end: minutesToTime(slotEnd),
        available: isAvailable,
      });
    }

    return slots;
  } catch (error) {
    console.error('Error getting available time slots:', error);
    return [];
  }
}

export async function getAvailableDates(
  serviceId: number,
  fromDate: string,
  toDate: string
): Promise<string[]> {
  try {
    const durationMinutes = 60;
    const availableDates: string[] = [];

    let current = new Date(fromDate + 'T00:00:00Z');
    const end = new Date(toDate + 'T00:00:00Z');

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const slots = await getAvailableTimeSlotsForDate(serviceId, dateStr, durationMinutes);

      if (slots.some((s) => s.available)) {
        availableDates.push(dateStr);
      }

      current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    }

    return availableDates;
  } catch (error) {
    console.error('Error getting available dates:', error);
    return [];
  }
}

export async function checkTimeSlotConflict(
  serviceId: number,
  bookingDate: string,
  startTime: string,
  endTime: string
): Promise<boolean> {
  // Expire old holds first
  await expireOldHolds(serviceId, bookingDate);

  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  // Check confirmed bookings
  const confirmedBookings = await getConfirmedBookings(serviceId, bookingDate);
  for (const booking of confirmedBookings) {
    const bookingStart = timeToMinutes(booking.start_time);
    const bookingEnd = timeToMinutes(booking.end_time);
    if (overlaps(startMinutes, endMinutes, bookingStart, bookingEnd)) {
      return true;
    }
  }

  // Check active holds
  const activeHolds = await getActiveHolds(serviceId, bookingDate);
  for (const hold of activeHolds) {
    const holdStart = timeToMinutes(hold.start_time);
    const holdEnd = timeToMinutes(hold.end_time);
    if (overlaps(startMinutes, endMinutes, holdStart, holdEnd)) {
      return true;
    }
  }

  // Check blocked times
  const dateStart = new Date(bookingDate + 'T00:00:00Z');
  const dateEnd = new Date(bookingDate + 'T23:59:59Z');
  const blockedForDate = await db.query.blockedTimes.findMany({
    where: and(
      lte(blockedTimes.start_datetime, dateEnd),
      gte(blockedTimes.end_datetime, dateStart),
    ),
  });

  const slotStartDate = new Date(bookingDate + 'T' + startTime + ':00Z');
  const slotEndDate = new Date(bookingDate + 'T' + endTime + ':00Z');
  for (const blocked of blockedForDate) {
    if (slotStartDate < blocked.end_datetime && blocked.start_datetime < slotEndDate) {
      return true;
    }
  }

  return false;
}
