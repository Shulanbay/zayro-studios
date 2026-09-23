import { db } from './db';
import { services, businessSettings } from './db/schema';
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

async function getTaxRate(): Promise<number> {
  try {
    const setting = await db.query.businessSettings.findFirst({
      where: eq(businessSettings.setting_key, 'tax_rate'),
    });

    if (!setting || !setting.setting_value) {
      return 0; // Default to 0 tax if not configured
    }

    return parseFloat(setting.setting_value);
  } catch (error) {
    console.error('Error getting tax rate:', error);
    return 0;
  }
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
