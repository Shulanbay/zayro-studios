import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rowsOf } from '@/lib/db/types';
import { getAdminContext } from '@/lib/crm/auth';
import { todayInTz } from '@/lib/crm/time';
import { ActionButton } from '@/components/crm/client';
import { Card, EmptyState, Forbidden, PageHeader } from '@/components/crm/ui';
import { getAdminI18n } from '@/lib/i18n/server';
import { daysOf, parseMarketingRange, RANGE_PRESETS } from '@/lib/marketing/range';
import { listSpend, spendByCampaign, spendSeries, spendTotals } from '@/lib/marketing/spend';
import { Bars, Metric, RangeTabs } from '@/components/marketing/admin/Bits';
import SpendForm from '@/components/marketing/admin/SpendForm';

export const dynamic = 'force-dynamic';

export default async function AdSpendPage({ searchParams }: { searchParams: { range?: string; from?: string; to?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('marketing.spend')) return <Forbidden what="ad spend" />;
  const { t, f } = getAdminI18n(admin);
  const range = parseMarketingRange(searchParams);
  const [totals, byCampaign, rows, series, known] = await Promise.all([
    spendTotals(range),
    spendByCampaign(range),
    listSpend(range),
    spendSeries(range),
    db
      .execute(sql`SELECT DISTINCT utm_campaign AS c FROM leads WHERE utm_campaign IS NOT NULL AND created_at > now() - interval '180 days'
                   UNION SELECT DISTINCT campaign FROM ad_spend WHERE campaign <> '' AND spend_date > (now() - interval '180 days')::date LIMIT 200`)
      .then((r) => rowsOf<{ c: string }>(r).map((x) => x.c))
      .catch(() => [] as string[]),
  ]);
  const days = daysOf(range);
  const byPlatform = new Map<string, number>();
  for (const c of byCampaign) byPlatform.set(c.platform, (byPlatform.get(c.platform) ?? 0) + c.spendCents);
  const platforms = [...byPlatform.entries()].sort((a, b) => b[1] - a[1]);
  const cpc = totals.clicks > 0 ? Math.round(totals.spendCents / totals.clicks) : null;
  const cpm = totals.impressions > 0 ? Math.round((totals.spendCents / totals.impressions) * 1000) : null;
  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : null;
  const label = (p: string) => t.dynamic(`analytics.platforms.${p}`, p);

  return (
    <>
      <PageHeader title={t('common.nav.adSpend')} description={t('spend.description', { range: f.dateRange(range.from, range.to) })} />
      <div className="card !p-4 mb-4">
        <RangeTabs active={range.key} items={RANGE_PRESETS.map((k) => ({ key: k, label: t(`marketing.ranges.${k}`), href: `?range=${k}` }))} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Metric label={t('spend.kpi.spend')} value={f.money(totals.spendCents)} hint={t('spend.kpi.manual')} />
        <Metric label={t('spend.kpi.clicks')} value={f.number(totals.clicks)} />
        <Metric label={t('spend.kpi.impressions')} value={f.number(totals.impressions)} />
        <Metric label={t('spend.kpi.cpc')} value={cpc === null ? '—' : f.money(cpc)} />
        <Metric label={t('spend.kpi.ctr')} value={ctr === null ? '—' : f.percent(ctr, 2)} hint={cpm === null ? undefined : t('spend.kpi.cpm', { cpm: f.money(cpm) })} />
      </div>

      <Card title={t('spend.addTitle')} className="mb-4">
        <SpendForm today={todayInTz()} campaigns={known} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px] items-start mb-4">
        <Card title={t('spend.daily')}>
          <Bars values={days.map((d) => series.get(d) ?? 0)} labels={days.map((d) => f.dateShort(d))} format={(v) => f.money(v)} title={t('spend.daily')} />
          <div className="flex justify-between text-xs text-zayro-gray mt-1">
            <span>{f.dateShort(range.from)}</span>
            <span>{f.dateShort(range.to)}</span>
          </div>
        </Card>
        <Card title={t('spend.byPlatform')}>
          {platforms.length === 0 ? (
            <p className="text-sm text-zayro-gray">—</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {platforms.map(([p, c]) => (
                <li key={p}>
                  <div className="flex justify-between gap-2">
                    <span>{label(p)}</span>
                    <span className="tabular-nums font-medium">{f.money(c)}</span>
                  </div>
                  <div className="h-1.5 rounded bg-slate-100 mt-1 overflow-hidden">
                    <div className="h-full bg-zayro-primary/80" style={{ width: `${(c / Math.max(1, totals.spendCents)) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t('spend.entries', { n: f.number(rows.length) })}>
        {rows.length === 0 ? (
          <EmptyState title={t('spend.emptyTitle')} body={t('spend.emptyBody')} />
        ) : (
          <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
            <table className="crm-table min-w-[720px]">
              <thead>
                <tr>
                  {(['date', 'platform', 'campaign', 'amount', 'clicks', 'impressions'] as const).map((c) => (
                    <th key={c} scope="col" className={['amount', 'clicks', 'impressions'].includes(c) ? 'text-right' : ''}>
                      {t(`spend.fields.${c}`)}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="sr-only">{t('common.actions.delete')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{f.dateShort(r.spend_date)}</td>
                    <td>{label(r.platform)}</td>
                    <td className="font-mono text-xs break-all">{r.campaign || <span className="text-zayro-gray font-sans">{t('spend.noCampaign')}</span>}</td>
                    <td className="text-right tabular-nums">{f.money(r.amount_cents)}</td>
                    <td className="text-right tabular-nums">{r.clicks === null ? '—' : f.number(r.clicks)}</td>
                    <td className="text-right tabular-nums">{r.impressions === null ? '—' : f.number(r.impressions)}</td>
                    <td className="text-right">
                      <ActionButton
                        url={`/api/admin/ad-spend?id=${r.id}`}
                        method="DELETE"
                        label={t('common.actions.delete')}
                        className="crm-btn crm-btn-sm"
                        confirm={{ title: t('spend.deleteTitle'), body: t('spend.deleteBody', { amount: f.money(r.amount_cents), date: f.dateShort(r.spend_date) }), confirmLabel: t('common.actions.delete'), danger: true }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-zayro-gray mt-3">{t('spend.footnote')}</p>
    </>
  );
}
