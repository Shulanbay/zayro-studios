import { describe, it, expect } from 'vitest';
import { computePricing, formatCents, dollarsToCents } from './pricing';

describe('computePricing', () => {
  it('computes subtotal/tax/total in integer cents', () => {
    const p = computePricing(200, 0.08625);
    expect(p.subtotal).toBe(20000);
    expect(p.taxAmount).toBe(1725); // 20000 * 0.08625 = 1725
    expect(p.total).toBe(21725);
    expect(p.currency).toBe('USD');
  });

  it('treats a $0 service as free (zero total)', () => {
    const p = computePricing(0, 0.08625);
    expect(p.subtotal).toBe(0);
    expect(p.taxAmount).toBe(0);
    expect(p.total).toBe(0);
  });

  it('is free even with a nonzero tax rate misconfiguration, since tax of $0 is $0', () => {
    const p = computePricing(0, 1); // pathological 100% tax rate
    expect(p.total).toBe(0);
  });

  it('handles a zero tax rate', () => {
    const p = computePricing(170, 0);
    expect(p.subtotal).toBe(17000);
    expect(p.taxAmount).toBe(0);
    expect(p.total).toBe(17000);
  });

  it('rounds to the nearest cent rather than truncating', () => {
    // 33.335 -> 3333.5 cents; base price itself is rounded first.
    const p = computePricing(33.335, 0);
    expect(p.subtotal).toBe(3334); // Math.round(3333.5) = 3334
  });
});

describe('formatCents / dollarsToCents', () => {
  it('round-trips', () => {
    expect(formatCents(21725)).toBe('217.25');
    expect(dollarsToCents(217.25)).toBe(21725);
  });
});
