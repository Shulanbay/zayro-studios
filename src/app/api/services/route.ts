import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { services } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const allServices = await db.query.services.findMany({
      where: eq(services.is_active, true),
    });

    return NextResponse.json(allServices);
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const errorCode = error?.code || 'UNKNOWN';
    console.error('Services API Error:', {
      message: errorMessage,
      code: errorCode,
      type: error?.constructor?.name,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
