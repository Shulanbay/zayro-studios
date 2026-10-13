import { NextRequest, NextResponse } from 'next/server';
import { PACKAGE_COOKIE, purchaseIdFromToken } from '@/lib/packageAccess';
import { packageDashboard } from '@/lib/publicPackages';
import { CrmError, errorResponse } from '@/lib/crm/errors';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const id = purchaseIdFromToken(request.cookies.get(PACKAGE_COOKIE)?.value);
    if (!id) throw new CrmError('Open the private package link from your confirmation email.', 403);
    return NextResponse.json(await packageDashboard(id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error, 'package dashboard'); }
}
