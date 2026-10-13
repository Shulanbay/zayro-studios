import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { startPackageCheckout } from '@/lib/publicPackages';
import { getBaseUrl, isValidPhone } from '@/lib/utils';
import { enforceRateLimit, isHoneypotTripped } from '@/lib/crm/rateLimit';
import { errorResponse } from '@/lib/crm/errors';
export const dynamic = 'force-dynamic';
const schema = z.object({ requestId: z.string().uuid(), serviceId: z.number().int().positive(), firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100), email: z.string().trim().email().max(255), phone: z.string().trim().max(20).refine(isValidPhone, 'Enter a valid phone number'), company: z.string().trim().max(255).optional() });
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'package-checkout', 15, 600);
  if (limited) return limited;
  try {
    const raw = await request.json();
    if (isHoneypotTripped(raw)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const body = schema.parse(raw);
    return NextResponse.json(await startPackageCheckout(body, getBaseUrl(request)));
  } catch (error) { return errorResponse(error, 'package checkout'); }
}
