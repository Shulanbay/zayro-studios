import { db } from './db';
import { bookings, temporaryHolds, blockedTimes, availability as availabilityTable, businessSettings } from './db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

export interface TimeSlot {
  start: string;
  end: string;
  available: boolean;
}

interface BusyRange {
  start: number; // minutes since midnight
  end: number; // minutes since midnight
}

export function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getDayOfWeek(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getUTCDay()];
}

export function overlaps(slot1Start: number, slot1End: number, slot2Start: number, slot2End: number): boolean {
  return slot1Start < slot2End && slot2Start < slot1End;
}

/**
 * Pure slot generator — no DB access. Takes pre-fetched business hours and
 * busy ranges (already including buffers) and returns every candidate slot
 * for the day, marked available/unavailable. Kept pure so it can be unit
 * tested without a database.
 */
export function generateSlotsForDay(params: {
  businessStart: number; // minutes since midnight
  businessEnd: number; // minutes since midnight
  durationMinutes: number;
  incrementMinutes: number;
  minSlotStart: number; // earliest allowed slot start (advance notice / "now" cutoff), minutes since midnight
  busyRanges: BusyRange[]; // bookings + holds, buffers already applied
  blockedRanges: BusyRange[]; // blocked times, minutes since midnight, already clipped to this day
}): TimeSlot[] {
  const { businessStart, businessEnd, durationMinutes, incrementMinutes, minSlotStart, busyRanges, blockedRanges } = params;
  const slots: TimeSlot[] = [];
  const start = Math.max(businessStart, minSlotStart);

  for (let slotStart = start; slotStart + durationMinutes <= businessEnd; slotStart += incrementMinutes) {
    const slotEnd = slotStart + durationMinutes;
    let isAvailable = true;

    for (const busy of busyRanges) {
      if (overlaps(slotStart, slotEnd, busy.start, busy.end)) {
        isAvailable = false;
        break;
      }
    }

    if (isAvailable) {
      for (const blocked of blockedRanges) {
        if (overlaps(slotStart, slotEnd, blocked.start, blocked.end)) {
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
}

async function getBusinessHours(dayOfWeek: string) {
  const hours = await db.query.availability.findFirst({
    where: and(eq(availabilityTable.day_of_week, dayOfWeek as any), eq(availabilityTable.is_available, true)),
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

export async function expireOldHolds(serviceId?: number, bookingDate?: string) {
  const now = new Date();
  const conditions = [eq(temporaryHolds.status, 'active'), lte(temporaryHolds.hold_expires_at, now)];
  if (serviceId !== undefined) conditions.push(eq(temporaryHolds.service_id, serviceId));
  if (bookingDate !== undefined) conditions.push(eq(temporaryHolds.booking_date, bookingDate));

  await db.update(temporaryHolds)
    .set({ status: 'expired' })
    .where(and(...conditions));
}

async function getBusySettings() {
  const bufferBefore = parseInt((await getSetting('buffer_before_booking')) || '0');
  const bufferAfter = parseInt((await getSetting('buffer_after_booking')) || '0');
  const increment = parseInt((await getSetting('booking_increment_minutes')) || '30');
  const minAdvanceHours = parseFloat((await getSetting('min_advance_notice_hours')) || '1');
  return { bufferBefore, bufferAfter, increment, minAdvanceHours };
}

function computeMinSlotStart(bookingDate: string, businessStart: number, minAdvanceHours: number): number {
  const now = new Date();
  const bookingDateTime = new Date(bookingDate + 'T00:00:00Z');
  const minAdvanceMs = minAdvanceHours * 60 * 60 * 1000;
  const minStartTime = now.getTime() + minAdvanceMs;
  const bookingDateMs = bookingDateTime.getTime();

  if (bookingDateMs + 24 * 60 * 60 * 1000 <= minStartTime) {
    // Entire day is before the cutoff — no slot can qualify.
    return Number.MAX_SAFE_INTEGER;
  }

  if (bookingDateMs <= minStartTime) {
    const minStartMinutes = Math.ceil((minStartTime - bookingDateMs) / 60000);
    return Math.max(businessStart, minStartMinutes);
  }

  return businessStart;
}

export async function getAvailableTimeSlotsForDate(
  serviceId: number,
  bookingDate: string,
  durationMinutes: number
): Promise<TimeSlot[]> {
  try {
    const date = new Date(bookingDate + 'T00:00:00Z');
    const dayOfWeek = getDayOfWeek(date);

    const businessHours = await getBusinessHours(dayOfWeek);
    if (!businessHours) {
      return [];
    }

    await expireOldHolds(serviceId, bookingDate);

    const confirmedBookings = await getConfirmedBookings(serviceId, bookingDate);
    const activeHolds = await getActiveHolds(serviceId, bookingDate);

    const dateStart = new Date(bookingDate + 'T00:00:00Z');
    const dateEnd = new Date(bookingDate + 'T23:59:59Z');
    const blockedForDate = await db.query.blockedTimes.findMany({
      where: and(
        lte(blockedTimes.start_datetime, dateEnd),
        gte(blockedTimes.end_datetime, dateStart),
      ),
    });

    const { bufferBefore, bufferAfter, increment, minAdvanceHours } = await getBusySettings();

    const businessStart = timeToMinutes(businessHours.start_time);
    const businessEnd = timeToMinutes(businessHours.end_time);
    const minSlotStart = computeMinSlotStart(bookingDate, businessStart, minAdvanceHours);

    const busyRanges: BusyRange[] = [
      ...confirmedBookings.map((b) => ({
        start: timeToMinutes(b.start_time) - bufferBefore,
        end: timeToMinutes(b.end_time) + bufferAfter,
      })),
      ...activeHolds.map((h) => ({
        start: timeToMinutes(h.start_time) - bufferBefore,
        end: timeToMinutes(h.end_time) + bufferAfter,
      })),
    ];

    const blockedRanges: BusyRange[] = blockedForDate.map((blocked) => {
      const blockStartMinutes = Math.floor((blocked.start_datetime.getTime() - dateStart.getTime()) / 60000);
      const blockEndMinutes = Math.ceil((blocked.end_datetime.getTime() - dateStart.getTime()) / 60000);
      return { start: blockStartMinutes, end: blockEndMinutes };
    });

    return generateSlotsForDay({
      businessStart,
      businessEnd,
      durationMinutes,
      incrementMinutes: increment,
      minSlotStart,
      busyRanges,
      blockedRanges,
    });
  } catch (error) {
    console.error('Error getting available time slots:', error);
    return [];
  }
}

export async function getAvailableDates(
  serviceId: number,
  fromDate: string,
  toDate: string,
  durationMinutes = 60
): Promise<string[]> {
  try {
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

/**
 * Authoritative server-side check that a specific requested slot is a real,
 * currently-available slot for the service (correct business hours, not in
 * the past, no conflicting booking/hold/blocked time). Used to defend
 * create-hold against a client requesting a slot that was never actually
 * offered.
 */
export async function isSlotActuallyAvailable(
  serviceId: number,
  bookingDate: string,
  startTime: string,
  endTime: string,
  durationMinutes: number
): Promise<boolean> {
  const slots = await getAvailableTimeSlotsForDate(serviceId, bookingDate, durationMinutes);
  return slots.some((s) => s.start === startTime && s.end === endTime && s.available);
}

export async function checkTimeSlotConflict(
  serviceId: number,
  bookingDate: string,
  startTime: string,
  endTime: string
): Promise<boolean> {
  await expireOldHolds(serviceId, bookingDate);

  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  const confirmedBookings = await getConfirmedBookings(serviceId, bookingDate);
  for (const booking of confirmedBookings) {
    const bookingStart = timeToMinutes(booking.start_time);
    const bookingEnd = timeToMinutes(booking.end_time);
    if (overlaps(startMinutes, endMinutes, bookingStart, bookingEnd)) {
      return true;
    }
  }

  const activeHolds = await getActiveHolds(serviceId, bookingDate);
  for (const hold of activeHolds) {
    const holdStart = timeToMinutes(hold.start_time);
    const holdEnd = timeToMinutes(hold.end_time);
    if (overlaps(startMinutes, endMinutes, holdStart, holdEnd)) {
      return true;
    }
  }

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
