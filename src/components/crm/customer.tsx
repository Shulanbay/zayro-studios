'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callApi, Dialog, FormError, useApiMessage, useJsonSubmit, useToast } from './client';
import { useI18n } from './i18n';
import { rich } from '@/lib/i18n/rich';

export function CustomerEditForm({
  id,
  initial,
}: {
  id: string;
  initial: { first_name: string; last_name: string; phone: string; company: string; marketing_consent: boolean; status: 'active' | 'archived' };
}) {
  const { t } = useI18n();
  const [values, setValues] = useState(initial);
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/customers/${id}`, method: 'PATCH', successMessage: t('customers.edit.saved') });
  const set = (k: keyof typeof values, v: string | boolean) => setValues((s) => ({ ...s, [k]: v }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(values);
      }}
      className="grid grid-cols-1 sm:grid-cols-2 gap-3"
    >
      {(
        [
          ['first_name', t('customers.edit.firstName')],
          ['last_name', t('customers.edit.lastName')],
          ['phone', t('customers.edit.phone')],
          ['company', t('customers.edit.company')],
        ] as const
      ).map(([k, label]) => (
        <div key={k}>
          <label className="field-label" htmlFor={`c-${k}`}>
            {label}
          </label>
          <input id={`c-${k}`} value={values[k] as string} onChange={(e) => set(k, e.target.value)} maxLength={k === 'phone' ? 20 : 255} />
        </div>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={values.marketing_consent} onChange={(e) => set('marketing_consent', e.target.checked)} /> {t('customers.edit.marketing')}
      </label>
      <div>
        <label className="field-label" htmlFor="c-status">
          {t('customers.edit.status')}
        </label>
        <select id="c-status" value={values.status} onChange={(e) => set('status', e.target.value)}>
          <option value="active">{t('common.status.active')}</option>
          <option value="archived">{t('common.status.archived')}</option>
        </select>
      </div>
      <div className="sm:col-span-2 flex flex-wrap items-center justify-end gap-2">
        <FormError error={error} />
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy}>
          {busy ? t('customers.edit.saving') : t('customers.edit.save')}
        </button>
      </div>
    </form>
  );
}

export function AddNoteForm({ customerId }: { customerId: string }) {
  const { t } = useI18n();
  const [body, setBody] = useState('');
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/customers/${customerId}/notes`, successMessage: t('customers.edit.noteAdded'), onSuccess: () => setBody('') });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) submit({ body });
      }}
    >
      <label className="field-label" htmlFor="new-note">
        {t('customers.edit.addNote')}
      </label>
      <textarea id="new-note" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
      <FormError error={error} />
      <div className="flex justify-end mt-2">
        <button type="submit" className="crm-btn crm-btn-sm" disabled={busy || !body.trim()}>
          {busy ? t('customers.edit.adding') : t('customers.edit.add')}
        </button>
      </div>
    </form>
  );
}

interface Hit {
  id: string;
  email: string;
  name: string;
}

interface Preview {
  primary: Hit;
  duplicate: Hit;
  emailsMatch: boolean;
  moves: { bookings: number; purchases: number; packages: number; notes: number; emails: number };
  confirmationPhrase: string;
  blockers: string[];
}

