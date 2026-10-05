import { NextRequest, NextResponse } from 'next/server';
import { findBookableService } from '@/lib/catalogData';
import { listSetupsForCategory } from '@/lib/bookingQuote';

export const dynamic = 'force-dynamic';

/** Studio setups the customer can choose for this service. */
export async function GET(request: NextRequest) {
  const serviceId = request.nextUrl.searchParams.get('service_id');
  if (!serviceId) return NextResponse.json({ error: 'Missing service_id' }, { status: 400 });
  try {
    const lookup = await findBookableService(serviceId);
    if (!lookup.ok) return NextResponse.json({ error: lookup.error }, { status: lookup.status });
    const setups = await listSetupsForCategory(lookup.service.category);
    return NextResponse.json(
      setups.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        seats: s.capacity,
        image: typeof (s.metadata as { image?: unknown })?.image === 'string' ? (s.metadata as { image: string }).image : null,
      })),
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error loading setups:', (error as Error)?.message || error);
    return NextResponse.json({ error: 'Setups are temporarily unavailable. Please try again in a moment.' }, { status: 503 });
  }
}
