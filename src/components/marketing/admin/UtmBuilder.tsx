'use client';

/**
 * Campaign URL builder (like Google's Campaign URL Builder, with ad-platform
 * presets and dynamic macros). Links can be saved to a shared library so the
 * team uses the same naming everywhere — utm_campaign is what ad spend and
 * leads are matched on.
 */
import { useMemo, useState } from 'react';
import { ActionButton, callApi, useApiMessage, useToast } from '@/components/crm/client';
import { useI18n } from '@/components/crm/i18n';
import { useRouter } from 'next/navigation';

type Preset = { key: string; source: string; medium: string; macros?: { campaign?: string; content?: string; term?: string; id?: string } };

export const UTM_PRESETS: Preset[] = [
  { key: 'meta', source: 'facebook', medium: 'paid_social', macros: { campaign: '{{campaign.name}}', content: '{{ad.name}}', term: '{{adset.name}}', id: '{{campaign.id}}' } },
  { key: 'instagram', source: 'instagram', medium: 'paid_social', macros: { campaign: '{{campaign.name}}', content: '{{ad.name}}', term: '{{adset.name}}', id: '{{campaign.id}}' } },
  { key: 'google', source: 'google', medium: 'cpc', macros: { content: '{creative}', term: '{keyword}', id: '{campaignid}' } },
  { key: 'tiktok', source: 'tiktok', medium: 'paid_social', macros: { campaign: '__CAMPAIGN_NAME__', content: '__CID_NAME__', term: '__AID_NAME__', id: '__CAMPAIGN_ID__' } },
  { key: 'reddit', source: 'reddit', medium: 'paid_social', macros: { campaign: '{{CAMPAIGN_NAME}}', content: '{{AD_NAME}}', term: '{{ADGROUP_NAME}}', id: '{{CAMPAIGN_ID}}' } },
  { key: 'pinterest', source: 'pinterest', medium: 'paid_social', macros: { content: '{adid}', term: '{adgroupid}', id: '{campaignid}' } },
  { key: 'x', source: 'twitter', medium: 'paid_social' },
  { key: 'chatgpt', source: 'chatgpt', medium: 'cpc' },
  { key: 'email', source: 'newsletter', medium: 'email' },
  { key: 'influencer', source: 'influencer', medium: 'referral' },
  { key: 'organic', source: 'instagram', medium: 'social' },
  { key: 'qr', source: 'qr', medium: 'offline' },
];

const clean = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_.{}]/g, '')
    .replace(/_+/g, '_')
    .slice(0, 150);
const isMacro = (s: string) => /[{}]|__[A-Z_]+__/.test(s);

export interface SavedLink {
  id: string;
  name: string;
  url: string;
  platform: string | null;
  created_by: string | null;
  created_at: string;
}

