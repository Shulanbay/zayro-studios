import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/crm/auth';
import { listCustomers } from '@/lib/crm/queries';
import { usablePackages } from '@/lib/crm/packages';

export const dynamic = 'force-dynamic';

/** Typeahead for the booking form; with ?customerId= also returns usable packages. */
export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, 'customers.read');
  if (!guard.ok) return guard.response;
  const sp = request.nextUrl.searchParams;
  const customerId = sp.get('customerId');
  if (customerId && /^[0-9a-f-]{36}$/i.test(customerId)) {
    const serviceId = parseInt(sp.get('serviceId') ?? '', 10);
    const packages = guard.admin.can('packages.read') ? await usablePackages(customerId, Number.isInteger(serviceId) ? serviceId : undefined) : [];
    return NextResponse.json({
      packages: packages.map((p) => ({
        id: p.id,
        name: (p.plan_snapshot as { name?: string }).name ?? 'Package',
        remaining: p.remaining_credits,
        expiresAt: p.expires_at,
      })),
    });
  }
  const q = (sp.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ customers: [] });
  const { rows } = await listCustomers({ q }, { pageSize: 8 });
  return NextResponse.json({
    customers: rows.map((c) => ({ id: c.id, email: c.email, name: [c.first_name, c.last_name].filter(Boolean).join(' '), phone: c.phone, company: c.company })),
  });
}
