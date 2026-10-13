import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PACKAGE_COOKIE, purchaseIdFromToken } from '@/lib/packageAccess';
import { bookPackageSession } from '@/lib/publicPackages';
import { CrmError, errorResponse } from '@/lib/crm/errors';
import { pgErrorCode } from '@/lib/db/types';
import { enforceRateLimit } from '@/lib/crm/rateLimit';
export const dynamic = 'force-dynamic';
const schema = z.object({ packageId: z.string().uuid(), holdId: z.string().uuid(), intake: z.record(z.unknown()).optional(), notes: z.string().trim().max(2000).optional() });
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'package-book', 30, 600);
  if (limited) return limited;
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== request.nextUrl.origin) throw new CrmError('Invalid request origin', 403);
    const id = purchaseIdFromToken(request.cookies.get(PACKAGE_COOKIE)?.value);
    if (!id) throw new CrmError('Open the private package link from your confirmation email.', 403);
    const body = schema.parse(await request.json());
    return NextResponse.json(await bookPackageSession(id, body));
  } catch (error) {
    if (pgErrorCode(error) === '23P01') return NextResponse.json({ error: 'That time was just booked. Please choose another.' }, { status: 409 });
    return errorResponse(error, 'package session');
  }
}
