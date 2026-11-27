'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, FormError, useJsonSubmit } from '@/components/crm/client';
import { useI18n } from '@/components/crm/i18n';

const METHODS = ['whatsapp', 'telegram', 'phone', 'instagram', 'email', 'form', 'direct_booking', 'other'] as const;
const STATUSES = ['new', 'in_progress', 'booked', 'paid', 'rejected'] as const;
const SOURCES = ['facebook', 'instagram', 'google', 'tiktok', 'reddit', 'pinterest', 'twitter', 'chatgpt', 'referral', 'other'];

/** "Add lead" — for WhatsApp / Telegram / calls / DMs that did not come through a form. */
export function AddLeadButton({ openInitially = false }: { openInitially?: boolean }) {
  const { t, label } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(openInitially);
  const empty = { name: '', phone: '', email: '', contact_method: 'whatsapp', status: 'new', utm_source: '', utm_campaign: '', revenue: '', message: '' };
  const [v, setV] = useState(empty);
  const { submit, busy, error } = useJsonSubmit({
    url: '/api/admin/leads',
    successMessage: t('marketing.leads.added'),
    refresh: false,
    onSuccess: (data) => {
      setOpen(false);
      setV(empty);
      router.push(`/admin/leads/${data.id}`);
    },
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <button type="button" className="crm-btn crm-btn-primary" onClick={() => setOpen(true)}>
        {t('marketing.leads.add')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('marketing.leads.addTitle')}
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              className="crm-btn crm-btn-primary"
              disabled={busy || (!v.name.trim() && !v.phone.trim() && !v.email.trim())}
              onClick={() =>
                submit({
                  name: v.name || null,
                  phone: v.phone || null,
                  email: v.email || null,
                  contact_method: v.contact_method,
                  status: v.status,
                  utm_source: v.utm_source || null,
                  utm_campaign: v.utm_campaign || null,
                  message: v.message || null,
                  ...(v.revenue ? { revenue: Number(v.revenue) } : {}),
                })
              }
            >
              {busy ? t('common.actions.saving') : t('marketing.leads.addSubmit')}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field id="nl-name" label={t('marketing.lead.name')}>
            <input id="nl-name" value={v.name} onChange={set('name')} maxLength={200} />
          </Field>
          <Field id="nl-phone" label={t('marketing.lead.phone')}>
            <input id="nl-phone" type="tel" value={v.phone} onChange={set('phone')} maxLength={40} />
          </Field>
          <Field id="nl-email" label={t('marketing.lead.email')}>
            <input id="nl-email" type="email" value={v.email} onChange={set('email')} maxLength={255} />
          </Field>
          <Field id="nl-method" label={t('marketing.lead.method')}>
            <select id="nl-method" value={v.contact_method} onChange={set('contact_method')}>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {label(m)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="nl-source" label={t('marketing.lead.source')}>
            <input id="nl-source" list="nl-sources" value={v.utm_source} onChange={set('utm_source')} maxLength={150} placeholder="instagram" />
            <datalist id="nl-sources">
              {SOURCES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field id="nl-campaign" label={t('marketing.lead.campaign')}>
            <input id="nl-campaign" value={v.utm_campaign} onChange={set('utm_campaign')} maxLength={150} />
          </Field>
          <Field id="nl-status" label={t('marketing.lead.status')}>
            <select id="nl-status" value={v.status} onChange={set('status')}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`marketing.status.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="nl-revenue" label={t('marketing.lead.revenue')}>
            <input id="nl-revenue" type="number" min={0} step="0.01" inputMode="decimal" value={v.revenue} onChange={set('revenue')} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="nl-message" label={t('marketing.lead.message')}>
              <textarea id="nl-message" rows={3} value={v.message} onChange={set('message')} maxLength={3000} />
            </Field>
          </div>
        </div>
        <FormError error={error} />
      </Dialog>
    </>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

export interface EditableLead {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  contact_method: string;
  revenue_cents: number;
  ad_spend_attributed_cents: number;
  lost_reason: string | null;
  assigned_to: string | null;
  notes: string | null;
}

/** The lead's deal panel: stage, value, owner, reason lost, contact details. */
export function LeadEditor({ lead, team, canEdit }: { lead: EditableLead; team: string[]; canEdit: boolean }) {
  const { t, label } = useI18n();
  const init = {
    name: lead.name ?? '',
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    status: lead.status,
    contact_method: lead.contact_method,
    revenue: (lead.revenue_cents / 100).toFixed(2),
    ad_spend: (lead.ad_spend_attributed_cents / 100).toFixed(2),
    lost_reason: lead.lost_reason ?? '',
    assigned_to: lead.assigned_to ?? '',
    notes: lead.notes ?? '',
  };
  const [v, setV] = useState(init);
  useEffect(() => setV(init), [lead.id, lead.status, lead.revenue_cents]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/leads/${lead.id}`, method: 'PATCH', successMessage: t('marketing.leads.saved') });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = () =>
    submit({
      name: v.name || null,
      phone: v.phone || null,
      email: v.email || null,
      status: v.status,
      contact_method: v.contact_method,
      revenue: Number(v.revenue || 0),
      ad_spend_attributed: Number(v.ad_spend || 0),
      lost_reason: v.status === 'rejected' ? v.lost_reason || null : null,
      assigned_to: v.assigned_to || null,
      notes: v.notes || null,
    });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="grid gap-3"
    >
      <fieldset disabled={!canEdit} className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
        <Field id="le-status" label={t('marketing.lead.status')}>
          <select id="le-status" value={v.status} onChange={set('status')}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`marketing.status.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="le-assigned" label={t('marketing.lead.assigned')}>
          <select id="le-assigned" value={v.assigned_to} onChange={set('assigned_to')}>
            <option value="">{t('marketing.lead.unassigned')}</option>
            {team.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        {v.status === 'rejected' && (
          <div className="sm:col-span-2">
            <Field id="le-lost" label={t('marketing.lead.lostReason')}>
              <input id="le-lost" list="le-lost-reasons" value={v.lost_reason} onChange={set('lost_reason')} maxLength={200} />
              <datalist id="le-lost-reasons">
                {(['price', 'date', 'noResponse', 'competitor', 'notFit'] as const).map((k) => (
                  <option key={k} value={t(`marketing.lostReasons.${k}`)} />
                ))}
              </datalist>
            </Field>
          </div>
        )}
        <Field id="le-revenue" label={t('marketing.lead.revenue')}>
          <input id="le-revenue" type="number" min={0} step="0.01" inputMode="decimal" value={v.revenue} onChange={set('revenue')} />
        </Field>
        <Field id="le-spend" label={t('marketing.lead.adSpend')}>
          <input id="le-spend" type="number" min={0} step="0.01" inputMode="decimal" value={v.ad_spend} onChange={set('ad_spend')} />
        </Field>
        <p className="sm:col-span-2 text-xs text-zayro-gray -mt-1">{t('marketing.lead.revenueNote')}</p>
        <Field id="le-name" label={t('marketing.lead.name')}>
          <input id="le-name" value={v.name} onChange={set('name')} maxLength={200} />
        </Field>
        <Field id="le-method" label={t('marketing.lead.method')}>
          <select id="le-method" value={v.contact_method} onChange={set('contact_method')}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {label(m)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="le-phone" label={t('marketing.lead.phone')}>
          <input id="le-phone" type="tel" value={v.phone} onChange={set('phone')} maxLength={40} />
        </Field>
        <Field id="le-email" label={t('marketing.lead.email')}>
          <input id="le-email" type="email" value={v.email} onChange={set('email')} maxLength={255} />
        </Field>
        <div className="sm:col-span-2">
          <Field id="le-notes" label={t('marketing.lead.summary')}>
            <textarea id="le-notes" rows={3} value={v.notes} onChange={set('notes')} maxLength={5000} />
          </Field>
        </div>
      </fieldset>
      <FormError error={error} />
      {canEdit && (
        <div className="flex justify-end">
          <button type="submit" className="crm-btn crm-btn-primary" disabled={!dirty || busy}>
            {busy ? t('common.actions.saving') : t('common.actions.saveChanges')}
          </button>
        </div>
      )}
    </form>
  );
}

export function LeadNoteForm({ leadId }: { leadId: number }) {
  const { t } = useI18n();
  const [body, setBody] = useState('');
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/leads/${leadId}/notes`, successMessage: t('marketing.leads.noteAdded'), onSuccess: () => setBody('') });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) submit({ body });
      }}
      className="grid gap-2"
    >
      <label className="sr-only" htmlFor="lead-note">
        {t('marketing.leads.addNote')}
      </label>
      <textarea id="lead-note" rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} placeholder={t('marketing.leads.notePlaceholder')} />
      <FormError error={error} />
      <div className="flex justify-end">
        <button type="submit" className="crm-btn crm-btn-sm" disabled={busy || !body.trim()}>
          {t('marketing.leads.addNote')}
        </button>
      </div>
    </form>
  );
}
