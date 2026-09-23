import { describe, it, expect } from 'vitest';
import { isValidEmail, isValidPhone, generateBookingId, getBaseUrl } from './utils';
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
