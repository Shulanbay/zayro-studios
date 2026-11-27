import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { Card, Forbidden, PageHeader } from '@/components/crm/ui';
import { getAdminI18n } from '@/lib/i18n/server';
import { vendorsAllowed } from '@/lib/analytics/server/config';
import { getPublishedLanding } from '@/lib/marketing/pages';
import { cleanVerificationTags } from '@/lib/marketing/scripts';
import { builtInTags, customCodeEnvironmentAllowed, getMarketingSettings } from '@/lib/marketing/settings';
import TrackingForm from '@/components/marketing/admin/TrackingForm';

export const dynamic = 'force-dynamic';

export default async function TrackingPage() {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('marketing.scripts')) return <Forbidden what="tracking code" />;
  const { t, f } = getAdminI18n(admin);
  const [s, home] = await Promise.all([getMarketingSettings(), getPublishedLanding('home')]);
  const env = customCodeEnvironmentAllowed();
  const builtIn = builtInTags();
  const vendors = vendorsAllowed();
  const state = !s.scripts_enabled ? 'off' : env ? 'live' : 'envBlocked';
  const tone = state === 'live' ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : state === 'off' ? 'bg-slate-50 text-slate-800 border-slate-200' : 'bg-amber-50 text-amber-900 border-amber-200';

  return (
    <>
      <PageHeader title={t('common.nav.tracking')} description={t('tracking.description')} />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px] items-start">
        <TrackingForm
          initial={{
            scripts_enabled: s.scripts_enabled,
            global_head_scripts: s.global_head_scripts ?? '',
            global_body_scripts: s.global_body_scripts ?? '',
            global_scripts_consent: s.global_scripts_consent as 'necessary' | 'analytics' | 'advertising',
            site_verification: cleanVerificationTags(s.site_verification),
            whatsapp_number: s.whatsapp_number ?? '',
            telegram_username: s.telegram_username ?? '',
            use_landing_home: s.use_landing_home,
            notify_new_leads: s.notify_new_leads,
          }}
          canManagePages={admin.can('pages.manage')}
          homeReady={!!home}
          builtIn={builtIn}
        />
        <aside className="grid gap-4 xl:sticky xl:top-4">
          <div className={`rounded-2xl border p-4 text-sm ${tone}`} role="status">
            <p className="font-semibold">{t(`tracking.status.${state}`)}</p>
            <p className="mt-1">{t(`tracking.status.${state}Body`)}</p>
            {s.updated_by && s.updated_at && <p className="text-xs mt-2 opacity-80">{t('tracking.updatedBy', { who: s.updated_by, when: f.instant(s.updated_at) })}</p>}
          </div>
          <Card title={t('tracking.builtIn.title')}>
            <p className="text-sm text-zayro-gray mb-3">{t('tracking.builtIn.help')}</p>
            <ul className="grid gap-1.5 text-sm">
              {builtIn.map((b) => (
                <li key={b.vendor} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words">{b.vendor}</span>
                  <span className={`crm-badge ${b.configured ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                    {b.configured ? t('tracking.builtIn.configured') : t('tracking.builtIn.notConfigured')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-zayro-gray mt-3">{vendors ? t('tracking.builtIn.vendorsOn') : t('tracking.builtIn.vendorsOff')}</p>
          </Card>
          <Card title={t('tracking.safety.title')}>
            <ul className="grid gap-2 text-sm text-zayro-gray list-disc pl-4">
              {(['consent', 'booking', 'admin', 'production', 'audit'] as const).map((k) => (
                <li key={k}>{t(`tracking.safety.items.${k}`)}</li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
