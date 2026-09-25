import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { csvCell, toCsv } from './csv';
import { bookingConfirmation, cancellationNotice, esc, ownerNewBooking } from './emailTemplates';
import { addDays, dayOfWeek, isDateString, minutesIntoDay, tzOffsetMinutes, utcToWall, wallTimeToUtc } from './time';
import { sanitizeForAudit, diffFields } from './audit';
import { ALL_PERMISSIONS, hasPermission, normalizePermissions, SYSTEM_ROLE_PERMISSIONS } from './permissions';
import { decimalToCents, formatCents, parseMoneyInput, taxCents } from './money';
import { computePricing } from '@/lib/pricing';
import { rateLimitKey } from './rateLimit';
import { generateOrderNumber, orderNumberForBooking } from './purchases';

describe('CSV export', () => {
  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
  });

  it('neutralises spreadsheet formulas in text cells', () => {
    for (const evil of ['=HYPERLINK("http://x","click")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\r=1']) {
      const cell = csvCell(evil);
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    }
    // Real numbers stay numbers, including negatives.
    expect(csvCell(-12)).toBe('-12');
  });

  it('writes a UTF-8 BOM, a header row and CRLF lines', () => {
    const out = toCsv([{ header: 'Name', value: (r: { n: string }) => r.n }], [{ n: 'Léa' }, { n: '=cmd' }]);
    expect(out.startsWith('﻿Name\r\n')).toBe(true);
    expect(out).toContain('Léa\r\n');
    expect(out).toContain("'=cmd\r\n");
  });
});

