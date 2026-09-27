import { db } from './db';
import { services, businessSettings } from './db/schema';
import type { Executor } from './db/types';
import { eq } from 'drizzle-orm';

export interface PricingCalculation {
  subtotal: number; // in cents
  taxAmount: number; // in cents
  total: number; // in cents
  currency: string;
  taxRate: number;
}

/**
 * Pure pricing math — no DB access, safe to unit test directly.
 */
export function computePricing(basePriceDollars: number, taxRate: number): PricingCalculation {
  const subtotal = Math.round(basePriceDollars * 100);
  const taxAmount = Math.round(subtotal * taxRate);
  const total = subtotal + taxAmount;

  return {
    subtotal,
    taxAmount,
    total,
    currency: 'USD',
    taxRate,
  };
}

/**
 * The configured sales-tax rate (0.08875 = 8.875%); 0 when not set. Fails
 * closed: a database error or a nonsensical stored value throws, so a
 * checkout is refused rather than charged with the wrong tax.
 */
export async function getTaxRate(exec: Executor = db): Promise<number> {
  const setting = await exec.query.businessSettings.findFirst({
    where: eq(businessSettings.setting_key, 'tax_rate'),
  });
  if (!setting || !setting.setting_value || !setting.setting_value.trim()) return 0;
  const rate = Number(setting.setting_value);
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
    throw new Error('tax_rate setting is not a valid rate between 0 and 1');
  }
  return rate;
}

async function getServiceBasePrice(serviceId: number): Promise<number | null> {
  try {
    const service = await db.query.services.findFirst({
      where: eq(services.id, serviceId),
    });

    if (!service) {
      return null;
    }

    return parseFloat(service.base_price);
  } catch (error) {
    console.error('Error getting service price:', error);
    return null;
  }
}

export async function calculatePricing(serviceId: number): Promise<PricingCalculation | null> {
  try {
    const basePrice = await getServiceBasePrice(serviceId);

    if (basePrice === null) {
      return null;
    }

    const taxRate = await getTaxRate();
    return computePricing(basePrice, taxRate);
  } catch (error) {
    console.error('Error calculating pricing:', error);
    return null;
  }
}

// Format cents to dollars string
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

// Parse dollars to cents
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}
