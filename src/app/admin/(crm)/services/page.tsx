import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getAdminContext } from '@/lib/crm/auth';
import { Forbidden, Notice, PageHeader } from '@/components/crm/ui';
import AdminServicesManager from '@/components/admin/AdminServicesManager';

export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('services.manage')) return <Forbidden what="services" />;
  const services = await db.query.services.findMany({ orderBy: (s, { asc }) => [asc(s.display_order), asc(s.id)] });
  return (
    <>
      <PageHeader title="Services" description="The catalog shown on the pricing page and in the booking flow." />
      <div className="mb-4">
        <Notice tone="blue">
          Price changes apply to new bookings only — every purchase keeps the price it was sold at. Services are never deleted: switch one off to hide it. Every change is in the audit log.
        </Notice>
      </div>
      <AdminServicesManager initialRows={services} />
    </>
  );
}
