import { NextRequest, NextResponse } from 'next/server';
import { findBookableService } from '@/lib/catalogData';
import { listAddonsForCategory } from '@/lib/bookingQuote';

export const dynamic = 'force-dynamic';

/** Extras that can be added to a booking of this service (active only, current prices). */
export async function GET(request: NextRequest) {
  const serviceId = request.nextUrl.searchParams.get('service_id');
  if (!serviceId) return NextResponse.json({ error: 'Missing service_id' }, { status: 400 });
  try {
    const lookup = await findBookableService(serviceId);
    if (!lookup.ok) return NextResponse.json({ error: lookup.error }, { status: lookup.status });
    // Free services (the studio tour) have no paid extras.
    const addons = parseFloat(lookup.service.base_price) > 0 ? await listAddonsForCategory(lookup.service.category) : [];
    return NextResponse.json(
      addons.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        price: (a.price_cents / 100).toFixed(2),
        unit: a.unit,
        max_quantity: a.max_quantity,
      })),
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error loading add-ons:', (error as Error)?.message || error);
    return NextResponse.json({ error: 'Extras are temporarily unavailable. Please try again in a moment.' }, { status: 503 });
  }
}
