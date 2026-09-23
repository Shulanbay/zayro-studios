import { NextResponse } from 'next/server';
import { getActiveServices } from '@/lib/catalogData';
import { bookableServices } from '@/lib/catalog';

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
      }))
    );
  } catch (error: any) {
    console.error('Services API Error:', {
      message: error?.message || String(error),
      code: error?.code || 'UNKNOWN',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
