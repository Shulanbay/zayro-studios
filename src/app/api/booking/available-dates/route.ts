import { NextRequest, NextResponse } from 'next/server';
import { getAvailableDates } from '@/lib/availability';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const serviceId = searchParams.get('service_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');

    if (!serviceId || !fromDate || !toDate) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const available = await getAvailableDates(
      parseInt(serviceId, 10),
      fromDate,
      toDate
    );

    return NextResponse.json({
      available_dates: available,
      min_date: available.length > 0 ? available[0] : null,
      max_date: available.length > 0 ? available[available.length - 1] : null,
    });
  } catch (error) {
    console.error('Error fetching available dates:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