/** Merge another customer record INTO this one (this one is kept). */
export function MergeDialog({ primaryId, primaryEmail }: { primaryId: string; primaryEmail: string }) {
  const router = useRouter();
  const toast = useToast();
  const { t, f } = useI18n();
  const apiMessage = useApiMessage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(primaryEmail);
  const [hits, setHits] = useState<Hit[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || query.trim().length < 2) return setHits([]);
    const t = setTimeout(async () => {
      const res = await callApi<{ customers: Hit[] }>(`/api/admin/customers/search?q=${encodeURIComponent(query.trim())}`, 'GET');
      if (res.ok) setHits(res.data.customers.filter((c) => c.id !== primaryId));
    }, 250);
    return () => clearTimeout(t);
  }, [query, open, primaryId]);

  const loadPreview = async (duplicateId: string) => {
    setError(null);
    setTyped('');
    const res = await callApi<Preview>('/api/admin/customers/merge', 'POST', { primaryId, duplicateId });
    if (!res.ok) return setError(res.data.error ? apiMessage(res.data.error, res.status) : t('customers.merge.previewFailed'));
    setPreview(res.data);
  };

  const merge = async () => {
    if (!preview) return;
    setBusy(true);
    const res = await callApi('/api/admin/customers/merge', 'POST', { primaryId, duplicateId: preview.duplicate.id, confirmation: typed });
    setBusy(false);
    if (!res.ok) return setError(res.data.error ? apiMessage(res.data.error, res.status) : t('customers.merge.failed'));
    setOpen(false);
    setPreview(null);
    toast('success', t('customers.merge.done'));
    router.refresh();
  };

  return (
    <>
      <button type="button" className="crm-btn" onClick={() => setOpen(true)}>
        {t('customers.merge.button')}
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setPreview(null);
        }}
        title={t('customers.merge.title')}
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)} disabled={busy}>
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              className="crm-btn crm-btn-danger"
              disabled={!preview || preview.blockers.length > 0 || typed.trim() !== preview.confirmationPhrase || busy}
              onClick={merge}
            >
              {busy ? t('customers.merge.merging') : t('customers.merge.merge')}
            </button>
          </>
        }
      >
        {!preview ? (
          <div className="grid gap-2">
            <p className="text-zayro-gray">
              {rich(t('customers.merge.intro'), { email: <strong>{primaryEmail}</strong> })}
            </p>
            <label className="field-label" htmlFor="merge-q">
              {t('customers.merge.find')}
            </label>
            <input id="merge-q" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            <ul className="divide-y divide-zayro-border border border-zayro-border rounded-xl overflow-hidden">
              {hits.length === 0 && <li className="p-3 text-zayro-gray">{t('customers.merge.noMatch')}</li>}
              {hits.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 p-2">
                  <span className="min-w-0">
                    <span className="font-medium">{h.name || '—'}</span> <span className="text-xs text-zayro-gray break-all">{h.email}</span>
                  </span>
                  <button type="button" className="crm-btn crm-btn-sm" onClick={() => loadPreview(h.id)}>
                    {t('customers.merge.preview')}
                  </button>
                </li>
              ))}
            </ul>
            <FormError error={error} />
          </div>
        ) : (
          <div className="grid gap-3">
            <dl className="grid grid-cols-2 gap-y-1">
              <dt className="text-zayro-gray">{t('customers.merge.keep')}</dt>
              <dd className="text-right break-all">{preview.primary.email}</dd>
              <dt className="text-zayro-gray">{t('customers.merge.away')}</dt>
              <dd className="text-right break-all">{preview.duplicate.email}</dd>
              <dt className="text-zayro-gray">{t('customers.merge.moveBookings')}</dt>
              <dd className="text-right">{f.number(preview.moves.bookings)}</dd>
              <dt className="text-zayro-gray">{t('customers.merge.movePurchases')}</dt>
              <dd className="text-right">{f.number(preview.moves.purchases)}</dd>
              <dt className="text-zayro-gray">{t('customers.merge.movePackages')}</dt>
              <dd className="text-right">{f.number(preview.moves.packages)}</dd>
              <dt className="text-zayro-gray">{t('customers.merge.moveNotes')}</dt>
              <dd className="text-right">{f.number(preview.moves.notes)}</dd>
            </dl>
            {!preview.emailsMatch && (
              <p className="form-error-banner">
                {t('customers.merge.differentEmails')}
              </p>
            )}
            {preview.blockers.map((b) => (
              <p key={b} className="form-error-banner">
                {apiMessage(b)}
              </p>
            ))}
            <div>
              <label className="field-label" htmlFor="merge-confirm">
                {rich(t('customers.merge.typeToConfirm'), { phrase: <span className="font-mono">{preview.confirmationPhrase}</span> })}
              </label>
              <input id="merge-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="font-mono" />
            </div>
            <button type="button" className="crm-link text-left" onClick={() => setPreview(null)}>
              {t('customers.merge.another')}
            </button>
            <FormError error={error} />
          </div>
        )}
      </Dialog>
    </>
  );
}
