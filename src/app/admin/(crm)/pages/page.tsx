import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { Card, EmptyState, Forbidden, PageHeader } from '@/components/crm/ui';
import { getAdminI18n } from '@/lib/i18n/server';
import { listPages, pageStats } from '@/lib/marketing/pages';
import { presetRange } from '@/lib/marketing/range';
import { getMarketingSettings } from '@/lib/marketing/settings';
import NewPageButton from '@/components/marketing/admin/NewPageButton';

export const dynamic = 'force-dynamic';

export default async function LandingPagesPage({ searchParams }: { searchParams: { new?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('pages.manage')) return <Forbidden what="landing pages" />;
  const { t, f } = getAdminI18n(admin);
  const range = presetRange('30d');
  const [pages, stats, settings] = await Promise.all([listPages(), pageStats(range), getMarketingSettings()]);
  return (
    <>
      <PageHeader title={t('common.nav.pages')} description={t('pages.description')} actions={<NewPageButton openInitially={searchParams.new === '1'} />} />
      <Card>
        {pages.length === 0 ? (
          <EmptyState title={t('pages.emptyTitle')} body={t('pages.emptyBody')} />
        ) : (
          <div className="crm-table-wrap -mx-5 md:-mx-6 -my-5 md:-my-6">
            <table className="crm-table min-w-[760px]">
              <thead>
                <tr>
                  {(['page', 'status', 'views', 'leads', 'conv', 'updated'] as const).map((c) => (
                    <th key={c} scope="col">
                      {t(`pages.cols.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => {
                  const s = stats.get(p.slug);
                  const url = p.slug === 'home' ? '/' : `/${p.slug}`;
                  return (
                    <tr key={p.id}>
                      <td className="min-w-[220px]">
                        <Link href={`/admin/pages/${p.id}`} className="font-medium">
                          {p.title}
                        </Link>
                        <div className="text-xs text-zayro-gray font-mono">
                          {url}
                          {p.slug === 'home' && !settings.use_landing_home ? ` · ${t('pages.homeOff')}` : ''}
                        </div>
                      </td>
                      <td>
                        <span className={`crm-badge ${p.is_published ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>{p.is_published ? t('pages.published') : t('pages.draft')}</span>
                        {p.is_published && (
                          <a href={url} target="_blank" rel="noopener" className="ml-2 text-xs">
                            {t('pages.open')} ↗
                          </a>
                        )}
                      </td>
                      <td className="tabular-nums">{f.number(s?.views ?? 0)}</td>
                      <td className="tabular-nums">{f.number(s?.leads ?? 0)}</td>
                      <td className="tabular-nums">{s && s.visitors > 0 ? f.percent(Math.min(1, s.leads / s.visitors), 1) : '—'}</td>
                      <td className="text-xs text-zayro-gray whitespace-nowrap">
                        {f.instant(p.updated_at)}
                        {p.updated_by ? <div className="break-all">{p.updated_by}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-zayro-gray mt-3">{t('pages.statsNote')}</p>
    </>
  );
}
