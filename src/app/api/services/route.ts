import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { services } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const allServices = await db.query.services.findMany({
      where: eq(services.is_active, true),
    });

    return NextResponse.json(allServices);
  } catch (error) {
    console.error('Error fetching services:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
