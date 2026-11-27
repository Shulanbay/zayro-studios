'use client';

/**
 * Admin → Tracking & code: the master switch, site-wide tracking code with
 * its consent category, search-console verification tags, messenger links
 * and lead notifications. One form, one save, everything audited.
 */
import { useState } from 'react';
import { FormError, useJsonSubmit } from '@/components/crm/client';
import { useI18n } from '@/components/crm/i18n';
import { verificationFromHtml } from '@/lib/marketing/scripts';
import CodeField from './CodeField';

export interface TrackingValues {
  scripts_enabled: boolean;
  global_head_scripts: string;
  global_body_scripts: string;
  global_scripts_consent: 'necessary' | 'analytics' | 'advertising';
  site_verification: { name: string; content: string }[];
  whatsapp_number: string;
  telegram_username: string;
  use_landing_home: boolean;
  notify_new_leads: boolean;
}

export default function TrackingForm({
  initial,
  canManagePages,
  homeReady,
  builtIn,
}: {
  initial: TrackingValues;
  canManagePages: boolean;
  homeReady: boolean;
  builtIn: { vendor: string; configured: boolean }[];
}) {
  const { t } = useI18n();
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [paste, setPaste] = useState('');
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);
  const { submit, busy, error } = useJsonSubmit({
    url: '/api/admin/marketing/settings',
    method: 'PATCH',
    successMessage: t('tracking.saved'),
    onSuccess: () => setSaved(v),
  });

  const save = () => {
    const body: Record<string, unknown> = {};
    for (const k of Object.keys(v) as (keyof TrackingValues)[]) {
      if (JSON.stringify(v[k]) === JSON.stringify(saved[k])) continue;
      if (k === 'use_landing_home' && !canManagePages) continue;
      const val = v[k];
      body[k] = typeof val === 'string' ? val.trim() || null : val;
    }
    submit(body);
  };

  const addVerification = () => {
    const found = verificationFromHtml(paste);
    if (!found.length) return;
    const names = new Set(found.map((x) => x.name));
    setV({ ...v, site_verification: [...v.site_verification.filter((x) => !names.has(x.name)), ...found].slice(0, 10) });
    setPaste('');
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <section className="card grid gap-3">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={v.scripts_enabled} onChange={(e) => setV({ ...v, scripts_enabled: e.target.checked })} />
          <span>
            <span className="font-semibold block">{t('tracking.master.label')}</span>
            <span className="text-sm text-zayro-gray">{t('tracking.master.help')}</span>
          </span>
        </label>
      </section>

      <section className="card grid gap-4">
        <div>
          <h2 className="text-base font-semibold">{t('tracking.global.title')}</h2>
          <p className="text-sm text-zayro-gray">{t('tracking.global.help')}</p>
        </div>
        <label className="block max-w-md">
          <span className="field-label">{t('tracking.consent')}</span>
          <select value={v.global_scripts_consent} onChange={(e) => setV({ ...v, global_scripts_consent: e.target.value as TrackingValues['global_scripts_consent'] })}>
            {(['analytics', 'advertising', 'necessary'] as const).map((c) => (
              <option key={c} value={c}>
                {t(`tracking.consents.${c}`)}
              </option>
            ))}
          </select>
          <span className="text-xs text-zayro-gray block mt-1">{t('tracking.consentHelp')}</span>
        </label>
        <CodeField id="tr-head" label={t('tracking.headCode')} hint={t('tracking.headHint')} value={v.global_head_scripts} onChange={(x) => setV({ ...v, global_head_scripts: x })} builtIn={builtIn} consent={v.global_scripts_consent} />
        <CodeField id="tr-body" label={t('tracking.bodyCode')} hint={t('tracking.bodyHint')} value={v.global_body_scripts} onChange={(x) => setV({ ...v, global_body_scripts: x })} builtIn={builtIn} consent={v.global_scripts_consent} />
      </section>

      <section className="card grid gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('tracking.verification.title')}</h2>
          <p className="text-sm text-zayro-gray">{t('tracking.verification.help')}</p>
        </div>
        {v.site_verification.length === 0 ? (
          <p className="text-sm text-zayro-gray">{t('tracking.verification.none')}</p>
        ) : (
          <ul className="grid gap-1">
            {v.site_verification.map((tag) => (
              <li key={tag.name} className="flex flex-wrap items-center gap-2 rounded-xl border border-zayro-border px-3 py-2 text-sm">
                <span className="font-mono break-all min-w-0 flex-1">
                  {tag.name} = {tag.content}
                </span>
                <button type="button" className="crm-btn crm-btn-sm crm-btn-danger" onClick={() => setV({ ...v, site_verification: v.site_verification.filter((x) => x.name !== tag.name) })}>
                  {t('common.actions.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
          <label className="block min-w-0">
            <span className="field-label">{t('tracking.verification.paste')}</span>
            <input value={paste} onChange={(e) => setPaste(e.target.value)} className="font-mono text-sm" placeholder='<meta name="google-site-verification" content="…" />' />
          </label>
          <button type="button" className="crm-btn" disabled={!verificationFromHtml(paste).length} onClick={addVerification}>
            {t('tracking.verification.add')}
          </button>
        </div>
      </section>

      <section className="card grid gap-3" id="messengers">
        <div>
          <h2 className="text-base font-semibold">{t('tracking.messengers.title')}</h2>
          <p className="text-sm text-zayro-gray">{t('tracking.messengers.help')}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">WhatsApp</span>
            <input type="tel" value={v.whatsapp_number} onChange={(e) => setV({ ...v, whatsapp_number: e.target.value })} placeholder="+1 212 555 0100" maxLength={30} />
            <span className="text-xs text-zayro-gray block mt-1">{t('tracking.messengers.whatsappHint')}</span>
          </label>
          <label className="block">
            <span className="field-label">Telegram</span>
            <input value={v.telegram_username} onChange={(e) => setV({ ...v, telegram_username: e.target.value })} placeholder="@zayrostudios" maxLength={64} />
            <span className="text-xs text-zayro-gray block mt-1">{t('tracking.messengers.telegramHint')}</span>
          </label>
        </div>
        <label className="flex items-start gap-3 pt-2 border-t border-zayro-border">
          <input type="checkbox" className="mt-1" checked={v.notify_new_leads} onChange={(e) => setV({ ...v, notify_new_leads: e.target.checked })} />
          <span>
            <span className="font-semibold block">{t('tracking.leads.notify')}</span>
            <span className="text-sm text-zayro-gray">{t('tracking.leads.notifyHelp')}</span>
          </span>
        </label>
      </section>

      {canManagePages && (
        <section className="card grid gap-2">
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1" checked={v.use_landing_home} disabled={!homeReady && !v.use_landing_home} onChange={(e) => setV({ ...v, use_landing_home: e.target.checked })} />
            <span>
              <span className="font-semibold block">{t('tracking.home.toggle')}</span>
              <span className="text-sm text-zayro-gray">{homeReady ? t('tracking.home.help') : t('tracking.home.missing')}</span>
            </span>
          </label>
        </section>
      )}

      <FormError error={error} />
      <div className="card !p-3 flex flex-wrap items-center justify-end gap-2 sticky bottom-2 z-10">
        {dirty && <span className="text-xs text-amber-700 mr-auto">● {t('pages.unsaved')}</span>}
        <button type="button" className="crm-btn" disabled={!dirty || busy} onClick={() => setV(saved)}>
          {t('common.actions.cancel')}
        </button>
        <button type="submit" className="crm-btn crm-btn-primary" disabled={!dirty || busy}>
          {busy ? t('common.actions.saving') : t('common.actions.saveChanges')}
        </button>
      </div>
    </form>
  );
}
