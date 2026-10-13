import { NextRequest, NextResponse } from 'next/server';
import { onlinePackageOffer } from '@/lib/publicPackages';
import { errorResponse } from '@/lib/crm/errors';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const id = Number(request.nextUrl.searchParams.get('package'));
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: 'Invalid package' }, { status: 400 });
    const { snapshot, subtotal, tax, total } = await onlinePackageOffer(id);
    return NextResponse.json({ name: snapshot.name, sessions: snapshot.totalCredits, validityDays: snapshot.validityDays, service: snapshot.eligible, durationMinutes: snapshot.durationMinutes, subtotal, tax, total });
  } catch (error) { return errorResponse(error, 'package offer'); }
}
