import Link from 'next/link';
import { redirect } from 'next/navigation';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { customerPackages, customers, packagePlanItems, packagePlans, services } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { expireDuePackages } from '@/lib/crm/packages';
import { parsePage } from '@/lib/crm/range';
import { formatInstantEt } from '@/lib/crm/time';
import { Card, EmptyState, Forbidden, Money, Notice, PageHeader, Pagination, StatusBadge, humanize } from '@/components/crm/ui';
import { PlanEditor } from '@/components/crm/packages';

export const dynamic = 'force-dynamic';
const PAGE = 25;

export default async function PackagesPage({ searchParams }: { searchParams: { status?: string; page?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('packages.read')) return <Forbidden what="packages" />;

  await expireDuePackages();
  const page = parsePage(searchParams.page);
  const status = ['active', 'exhausted', 'expired', 'cancelled'].includes(searchParams.status ?? '') ? searchParams.status : undefined;
  const where = status ? eq(customerPackages.status, status as 'active') : undefined;

  const [plans, items, singleServices, rows, [{ total }]] = await Promise.all([
    db.query.packagePlans.findMany({ orderBy: [asc(packagePlans.package_type), asc(packagePlans.sort_order), asc(packagePlans.id)] }),
    db.select({ plan: packagePlanItems.plan_id, id: services.id, name: services.name }).from(packagePlanItems).innerJoin(services, eq(services.id, packagePlanItems.service_id)),
    db.query.services.findMany({ orderBy: (s, { asc: a }) => [a(s.category), a(s.display_order)] }),
    db
      .select({ pkg: customerPackages, email: customers.email, first: customers.first_name, last: customers.last_name })
      .from(customerPackages)
      .innerJoin(customers, eq(customers.id, customerPackages.customer_id))
      .where(where)
      .orderBy(desc(customerPackages.created_at))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ total: sql<number>`count(*)::int` }).from(customerPackages).where(where),
  ]);
  const eligibleByPlan = new Map<number, { id: number; name: string }[]>();
  for (const i of items) eligibleByPlan.set(i.plan, [...(eligibleByPlan.get(i.plan) ?? []), { id: i.id, name: i.name }]);
  const manage = admin.can('packages.manage');

  return (
    <>
      <PageHeader
        title="Packages"
        description="Monthly memberships as prepaid session credits. The public site still uses “Request Monthly Package”; staff assign packages here."
        actions={
          manage && (
            <Link href="/admin/packages/assign" className="crm-btn crm-btn-primary">
              Assign package
            </Link>
          )
        }
      />
      <div className="grid gap-4">
        <Card title="Plans">
          {plans.length === 0 ? (
            <EmptyState title="No package plans" body="Create a service with the “package” category in Services." />
          ) : (
            <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
              <table className="crm-table min-w-[720px]">
                <caption className="sr-only">Package plans</caption>
                <thead>
                  <tr>
                    <th scope="col">Plan</th>
                    <th scope="col" className="text-right">
                      Price
                    </th>
                    <th scope="col" className="text-right">
                      Sessions
                    </th>
                    <th scope="col" className="text-right">
                      Valid
                    </th>
                    <th scope="col">Can be used for</th>
                    <th scope="col">Status</th>
                    {manage && <th scope="col"><span className="sr-only">Edit</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.name}
                        <div className="text-xs text-zayro-gray">{p.package_type ? humanize(p.package_type) : ''}</div>
                      </td>
                      <td className="text-right">
                        <Money cents={p.price_cents} />
                      </td>
                      <td className="text-right tabular-nums">{p.total_credits}</td>
                      <td className="text-right tabular-nums">{p.validity_days} days</td>
                      <td className="text-sm">{(eligibleByPlan.get(p.id) ?? []).map((s) => s.name).join(', ') || <span className="text-amber-800">Any session</span>}</td>
                      <td>
                        <StatusBadge status={p.active ? 'active' : 'disabled'} label={p.active ? 'Active' : 'Inactive'} />
                      </td>
                      {manage && (
                        <td>
                          <PlanEditor
                            plan={{ id: p.id, validityDays: p.validity_days, active: p.active, eligible: (eligibleByPlan.get(p.id) ?? []).map((s) => s.id) }}
                            services={singleServices.filter((s) => s.category !== 'package' && s.is_active).map((s) => ({ id: s.id, name: s.name }))}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Customer packages"
          actions={
            <form method="get" className="flex gap-2">
              <label className="sr-only" htmlFor="pk-status">
                Status
              </label>
              <select id="pk-status" name="status" defaultValue={status ?? ''} className="!w-auto">
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="exhausted">Used up</option>
                <option value="expired">Expired</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <button type="submit" className="crm-btn crm-btn-sm">
                Filter
              </button>
            </form>
          }
        >
          {rows.length === 0 ? (
            <EmptyState title="No customer packages yet" body={manage ? 'Assign one from a customer profile or with “Assign package”.' : undefined} />
          ) : (
            <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
              <table className="crm-table min-w-[640px]">
                <caption className="sr-only">Customer packages</caption>
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Package</th>
                    <th scope="col" className="text-right">
                      Credits left
                    </th>
                    <th scope="col">Expires</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ pkg, email, first, last }) => (
                    <tr key={pkg.id}>
                      <td>
                        <Link href={`/admin/packages/${pkg.id}`}>{[first, last].filter(Boolean).join(' ') || email}</Link>
                        <div className="text-xs text-zayro-gray break-all">{email}</div>
                      </td>
                      <td>{(pkg.plan_snapshot as { name?: string }).name ?? 'Package'}</td>
                      <td className="text-right tabular-nums">
                        {pkg.remaining_credits} / {pkg.total_credits}
                      </td>
                      <td className="text-xs whitespace-nowrap">{formatInstantEt(pkg.expires_at)}</td>
                      <td>
                        <StatusBadge status={pkg.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Pagination base="/admin/packages" params={status ? { status } : {}} page={page} pageSize={PAGE} total={Number(total)} />
        <Notice tone="blue" title="Online package purchase is not switched on">
          Credits are granted by staff and redeemed when staff book a session for the customer. A public “Buy now” needs customer sign-in first — see docs/crm-roadmap.md.
        </Notice>
      </div>
    </>
  );
}
