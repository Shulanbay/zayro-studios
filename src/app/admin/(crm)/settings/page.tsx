import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { getTaxRate } from '@/lib/pricing';
import { BUSINESS_ADDRESS, BUSINESS_EMAIL } from '@/lib/constants';
import { Card, DefinitionList, Forbidden, PageHeader } from '@/components/crm/ui';
import { TaxRateForm } from '@/components/crm/settings';

export const dynamic = 'force-dynamic';

/** Environment variables the app reads — names and set/unset only, never values. */
const ENV_GROUPS: { label: string; names: string[] }[] = [
  { label: 'Database & auth', names: ['DATABASE_URL', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'ADMIN_EMAILS'] },
  { label: 'Stripe', names: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'] },
  { label: 'Email', names: ['RESEND_API_KEY', 'EMAIL_FROM', 'OWNER_EMAIL'] },
  { label: 'Google', names: ['GOOGLE_CALENDAR_EMAIL', 'GOOGLE_CALENDAR_PRIVATE_KEY', 'GOOGLE_CALENDAR_ID', 'GOOGLE_SHEETS_ID'] },
  { label: 'Booking', names: ['TEMPORARY_HOLD_DURATION_MINUTES'] },
];

export default async function SettingsPage() {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('settings.manage')) return <Forbidden what="settings" />;
  const taxRate = await getTaxRate();

  return (
    <>
      <PageHeader title="Settings" description="Business settings. Opening hours and booking rules are under Availability; credentials are managed in Vercel." />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Tax">
          <TaxRateForm initialPercent={Math.round(taxRate * 100000) / 1000} />
        </Card>
        <Card title="Studio">
          <DefinitionList
            items={[
              ['Room', 'Main Studio (one room)'],
              ['Time zone', 'America/New_York'],
              ['Address', BUSINESS_ADDRESS],
              ['Contact email', BUSINESS_EMAIL],
              ['Currency', 'USD'],
            ]}
          />
          <p className="text-xs text-zayro-gray mt-3">Address and contact email come from BUSINESS_ADDRESS / BUSINESS_EMAIL in Vercel.</p>
        </Card>
        <Card title="Environment" className="xl:col-span-2">
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {ENV_GROUPS.map((g) => (
              <div key={g.label}>
                <h3 className="text-sm font-semibold mb-1">{g.label}</h3>
                <ul className="text-sm">
                  {g.names.map((n) => (
                    <li key={n} className="flex justify-between gap-2 py-0.5">
                      <code className="text-xs">{n}</code>
                      <span className={process.env[n] ? 'text-emerald-700 text-xs' : 'text-red-700 text-xs'}>{process.env[n] ? 'set' : 'not set'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-xs text-zayro-gray mt-3">Values are never shown. Change them in Vercel → Settings → Environment Variables, then redeploy.</p>
        </Card>
      </div>
    </>
  );
}
