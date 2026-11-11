import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { POLICY_COPY, POLICY_FAQ, bookingEligibility } from './policies';
import { buildFaqs, faqJsonLd } from './faq';
import { DEFAULT_BOOKING_FACTS } from './bookingFacts';
import * as T from './crm/emailTemplates';
import { addonLimit, includedCameras } from './bookingOptions';
import { isOpenSevenDays } from './bookingFacts';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|sql)$/.test(f) && !f.endsWith('.test.ts') ? [p] : [];
  });
}

describe('one policy everywhere', () => {
  it('no page, email or API still promises a 50% fee or a fixed bank refund time', () => {
    for (const f of files('src')) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/50% (fee|of the booking)/i);
      expect(text, f).not.toMatch(/5–10 business days/);
    }
  });

  it('FAQ JSON-LD is built from exactly the visible questions', () => {
    const items = buildFaqs(DEFAULT_BOOKING_FACTS);
    const ld = faqJsonLd(items);
    expect(ld.mainEntity.map((q) => q.name)).toEqual(items.map((i) => i.question));
    for (const p of POLICY_FAQ) expect(items).toContainEqual(p);
    expect(items.find((i) => i.id === 'cancel')?.answer).toContain('non-refundable');
  });

  it('approved customer-facing wording', () => {
    expect(POLICY_COPY.changes).toBe(
      'Cancel or reschedule at least 24 hours before your scheduled session. Cancellations made within 24 hours are non-refundable and cannot be rescheduled.'
    );
    expect(POLICY_COPY.acknowledgment).toBe('I agree to the cancellation, rescheduling and studio-time policies.');
  });
});

describe('eligibility', () => {
  const start = new Date('2031-06-06T18:00:00Z');
  const base = { status: 'confirmed', payment_status: 'succeeded', starts_at: start, ends_at: new Date('2031-06-06T19:00:00Z') };
  it('allows cancel/reschedule up to 24 h before, extension until the session ends', () => {
    expect(bookingEligibility(base, { hourly: true }, new Date('2031-06-05T18:00:00Z'))).toMatchObject({ cancel: true, reschedule: true, extend: true });
    const late = bookingEligibility(base, { hourly: true }, new Date('2031-06-06T12:00:00Z'));
    expect(late).toMatchObject({ cancel: false, reschedule: false, extend: true });
    expect(bookingEligibility(base, { hourly: true }, new Date('2031-06-06T19:00:01Z')).extend).toBe(false);
  });
  it('a cancelled booking can do nothing; a fixed-length service cannot be extended', () => {
    expect(bookingEligibility({ ...base, status: 'cancelled' }, { hourly: true }, new Date('2031-06-01T00:00:00Z'))).toMatchObject({ cancel: false, reschedule: false, extend: false });
    expect(bookingEligibility(base, { hourly: false }, new Date('2031-06-01T00:00:00Z')).extend).toBe(false);
  });
});

