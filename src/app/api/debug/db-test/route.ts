import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const dbUrl = process.env.DATABASE_URL;

    // Check if DATABASE_URL is set
    if (!dbUrl) {
      return NextResponse.json({
        status: 'ERROR',
        issue: 'DATABASE_URL environment variable not set',
        available: false,
      }, { status: 500 });
    }

    // Check URL format
    const urlObj = new URL(dbUrl);

    return NextResponse.json({
      status: 'OK',
      database_url_present: true,
      host_present: !!urlObj.hostname,
      port_present: !!urlObj.port,
      database_present: !!urlObj.pathname,
      protocol: urlObj.protocol,
    });
  } catch (error: any) {
    return NextResponse.json({
      status: 'ERROR',
      issue: error?.message || String(error),
      code: error?.code,
    }, { status: 500 });
  }
}
