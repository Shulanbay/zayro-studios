import { describe, it, expect } from 'vitest';
import { isValidEmail, isValidPhone, generateBookingId, getBaseUrl, formatBookingDateUTC, toDateOnly } from './utils';
import type { NextRequest } from 'next/server';

describe('isValidEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('a@b.com')).toBe(true);
    expect(isValidEmail('first.last+tag@example.co.uk')).toBe(true);
  });

  it('rejects invalid contact data', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('missing@domain')).toBe(false);
    expect(isValidEmail('@nouser.com')).toBe(false);
    expect(isValidEmail('spaces in@email.com')).toBe(false);
  });
});

describe('isValidPhone', () => {
  it('accepts common formats with at least 10 digits', () => {
    expect(isValidPhone('212-555-0100')).toBe(true);
    expect(isValidPhone('+1 (212) 555-0100')).toBe(true);
  });

  it('rejects invalid contact data', () => {
    expect(isValidPhone('')).toBe(false);
    expect(isValidPhone('123')).toBe(false); // too short
    expect(isValidPhone('call me maybe')).toBe(false); // letters
  });
});

describe('generateBookingId', () => {
  it('produces unique, prefixed IDs', () => {
    const a = generateBookingId();
    const b = generateBookingId();
    expect(a).toMatch(/^ZAY-[A-Z0-9]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe('getBaseUrl', () => {
  it('uses the request origin when available (correct on prod, previews, and localhost alike)', () => {
    const fakeRequest = { nextUrl: { origin: 'https://zayro.studio' } } as unknown as NextRequest;
    expect(getBaseUrl(fakeRequest)).toBe('https://zayro.studio');
  });

  it('falls back to NEXTAUTH_URL when no request is given', () => {
    const original = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = 'https://example.test';
    expect(getBaseUrl()).toBe('https://example.test');
    process.env.NEXTAUTH_URL = original;
  });
});

describe('formatBookingDateUTC / toDateOnly', () => {
  // Regression coverage: production testing found that postgres-js hands
  // back `date` columns as either a bare "YYYY-MM-DD" string, a full ISO
  // timestamp string (after JSON serialization of a Date), or an actual
  // Date object depending on the code path — and naive `new Date(x)` /
  // string concatenation on that value shifted the displayed day by one
  // for any viewer behind UTC, or produced "Invalid Date" / a raw
  // toString() dump in Stripe's checkout description.
  it('formats a bare date string without a day shift', () => {
    expect(formatBookingDateUTC('2026-09-26')).toBe('Saturday, September 26, 2026');
  });

  it('formats a full ISO timestamp string the same way', () => {
    expect(formatBookingDateUTC('2026-09-26T00:00:00.000Z')).toBe('Saturday, September 26, 2026');
  });

  it('formats an actual Date object the same way', () => {
    expect(formatBookingDateUTC(new Date('2026-09-26T00:00:00.000Z'))).toBe('Saturday, September 26, 2026');
  });

  it('toDateOnly normalizes all three shapes to the same YYYY-MM-DD', () => {
    expect(toDateOnly('2026-09-26')).toBe('2026-09-26');
    expect(toDateOnly('2026-09-26T00:00:00.000Z')).toBe('2026-09-26');
    expect(toDateOnly(new Date('2026-09-26T00:00:00.000Z'))).toBe('2026-09-26');
  });
});