describe('emails', () => {
  const d = {
    bookingId: 'ZAY-ABC',
    firstName: 'Ada',
    serviceName: 'Podcast Pro',
    date: '2031-06-06',
    startTime: '14:00',
    endTime: '16:00',
    totalCents: 43550,
    isTour: false,
    address: '40 W 37th St',
    contactEmail: 'hello@zayro.studio',
  };
  it('confirmation shows money, policies, deadline and the Manage Your Booking link', () => {
    const e = T.bookingConfirmation({
      ...d,
      summary: { subtotalCents: 40000, taxCents: 3550, changeDeadlineLabel: 'Jun 5, 2031, 2:00 PM ET', cta: { label: T.MANAGE_CTA_LABEL, url: 'https://zayro.studio/booking/manage#t=abc' }, ctaNote: T.MANAGE_CTA_NOTE, setupName: 'Sofa Lounge', extras: ['Additional Microphone × 2'], durationLabel: '2 hours' },
    });
    for (const s of ['Manage Your Booking', 'Use this secure link to review, reschedule, extend or cancel your booking.', '$400.00', '$35.50', 'New York time', 'Jun 5, 2031, 2:00 PM ET', POLICY_COPY.studioTime, POLICY_COPY.earlyArrival, 'Sofa Lounge']) {
      expect(e.html).toContain(T.esc(s));
      expect(e.text).toContain(s);
    }
    expect(e.html).not.toContain('arrive 10 minutes early so we can start');
  });
  it('subjects', () => {
    expect(T.rescheduleConfirmation({ ...d, previousDate: '2031-06-05', previousStart: '10:00' }).subject).toBe('Your ZAYRO Studios session has been rescheduled');
    expect(T.cancellationNotice(d).subject).toBe('Your ZAYRO Studios booking has been canceled');
    expect(T.extensionConfirmation({ ...d, previousEnd: '15:00', addedLabel: '1 hour', amountCents: 21775, taxCents: 1775, orderNumber: 'ZX-1' }).subject).toBe(
      'Your ZAYRO Studios session has been extended'
    );
  });
  it('refund emails never call a pending refund completed', () => {
    const r = { firstName: 'Ada', orderNumber: 'ZO-1', amountCents: 21775, totalRefundedCents: 0, originalCents: 21775, contactEmail: 'x' };
    const pending = T.refundNotice({ ...r, status: 'pending' });
    expect(pending.subject).toMatch(/requested/);
    expect(pending.text).not.toMatch(/issued|completed/i);
    expect(T.refundNotice({ ...r, status: 'succeeded' }).subject).toMatch(/issued/);
    expect(T.refundNotice({ ...r, status: 'failed' }).subject).toMatch(/needs attention/);
  });
});

describe('camera limit (pure)', () => {
  const camera = { slug: 'additional-camera', max_quantity: 3 };
  it('at most 3 cameras: Single +2, Pro / Full none; other add-ons unchanged', () => {
    expect(addonLimit({ metadata: { includedCameras: 1 } }, camera)).toBe(2);
    expect(addonLimit({ metadata: { includedCameras: 3 } }, camera)).toBe(0);
    expect(addonLimit({ metadata: { includedCameras: 3 } }, { slug: 'additional-microphone', max_quantity: 4 })).toBe(4);
    expect(includedCameras({ metadata: {} })).toBeNull();
  });
});

describe('Open 7 Days', () => {
  const day = (d: string, extra: Partial<{ start_time: string; end_time: string; is_available: boolean }> = {}) => ({ day_of_week: d, start_time: '08:00', end_time: '22:00', is_available: true, ...extra });
  const week = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  it('only when every weekday has active hours', () => {
    expect(isOpenSevenDays(week.map((d) => day(d)))).toBe(true);
    expect(isOpenSevenDays(week.slice(0, 6).map((d) => day(d)))).toBe(false);
    expect(isOpenSevenDays(week.map((d) => day(d, d === 'Sunday' ? { is_available: false } : {})))).toBe(false);
    expect(isOpenSevenDays(week.map((d) => day(d, d === 'Monday' ? { start_time: '10:00', end_time: '10:00' } : {})))).toBe(false);
    expect(isOpenSevenDays(week.map((d) => day(d, { end_time: '00:00' })))).toBe(true);
  });
});

describe('edited episode delivery', () => {
  it('3 business days in the FAQ and in confirmation emails for packages that include editing', () => {
    expect(POLICY_COPY.editedDelivery).toBe('Your edited episode will be delivered within 3 business days.');
    expect(POLICY_FAQ.find((f) => f.id === 'editing')?.answer).toContain(POLICY_COPY.editedDelivery);
    const base = { bookingId: 'Z', firstName: 'A', serviceName: 'Full Podcast Package', date: '2031-06-06', startTime: '14:00', endTime: '15:00', totalCents: 1, isTour: false, address: 'x', contactEmail: 'y' };
    expect(T.bookingConfirmation({ ...base, includesEditing: true }).text).toContain(POLICY_COPY.editedDelivery);
    expect(T.bookingConfirmation({ ...base, includesEditing: false }).text).not.toContain('business days');
  });
});
