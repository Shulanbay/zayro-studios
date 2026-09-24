import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE } from '@/lib/adminAuth';
import { getAdminContext, isSameOrigin } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (isSameOrigin(request)) {
    const admin = await getAdminContext();
    if (admin) await writeAudit({ actor: { id: admin.id, email: admin.email }, operation: 'auth.logout', entityType: 'admin', entityId: admin.id });
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