export default function UtmBuilder({ origin, paths, saved }: { origin: string; paths: string[]; saved: SavedLink[] }) {
  const { t, f } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const apiMessage = useApiMessage();
  const [base, setBase] = useState(`${origin}/`);
  const [preset, setPreset] = useState<string>('meta');
  const [useMacros, setUseMacros] = useState(false);
  const [v, setV] = useState({ source: 'facebook', medium: 'paid_social', campaign: '', content: '', term: '', id: '' });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const applyPreset = (key: string, macros = useMacros) => {
    const p = UTM_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setPreset(key);
    setV((s) => ({
      source: p.source,
      medium: p.medium,
      campaign: macros && p.macros?.campaign ? p.macros.campaign : isMacro(s.campaign) ? '' : s.campaign,
      content: macros && p.macros?.content ? p.macros.content : isMacro(s.content) ? '' : s.content,
      term: macros && p.macros?.term ? p.macros.term : isMacro(s.term) ? '' : s.term,
      id: macros && p.macros?.id ? p.macros.id : isMacro(s.id) ? '' : s.id,
    }));
  };

  const { url, problems } = useMemo(() => {
    const problems: string[] = [];
    let u: URL | null = null;
    try {
      u = new URL(base.trim());
    } catch {
      problems.push('base');
    }
    if (u && u.protocol !== 'https:') problems.push('https');
    if (!v.source.trim()) problems.push('source');
    if (!v.medium.trim()) problems.push('medium');
    if (!v.campaign.trim()) problems.push('campaign');
    for (const x of [v.source, v.medium, v.campaign, v.content, v.term]) if (x && !isMacro(x) && x !== clean(x)) problems.push('naming');
    if (!u) return { url: '', problems };
    const params: [string, string][] = [
      ['utm_source', v.source],
      ['utm_medium', v.medium],
      ['utm_campaign', v.campaign],
      ['utm_content', v.content],
      ['utm_term', v.term],
      ['utm_id', v.id],
    ];
    for (const [k] of params) u.searchParams.delete(k);
    // Macros must stay unencoded ({{…}}, {…}) or the ad platform won't replace them.
    const extra = params
      .filter(([, val]) => val.trim())
      .map(([k, val]) => `${k}=${isMacro(val) ? val.trim() : encodeURIComponent(val.trim())}`)
      .join('&');
    const head = u.toString();
    const [beforeHash, hash] = head.split('#');
    const out = `${beforeHash}${extra ? (beforeHash.includes('?') ? '&' : '?') + extra : ''}${hash !== undefined ? `#${hash}` : ''}`;
    return { url: out, problems: [...new Set(problems)] };
  }, [base, v]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', t('utm.copied'));
    } catch {
      toast('error', t('utm.copyFailed'));
    }
  };

  const save = async () => {
    setBusy(true);
    const res = await callApi('/api/admin/utm-links', 'POST', { name: name.trim() || v.campaign || preset, url, platform: preset, utm_campaign: isMacro(v.campaign) ? null : v.campaign || null });
    setBusy(false);
    if (!res.ok) return toast('error', apiMessage(res.data?.error, res.status));
    toast('success', t('utm.savedToast'));
    setName('');
    router.refresh();
  };

  const field = (k: keyof typeof v, required = false) => (
    <label className="block min-w-0" key={k}>
      <span className="field-label">
        {t(`utm.fields.${k}`)} {required && <span className="text-red-600">*</span>}
      </span>
      <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="font-mono text-sm" maxLength={150} />
      <span className="text-xs text-zayro-gray block mt-1">{t(`utm.hints.${k}`)}</span>
    </label>
  );
  const blocking = problems.some((p) => p !== 'naming');

  return (
    <div className="grid gap-4">
      <section className="card grid gap-4">
        <div>
          <p className="field-label">{t('utm.platform')}</p>
          <div className="flex flex-wrap gap-1.5">
            {UTM_PRESETS.map((p) => (
              <button key={p.key} type="button" className={`crm-btn crm-btn-sm ${preset === p.key ? 'crm-btn-primary' : ''}`} onClick={() => applyPreset(p.key)}>
                {t.dynamic(`utm.presets.${p.key}`, p.key)}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm mt-3">
            <input
              type="checkbox"
              checked={useMacros}
              disabled={!UTM_PRESETS.find((p) => p.key === preset)?.macros}
              onChange={(e) => {
                setUseMacros(e.target.checked);
                applyPreset(preset, e.target.checked);
              }}
            />
            {t('utm.macros')}
          </label>
          <p className="text-xs text-zayro-gray mt-1">{t('utm.macrosHelp')}</p>
        </div>
        <label className="block">
          <span className="field-label">{t('utm.base')}</span>
          <input value={base} onChange={(e) => setBase(e.target.value)} list="utm-paths" className="font-mono text-sm" />
          <datalist id="utm-paths">
            {paths.map((p) => (
              <option key={p} value={`${origin}${p}`} />
            ))}
          </datalist>
          <span className="text-xs text-zayro-gray block mt-1">{t('utm.baseHint')}</span>
        </label>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {field('source', true)}
          {field('medium', true)}
          {field('campaign', true)}
          {field('content')}
          {field('term')}
          {field('id')}
        </div>
        {problems.includes('naming') && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-amber-800">
            ⚠ {t('utm.problems.naming')}
            <button
              type="button"
              className="crm-btn crm-btn-sm"
              onClick={() => setV({ source: clean(v.source), medium: clean(v.medium), campaign: isMacro(v.campaign) ? v.campaign : clean(v.campaign), content: isMacro(v.content) ? v.content : clean(v.content), term: isMacro(v.term) ? v.term : clean(v.term), id: v.id.trim() })}
            >
              {t('utm.cleanUp')}
            </button>
          </div>
        )}
      </section>

      <section className="card grid gap-3">
        <p className="field-label !mb-0">{t('utm.result')}</p>
        <output className="block rounded-xl bg-slate-950 text-slate-100 font-mono text-xs p-3 break-all min-h-[3rem]">{url || '—'}</output>
        {problems.filter((p) => p !== 'naming').length > 0 && (
          <ul className="text-sm text-red-700 grid gap-0.5">
            {problems
              .filter((p) => p !== 'naming')
              .map((p) => (
                <li key={p}>✕ {t.dynamic(`utm.problems.${p}`, p)}</li>
              ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 items-end">
          <button type="button" className="crm-btn crm-btn-primary" disabled={blocking} onClick={() => void copy(url)}>
            {t('utm.copy')}
          </button>
          <label className="block flex-1 min-w-[200px]">
            <span className="field-label">{t('utm.name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} placeholder={v.campaign || t('utm.namePlaceholder')} />
          </label>
          <button type="button" className="crm-btn" disabled={blocking || busy} onClick={() => void save()}>
            {busy ? t('common.actions.saving') : t('utm.save')}
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="text-base font-semibold mb-3">{t('utm.library', { n: f.number(saved.length) })}</h2>
        {saved.length === 0 ? (
          <p className="text-sm text-zayro-gray">{t('utm.libraryEmpty')}</p>
        ) : (
          <ul className="grid gap-2">
            {saved.map((l) => (
              <li key={l.id} className="rounded-xl border border-zayro-border p-3 grid gap-1">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <span className="font-semibold break-words min-w-0">
                    {l.name}
                    {l.platform && <span className="text-xs font-normal text-zayro-gray"> · {t.dynamic(`utm.presets.${l.platform}`, l.platform)}</span>}
                  </span>
                  <div className="flex gap-1">
                    <button type="button" className="crm-btn crm-btn-sm" onClick={() => void copy(l.url)}>
                      {t('utm.copy')}
                    </button>
                    <ActionButton url={`/api/admin/utm-links?id=${l.id}`} method="DELETE" label={t('common.actions.delete')} className="crm-btn crm-btn-sm" confirm={{ title: t('utm.deleteTitle'), body: l.name, confirmLabel: t('common.actions.delete'), danger: true }} />
                  </div>
                </div>
                <code className="text-xs text-zayro-gray break-all">{l.url}</code>
                <span className="text-xs text-zayro-gray">
                  {l.created_by ?? ''} · {f.instantDate(l.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
