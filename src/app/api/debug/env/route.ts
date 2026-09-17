import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const dbUrl = process.env.DATABASE_URL;

    return NextResponse.json({
      database_url_present: !!dbUrl,
      database_url_type: dbUrl ? (
        dbUrl.includes('localhost') ? 'localhost' :
        dbUrl.includes('neon') ? 'neon' :
        dbUrl.includes('postgres') ? 'postgresql' :
        'unknown'
      ) : 'not_set',
      message: dbUrl ? 'DATABASE_URL is set' : 'DATABASE_URL is missing',
      url_first_50_chars: dbUrl ? dbUrl.substring(0, 50) : 'N/A'
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