describe('email templates', () => {
  const base = {
    bookingId: 'ZAY-ABC',
    firstName: '<script>alert(1)</script>',
    lastName: 'O"Neil',
    email: 'x@example.com',
    phone: '1',
    serviceName: 'Podcast Pro',
    date: '2030-03-10',
    startTime: '10:00',
    endTime: '11:00',
    totalCents: 21775,
    isTour: false,
    notes: '<img src=x onerror=alert(1)>',
    address: '40 W 37th St',
    contactEmail: 'hello@zayro.studio',
  };

  it('escapes every customer-supplied value', () => {
    for (const email of [bookingConfirmation(base), ownerNewBooking({ ...base, source: 'individual' }), cancellationNotice(base)]) {
      expect(email.html).not.toContain('<script>');
      expect(email.html).not.toContain('<img src=x');
      expect(email.html).toContain('&lt;script&gt;');
    }
    expect(esc(`<a href="x">'`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;');
  });

  it('uses the tour variant for studio tours and shows ET times', () => {
    const tour = bookingConfirmation({ ...base, firstName: 'Ann', isTour: true, totalCents: 0 });
    expect(tour.subject).toMatch(/tour/i);
    expect(tour.text).toContain('10:00 AM – 11:00 AM ET');
    const paid = bookingConfirmation({ ...base, firstName: 'Ann' });
    expect(paid.text).toContain('$217.75');
  });
});

describe('studio time (America/New_York)', () => {
  it('converts wall-clock ↔ UTC across both DST transitions', () => {
    expect(wallTimeToUtc('2030-01-15', '10:00').toISOString()).toBe('2030-01-15T15:00:00.000Z'); // EST
    expect(wallTimeToUtc('2030-07-15', '10:00').toISOString()).toBe('2030-07-15T14:00:00.000Z'); // EDT
    // Spring forward 2030-03-10 02:00 → 03:00
    expect(wallTimeToUtc('2030-03-10', '01:30').toISOString()).toBe('2030-03-10T06:30:00.000Z');
    expect(wallTimeToUtc('2030-03-10', '03:30').toISOString()).toBe('2030-03-10T07:30:00.000Z');
    // Fall back 2030-11-03 02:00 → 01:00
    expect(wallTimeToUtc('2030-11-03', '00:30').toISOString()).toBe('2030-11-03T04:30:00.000Z');
    expect(wallTimeToUtc('2030-11-03', '03:00').toISOString()).toBe('2030-11-03T08:00:00.000Z');
    expect(utcToWall(new Date('2030-07-15T14:00:00Z'))).toMatchObject({ date: '2030-07-15', time: '10:00' });
    expect(tzOffsetMinutes(new Date('2030-01-15T12:00:00Z'))).toBe(-300);
    expect(tzOffsetMinutes(new Date('2030-07-15T12:00:00Z'))).toBe(-240);
  });

  it('round-trips every business hour of a DST day', () => {
    for (const date of ['2030-03-10', '2030-11-03']) {
      for (let h = 8; h < 22; h++) {
        const t = `${String(h).padStart(2, '0')}:00`;
        expect(utcToWall(wallTimeToUtc(date, t))).toMatchObject({ date, time: t });
      }
    }
  });

  it('measures instants from the start of a studio day', () => {
    expect(minutesIntoDay(new Date('2030-07-01T17:00:00Z'), '2030-07-01')).toBe(13 * 60);
    expect(minutesIntoDay(new Date('2030-07-02T04:30:00Z'), '2030-07-01')).toBe(24 * 60 + 30);
    expect(minutesIntoDay(new Date('2030-07-01T03:00:00Z'), '2030-07-01')).toBe(-60);
  });

  it('validates and walks calendar dates', () => {
    expect(isDateString('2030-02-29')).toBe(false);
    expect(isDateString('2032-02-29')).toBe(true);
    expect(addDays('2030-12-31', 1)).toBe('2031-01-01');
    expect(dayOfWeek('2030-03-10')).toBe('Sunday');
  });
});

describe('audit payloads', () => {
  it('drops secret-looking keys and truncates', () => {
    const out = sanitizeForAudit({
      email: 'a@b.c',
      apiKey: 'x',
      stripe_secret: 'sk_live_1',
      nested: { password: 'p', token: 't', ok: 1, card: { number: '4242' } },
      long: 'x'.repeat(5000),
    }) as Record<string, any>;
    expect(out).toMatchObject({ email: 'a@b.c', nested: { ok: 1 } });
    expect(JSON.stringify(out)).not.toMatch(/sk_live|4242|"p"|"t"/);
    expect(out.long.length).toBeLessThan(1100);
  });

  it('records only changed fields', () => {
    expect(diffFields({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ before: { b: 2 }, after: { b: 3 } });
  });
});

describe('permissions', () => {
  it('matches the roles seeded by migration 0007', () => {
    const sql = readFileSync('drizzle/0007_crm_backfill.sql', 'utf8');
    for (const [role, perms] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
      const match = new RegExp(`\\('${role}', '[^']*', true,\\s*'(\\[[^\\]]*\\])'`).exec(sql);
      expect(match, role).not.toBeNull();
      expect(JSON.parse(match![1]).sort()).toEqual([...perms].sort());
    }
  });

  it('only owners have security permissions; operators are read-only', () => {
    for (const p of ['team.manage', 'audit.read', 'settings.manage'] as const) {
      expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.Owner, p)).toBe(true);
      expect(hasPermission(SYSTEM_ROLE_PERMISSIONS['Studio Manager'], p)).toBe(false);
      expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.Producer, p)).toBe(false);
    }
    const operatorWrites = ALL_PERMISSIONS.filter((p) => !p.endsWith('.read') && hasPermission(SYSTEM_ROLE_PERMISSIONS.Operator, p));
    expect(operatorWrites).toEqual([]);
    expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.Operator, 'purchases.read')).toBe(false);
    expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.Producer, 'bookings.refund')).toBe(false);
    expect(hasPermission(SYSTEM_ROLE_PERMISSIONS['Studio Manager'], 'bookings.refund')).toBe(true);
  });

  it('ignores unknown permission strings', () => {
    expect(normalizePermissions(['bookings.read', 'hack.everything', 7, '*'])).toEqual(['bookings.read', '*']);
  });
});

describe('money', () => {
  it('keeps the catalog prices and tax maths in integer cents', () => {
    expect(computePricing(200, 0.08875)).toMatchObject({ subtotal: 20000, taxAmount: 1775, total: 21775 });
    expect(computePricing(550, 0.08875)).toMatchObject({ subtotal: 55000, taxAmount: 4881, total: 59881 });
    expect(taxCents(25000, 0.08875)).toBe(2219);
    expect(decimalToCents('170.00')).toBe(17000);
    expect(decimalToCents('0.1')).toBe(10);
    expect(formatCents(128000)).toBe('$1,280.00');
    expect(parseMoneyInput('$1,234.5')).toBe(123450);
    expect(parseMoneyInput('12.345')).toBeNull();
  });

  it('order numbers mirror booking ids or are random', () => {
    expect(orderNumberForBooking('ZAY-ABCDEF123456')).toBe('ZO-ABCDEF123456');
    expect(generateOrderNumber()).toMatch(/^ZP-[A-Z2-9]{12}$/);
  });
});

describe('rate limiting', () => {
  it('stores salted hashes, never raw IPs', () => {
    const key = rateLimitKey('create-hold', '203.0.113.9');
    expect(key).toMatch(/^create-hold:[0-9a-f]{32}$/);
    expect(key).not.toContain('203.0.113.9');
    expect(rateLimitKey('create-hold', '203.0.113.10')).not.toBe(key);
  });
});
