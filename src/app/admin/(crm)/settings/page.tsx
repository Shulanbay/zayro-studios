import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { getTaxRate } from '@/lib/pricing';
import { BUSINESS_ADDRESS, BUSINESS_EMAIL } from '@/lib/constants';
import { Card, DefinitionList, Forbidden, PageHeader } from '@/components/crm/ui';
import { TaxRateForm } from '@/components/crm/settings';
import { getAdminI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

/** Environment variables the app reads — names and set/unset only, never values. */
const ENV_GROUPS: { label: string; names: string[] }[] = [
  { label: 'Database & auth', names: ['DATABASE_URL', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'ADMIN_EMAILS'] },
  { label: 'Stripe', names: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'] },
  { label: 'Email', names: ['RESEND_API_KEY', 'EMAIL_FROM', 'OWNER_EMAIL'] },
  { label: 'Google', names: ['GOOGLE_CALENDAR_EMAIL', 'GOOGLE_CALENDAR_PRIVATE_KEY', 'GOOGLE_CALENDAR_ID', 'GOOGLE_SHEETS_ID'] },
  { label: 'Booking', names: ['BOOKING_MANAGE_SECRET', 'TEMPORARY_HOLD_DURATION_MINUTES'] },
];

export default async function SettingsPage() {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('settings.manage')) return <Forbidden what="settings" />;
  const { t } = getAdminI18n(admin);
  const taxRate = await getTaxRate();

  return (
    <>
      <PageHeader title={t('common.nav.settings')} description={t('system.settings.description')} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title={t('system.settings.tax')}>
          <TaxRateForm initialPercent={Math.round(taxRate * 100000) / 1000} />
        </Card>
        <Card title={t('system.settings.studio')}>
          <DefinitionList
            items={[
              [t('system.settings.room'), t('system.settings.roomValue')],
              [t('system.settings.timeZone'), 'America/New_York'],
              [t('system.settings.address'), BUSINESS_ADDRESS],
              [t('system.settings.contactEmail'), BUSINESS_EMAIL],
              [t('system.settings.currency'), 'USD'],
            ]}
          />
          <p className="text-xs text-zayro-gray mt-3">{t('system.settings.addressNote')}</p>
        </Card>
        <Card title={t('system.settings.environment')} className="xl:col-span-2">
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {ENV_GROUPS.map((g) => (
              <div key={g.label}>
                <h3 className="text-sm font-semibold mb-1">{t.dynamic(`system.settings.groups.${g.label}`, g.label)}</h3>
                <ul className="text-sm">
                  {g.names.map((n) => (
                    <li key={n} className="flex justify-between gap-2 py-0.5">
                      <code className="text-xs">{n}</code>
                      <span className={process.env[n] ? 'text-emerald-700 text-xs' : 'text-red-700 text-xs'}>{process.env[n] ? t('system.settings.set') : t('system.settings.notSet')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-xs text-zayro-gray mt-3">{t('system.settings.envNote')}</p>
        </Card>
      </div>
    </>
  );
}
