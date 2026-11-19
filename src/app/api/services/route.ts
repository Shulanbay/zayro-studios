import { NextResponse } from 'next/server';
import { getActiveServices } from '@/lib/catalogData';
import { bookableServices } from '@/lib/catalog';
import { maxUnits, minUnits, pricingUnit } from '@/lib/bookingOptions';

export const dynamic = 'force-dynamic';

// Public list of services a customer can book as a single time slot:
// active only, monthly packages excluded, in admin-defined display order.
export async function GET() {
  try {
    const rows = bookableServices(await getActiveServices());
    return NextResponse.json(
      rows.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        base_price: s.base_price,
        duration_minutes: s.duration_minutes,
        category: s.category,
        features: s.features ?? [],
        is_active: s.is_active,
        display_order: s.display_order,
        is_featured: s.is_featured,
        badge: s.badge,
        // Services sold by the hour can be booked for several hours in one go.
        max_hours: maxUnits(s),
        // Fewest bookable hours (services.metadata.minHours, 1 when unset). Full Production: one price per episode.
        min_hours: minUnits(s),
        pricing_unit: pricingUnit(s),
        // Only the public, price-related part of services.metadata (lib/catalog.ts → priceTerms).
        metadata: { minHours: minUnits(s), pricingUnit: pricingUnit(s) },
      })),
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: any) {
    console.error('Services API Error:', {
      message: error?.message || String(error),
      code: error?.code || 'UNKNOWN',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
