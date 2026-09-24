import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { customers } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { bookableServiceOptions } from '@/lib/crm/serviceOptions';
import { isDateString, isTimeString, todayInTz } from '@/lib/crm/time';
import { Forbidden, PageHeader } from '@/components/crm/ui';
import { ManualBookingForm } from '@/components/crm/booking';

export const dynamic = 'force-dynamic';

export default async function NewBookingPage({ searchParams }: { searchParams: { date?: string; time?: string; customerId?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('bookings.create')) return <Forbidden what="creating bookings" />;

  const services = await bookableServiceOptions();
  const customer =
    searchParams.customerId && /^[0-9a-f-]{36}$/i.test(searchParams.customerId)
      ? await db.query.customers.findFirst({ where: eq(customers.id, searchParams.customerId) })
      : null;

  return (
    <>
      <PageHeader title="New booking" description="Staff booking — checked against the same availability, holds and blocked time as the public site." back={{ href: '/admin/sessions', label: 'Sessions' }} />
      <ManualBookingForm
        services={services}
        defaultDate={isDateString(searchParams.date) ? searchParams.date : todayInTz()}
        defaultTime={isTimeString(searchParams.time) ? searchParams.time : undefined}
        defaultCustomer={
          customer
            ? { id: customer.id, email: customer.email, name: [customer.first_name, customer.last_name].filter(Boolean).join(' '), phone: customer.phone, company: customer.company }
            : null
        }
        canRecordPayment={admin.can('purchases.create')}
        canUsePackages={admin.can('packages.read')}
      />
    </>
  );
}
