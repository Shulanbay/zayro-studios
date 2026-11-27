'use client';

/**
 * Enter ad spend: one row by hand, or paste a CSV exported from an ad
 * platform (date, platform, campaign, amount[, clicks, impressions]). Rows for
 * the same day + platform + campaign replace the earlier figure.
 */
import { useState } from 'react';
import { FormError, useJsonSubmit } from '@/components/crm/client';
import { useI18n } from '@/components/crm/i18n';
import { parseSpendCsv, SPEND_PLATFORMS, type SpendRow as Row } from '@/lib/marketing/spendCsv';

export default function SpendForm({ today, campaigns }: { today: string; campaigns: string[] }) {
  const { t, f } = useI18n();
  const [mode, setMode] = useState<'one' | 'csv'>('one');
  const [v, setV] = useState({ date: today, platform: 'meta' as Row['platform'], campaign: '', amount: '', clicks: '', impressions: '' });
  const [csv, setCsv] = useState('');
  const parsed = parseSpendCsv(csv);
  const { submit, busy, error } = useJsonSubmit({
    url: '/api/admin/ad-spend',
    successMessage: t('spend.saved'),
    onSuccess: () => {
      setV((s) => ({ ...s, amount: '', clicks: '', impressions: '' }));
      setCsv('');
    },
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const oneValid = /^\d{4}-\d{2}-\d{2}$/.test(v.date) && v.amount !== '' && Number(v.amount) >= 0;

  return (
    <div className="grid gap-3">
      <div className="flex gap-1" role="tablist">
        {(['one', 'csv'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={`crm-btn crm-btn-sm ${mode === m ? 'crm-btn-primary' : ''}`} onClick={() => setMode(m)}>
            {t(`spend.mode.${m}`)}
          </button>
        ))}
      </div>
      {mode === 'one' ? (
        <form
          className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!oneValid) return;
            submit({ rows: [{ date: v.date, platform: v.platform, campaign: v.campaign, amount: Number(v.amount), clicks: v.clicks === '' ? null : Number(v.clicks), impressions: v.impressions === '' ? null : Number(v.impressions) }] });
          }}
        >
          <label className="block">
            <span className="field-label">{t('spend.fields.date')}</span>
            <input type="date" value={v.date} max={today} onChange={set('date')} required />
          </label>
          <label className="block">
            <span className="field-label">{t('spend.fields.platform')}</span>
            <select value={v.platform} onChange={set('platform')}>
              {SPEND_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {t.dynamic(`analytics.platforms.${p}`, p)}
                </option>
              ))}
            </select>
          </label>
          <label className="block col-span-2 md:col-span-1 xl:col-span-2">
            <span className="field-label">{t('spend.fields.campaign')}</span>
            <input value={v.campaign} onChange={set('campaign')} list="spend-campaigns" maxLength={150} placeholder="spring_podcast_promo" />
            <datalist id="spend-campaigns">
              {campaigns.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="field-label">{t('spend.fields.amount')}</span>
            <input type="number" min={0} step="0.01" inputMode="decimal" value={v.amount} onChange={set('amount')} required />
          </label>
          <label className="block">
            <span className="field-label">{t('spend.fields.clicks')}</span>
            <input type="number" min={0} step={1} inputMode="numeric" value={v.clicks} onChange={set('clicks')} />
          </label>
          <label className="block">
            <span className="field-label">{t('spend.fields.impressions')}</span>
            <input type="number" min={0} step={1} inputMode="numeric" value={v.impressions} onChange={set('impressions')} />
          </label>
          <div className="col-span-2 md:col-span-3 xl:col-span-7 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zayro-gray">{t('spend.campaignHint')}</p>
            <button type="submit" className="crm-btn crm-btn-primary" disabled={busy || !oneValid}>
              {busy ? t('common.actions.saving') : t('spend.add')}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid gap-2">
          <p className="text-sm text-zayro-gray">{t('spend.csvHelp')}</p>
          <textarea rows={7} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono text-xs" spellCheck={false} placeholder={'date,platform,campaign,amount,clicks,impressions\n2026-11-20,meta,spring_podcast_promo,45.20,310,12000\n2026-11-20,google,brand_search,18.00,42,900'} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zayro-gray">
              {t('spend.csvSummary', { rows: f.number(parsed.rows.length), total: f.money(Math.round(parsed.rows.reduce((a, r) => a + r.amount, 0) * 100)) })}
              {parsed.bad.length > 0 && <span className="text-red-700"> · {t('spend.csvBad', { lines: parsed.bad.slice(0, 10).join(', ') })}</span>}
            </p>
            <button type="button" className="crm-btn crm-btn-primary" disabled={busy || parsed.rows.length === 0 || parsed.bad.length > 0 || parsed.rows.length > 500} onClick={() => submit({ rows: parsed.rows })}>
              {busy ? t('common.actions.saving') : t('spend.import', { n: parsed.rows.length })}
            </button>
          </div>
        </div>
      )}
      <FormError error={error} />
    </div>
  );
}
