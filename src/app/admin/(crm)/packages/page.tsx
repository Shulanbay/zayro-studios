import Link from 'next/link';
import { redirect } from 'next/navigation';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { customerPackages, customers, packagePlanItems, packagePlans, services } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { expireDuePackages } from '@/lib/crm/packages';
import { parsePage } from '@/lib/crm/range';
import { getAdminI18n } from '@/lib/i18n/server';
import { Card, EmptyState, Forbidden, Money, Notice, PageHeader, Pagination, StatusBadge } from '@/components/crm/ui';
import { PlanEditor } from '@/components/crm/packages';

export const dynamic = 'force-dynamic';
const PAGE = 25;

export default async function PackagesPage({ searchParams }: { searchParams: { status?: string; page?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('packages.read')) return <Forbidden what="packages" />;
  const { t, f, label } = getAdminI18n(admin);

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
        title={t('common.nav.packages')}
        description={t('packages.description')}
        actions={
          manage && (
            <Link href="/admin/packages/assign" className="crm-btn crm-btn-primary">
              {t('packages.assign')}
            </Link>
          )
        }
      />
      <div className="grid gap-4">
        <Card title={t('packages.plans')}>
          {plans.length === 0 ? (
            <EmptyState title={t('packages.noPlans')} body={t('packages.noPlansBody')} />
          ) : (
            <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
              <table className="crm-table min-w-[720px]">
                <caption className="sr-only">{t('packages.plansCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('packages.cols.plan')}</th>
                    {(['price', 'sessions', 'valid'] as const).map((c) => (
                      <th key={c} scope="col" className="text-right">
                        {t(`packages.cols.${c}`)}
                      </th>
                    ))}
                    <th scope="col">{t('packages.cols.usableFor')}</th>
                    <th scope="col">{t('packages.cols.status')}</th>
                    {manage && (
                      <th scope="col">
                        <span className="sr-only">{t('packages.cols.edit')}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.name}
                        <div className="text-xs text-zayro-gray">{p.package_type ? label(p.package_type) : ''}</div>
                      </td>
                      <td className="text-right">
                        <Money cents={p.price_cents} />
                      </td>
                      <td className="text-right tabular-nums">{f.number(p.total_credits)}</td>
                      <td className="text-right tabular-nums">{t('packages.days', { count: p.validity_days })}</td>
                      <td className="text-sm">{(eligibleByPlan.get(p.id) ?? []).map((s) => s.name).join(', ') || <span className="text-amber-800">{t('packages.anySession')}</span>}</td>
                      <td>
                        <StatusBadge status={p.active ? 'active' : 'disabled'} label={p.active ? t('common.status.active') : t('common.status.inactive')} />
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
          title={t('packages.customerPackages')}
          actions={
            <form method="get" className="flex gap-2">
              <label className="sr-only" htmlFor="pk-status">
                {t('packages.status')}
              </label>
              <select id="pk-status" name="status" defaultValue={status ?? ''} className="!w-auto">
                <option value="">{t('common.all')}</option>
                {['active', 'exhausted', 'expired', 'cancelled'].map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </select>
              <button type="submit" className="crm-btn crm-btn-sm">
                {t('packages.filter')}
              </button>
            </form>
          }
        >
          {rows.length === 0 ? (
            <EmptyState title={t('packages.noCustomerPackages')} body={manage ? t('packages.noCustomerPackagesBody') : undefined} />
          ) : (
            <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
              <table className="crm-table min-w-[640px]">
                <caption className="sr-only">{t('packages.customerPackages')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('packages.customerCols.customer')}</th>
                    <th scope="col">{t('packages.customerCols.package')}</th>
                    <th scope="col" className="text-right">
                      {t('packages.customerCols.credits')}
                    </th>
                    <th scope="col">{t('packages.customerCols.expires')}</th>
                    <th scope="col">{t('packages.customerCols.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ pkg, email, first, last }) => (
                    <tr key={pkg.id}>
                      <td>
                        <Link href={`/admin/packages/${pkg.id}`}>{[first, last].filter(Boolean).join(' ') || email}</Link>
                        <div className="text-xs text-zayro-gray break-all">{email}</div>
                      </td>
                      <td>{(pkg.plan_snapshot as { name?: string }).name ?? t('packages.packageFallback')}</td>
                      <td className="text-right tabular-nums">
                        {pkg.remaining_credits} / {pkg.total_credits}
                      </td>
                      <td className="text-xs whitespace-nowrap">{f.instant(pkg.expires_at)}</td>
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
        <Notice tone="blue" title={t('packages.onlineOffTitle')}>
          {t('packages.onlineOffBody')}
        </Notice>
      </div>
    </>
  );
}
