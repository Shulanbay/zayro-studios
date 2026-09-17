import { db } from './db';
import { services, businessSettings } from './db/schema';
import { eq } from 'drizzle-orm';

interface PricingCalculation {
  subtotal: number; // in cents
  taxAmount: number; // in cents
  total: number; // in cents
  currency: string;
  taxRate: number;
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

async function getServicePrice(serviceId: number): Promise<number | null> {
  try {
    const service = await db.query.services.findFirst({
      where: eq(services.id, serviceId),
    });

    if (!service) {
      return null;
    }

    // Convert decimal to cents (integer)
    return Math.round(parseFloat(service.base_price) * 100);
  } catch (error) {
    console.error('Error getting service price:', error);
    return null;
  }
}

export async function calculatePricing(serviceId: number): Promise<PricingCalculation | null> {
  try {
    const subtotal = await getServicePrice(serviceId);

    if (subtotal === null) {
      return null;
    }

    const taxRate = await getTaxRate();
    const taxAmount = Math.round(subtotal * taxRate);
    const total = subtotal + taxAmount;

    return {
      subtotal,
      taxAmount,
      total,
      currency: 'USD',
      taxRate,
    };
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
