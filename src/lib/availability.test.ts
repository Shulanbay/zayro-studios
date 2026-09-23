import { describe, it, expect } from 'vitest';
import { generateSlotsForDay, timeToMinutes, minutesToTime, overlaps, getDayOfWeek } from './availability';

describe('timeToMinutes / minutesToTime', () => {
  it('round-trips HH:MM', () => {
    expect(timeToMinutes('09:30')).toBe(570);
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(0)).toBe('00:00');
    expect(timeToMinutes('23:45')).toBe(1425);
  });
});

describe('overlaps', () => {
  it('detects overlapping ranges', () => {
    expect(overlaps(60, 120, 90, 150)).toBe(true); // partial overlap
    expect(overlaps(60, 120, 0, 60)).toBe(false); // touching edges, not overlapping
    expect(overlaps(60, 120, 120, 180)).toBe(false); // touching edges, not overlapping
    expect(overlaps(60, 120, 70, 80)).toBe(true); // fully contained
  });
});

describe('getDayOfWeek', () => {
  it('uses UTC day so it is DST/timezone independent', () => {
    // 2026-09-24 is a Thursday in UTC regardless of local machine timezone.
    expect(getDayOfWeek(new Date('2026-09-24T00:00:00Z'))).toBe('Thursday');
    // A date that would roll to the previous/next day under a naive local
    // conversion — verifies we always read the UTC calendar day.
    expect(getDayOfWeek(new Date('2026-03-08T00:00:00Z'))).toBe('Sunday'); // US DST start
    expect(getDayOfWeek(new Date('2026-11-01T00:00:00Z'))).toBe('Sunday'); // US DST end
  });
});

describe('generateSlotsForDay', () => {
  const base = {
    businessStart: timeToMinutes('09:00'),
    businessEnd: timeToMinutes('18:00'),
    durationMinutes: 60,
    incrementMinutes: 30,
    minSlotStart: timeToMinutes('09:00'),
    busyRanges: [],
    blockedRanges: [],
  };

  it('generates slots across the full business day at the given increment', () => {
    const slots = generateSlotsForDay(base);
    expect(slots[0]).toEqual({ start: '09:00', end: '10:00', available: true });
    expect(slots[slots.length - 1]).toEqual({ start: '17:00', end: '18:00', available: true });
    // (18:00 - 9:00 - 60min duration) / 30min increment + 1 = 17 slots
    expect(slots.length).toBe(17);
  });

  it('marks slots that overlap a confirmed booking or hold as unavailable', () => {
    const slots = generateSlotsForDay({
      ...base,
      busyRanges: [{ start: timeToMinutes('10:00'), end: timeToMinutes('11:00') }],
    });
    const slot0930 = slots.find((s) => s.start === '09:30')!;
    const slot1000 = slots.find((s) => s.start === '10:00')!;
    const slot1100 = slots.find((s) => s.start === '11:00')!;
    expect(slot0930.available).toBe(false); // 09:30-10:30 overlaps 10:00-11:00
    expect(slot1000.available).toBe(false);
    expect(slot1100.available).toBe(true); // starts exactly when the busy range ends
  });

  it('marks slots inside a blocked time range as unavailable', () => {
    const slots = generateSlotsForDay({
      ...base,
      blockedRanges: [{ start: timeToMinutes('14:00'), end: timeToMinutes('16:00') }],
    });
    expect(slots.find((s) => s.start === '14:30')!.available).toBe(false);
    expect(slots.find((s) => s.start === '13:00')!.available).toBe(true);
    expect(slots.find((s) => s.start === '16:00')!.available).toBe(true);
  });

  it('excludes past times via minSlotStart (e.g. "today" cutoff / advance notice)', () => {
    const slots = generateSlotsForDay({ ...base, minSlotStart: timeToMinutes('14:00') });
    expect(slots.every((s) => timeToMinutes(s.start) >= timeToMinutes('14:00'))).toBe(true);
    expect(slots.find((s) => s.start === '09:00')).toBeUndefined();
  });

  it('returns no slots when minSlotStart pushes past business close (fully past date)', () => {
    const slots = generateSlotsForDay({ ...base, minSlotStart: timeToMinutes('20:00') });
    expect(slots.length).toBe(0);
  });

  it('never offers a slot shorter than the requested duration at day boundary', () => {
    const slots = generateSlotsForDay(base);
    for (const slot of slots) {
      expect(timeToMinutes(slot.end) - timeToMinutes(slot.start)).toBe(base.durationMinutes);
      expect(timeToMinutes(slot.end)).toBeLessThanOrEqual(base.businessEnd);
    }
  });

  it('respects buffers already folded into busyRanges', () => {
    // Simulates a 60-min booking at 12:00-13:00 with a 15-min buffer each side.
    const slots = generateSlotsForDay({
      ...base,
      busyRanges: [{ start: timeToMinutes('12:00') - 15, end: timeToMinutes('13:00') + 15 }],
    });
    expect(slots.find((s) => s.start === '11:30')!.available).toBe(false); // 11:30-12:30 hits the buffer
    expect(slots.find((s) => s.start === '13:30')!.available).toBe(true); // clear of the buffered range (13:15-14:30)
  });
});
