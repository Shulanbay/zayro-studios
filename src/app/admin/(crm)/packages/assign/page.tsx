import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { customers, packagePlanItems, packagePlans, services } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { todayInTz } from '@/lib/crm/time';
import { Forbidden, PageHeader } from '@/components/crm/ui';
import { AssignPackageForm } from '@/components/crm/packages';

export const dynamic = 'force-dynamic';

export default async function AssignPackagePage({ searchParams }: { searchParams: { customerId?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('packages.manage')) return <Forbidden what="assigning packages" />;

  const [plans, items, customer] = await Promise.all([
    db.query.packagePlans.findMany({ where: eq(packagePlans.active, true), orderBy: [asc(packagePlans.package_type), asc(packagePlans.sort_order)] }),
    db.select({ plan: packagePlanItems.plan_id, name: services.name }).from(packagePlanItems).innerJoin(services, eq(services.id, packagePlanItems.service_id)),
    searchParams.customerId && /^[0-9a-f-]{36}$/i.test(searchParams.customerId)
      ? db.query.customers.findFirst({ where: eq(customers.id, searchParams.customerId) })
      : null,
  ]);
  return (
    <>
      <PageHeader title="Assign a package" back={{ href: '/admin/packages', label: 'Packages' }} description="Creates a purchase with the plan price as a snapshot, the package and its opening credit grant." />
      <AssignPackageForm
        plans={plans.map((p) => ({
          id: p.id,
          name: p.name,
          priceCents: p.price_cents,
          credits: p.total_credits,
          validityDays: p.validity_days,
          eligible: items.filter((i) => i.plan === p.id).map((i) => i.name).join(', ') || 'any session',
        }))}
        defaultCustomer={customer ? { id: customer.id, email: customer.email, name: [customer.first_name, customer.last_name].filter(Boolean).join(' ') } : null}
        canRecordPayment={admin.can('purchases.create')}
        defaultDate={todayInTz()}
      />
    </>
  );
}
