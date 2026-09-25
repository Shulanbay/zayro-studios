'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callApi, Dialog, FormError, useJsonSubmit, useToast } from './client';

export function CustomerEditForm({
  id,
  initial,
}: {
  id: string;
  initial: { first_name: string; last_name: string; phone: string; company: string; marketing_consent: boolean; status: 'active' | 'archived' };
}) {
  const [values, setValues] = useState(initial);
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/customers/${id}`, method: 'PATCH', successMessage: 'Customer saved' });
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
          ['first_name', 'First name'],
          ['last_name', 'Last name'],
          ['phone', 'Phone'],
          ['company', 'Company'],
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
        <input type="checkbox" checked={values.marketing_consent} onChange={(e) => set('marketing_consent', e.target.checked)} /> Agreed to marketing emails
      </label>
      <div>
        <label className="field-label" htmlFor="c-status">
          Status
        </label>
        <select id="c-status" value={values.status} onChange={(e) => set('status', e.target.value)}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      <div className="sm:col-span-2 flex flex-wrap items-center justify-end gap-2">
        <FormError error={error} />
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </form>
  );
}

export function AddNoteForm({ customerId }: { customerId: string }) {
  const [body, setBody] = useState('');
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/customers/${customerId}/notes`, successMessage: 'Note added', onSuccess: () => setBody('') });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) submit({ body });
      }}
    >
      <label className="field-label" htmlFor="new-note">
        Add a note
      </label>
      <textarea id="new-note" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
      <FormError error={error} />
      <div className="flex justify-end mt-2">
        <button type="submit" className="crm-btn crm-btn-sm" disabled={busy || !body.trim()}>
          {busy ? 'Adding…' : 'Add note'}
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
    if (!res.ok) return setError(res.data.error || 'Could not load preview');
    setPreview(res.data);
  };

  const merge = async () => {
    if (!preview) return;
    setBusy(true);
    const res = await callApi('/api/admin/customers/merge', 'POST', { primaryId, duplicateId: preview.duplicate.id, confirmation: typed });
    setBusy(false);
    if (!res.ok) return setError(res.data.error || 'Merge failed');
    setOpen(false);
    setPreview(null);
    toast('success', 'Customers merged');
    router.refresh();
  };

  return (
    <>
      <button type="button" className="crm-btn" onClick={() => setOpen(true)}>
        Merge a duplicate…
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setPreview(null);
        }}
        title="Merge a duplicate into this customer"
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="crm-btn crm-btn-danger"
              disabled={!preview || preview.blockers.length > 0 || typed.trim() !== preview.confirmationPhrase || busy}
              onClick={merge}
            >
              {busy ? 'Merging…' : 'Merge'}
            </button>
          </>
        }
      >
        {!preview ? (
          <div className="grid gap-2">
            <p className="text-zayro-gray">
              Search for the duplicate record. Its bookings, purchases, packages and notes move to <strong>{primaryEmail}</strong>; the duplicate is kept as “merged”, never deleted.
            </p>
            <label className="field-label" htmlFor="merge-q">
              Find duplicate
            </label>
            <input id="merge-q" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            <ul className="divide-y divide-zayro-border border border-zayro-border rounded-xl overflow-hidden">
              {hits.length === 0 && <li className="p-3 text-zayro-gray">No other customers match.</li>}
              {hits.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 p-2">
                  <span className="min-w-0">
                    <span className="font-medium">{h.name || '—'}</span> <span className="text-xs text-zayro-gray break-all">{h.email}</span>
                  </span>
                  <button type="button" className="crm-btn crm-btn-sm" onClick={() => loadPreview(h.id)}>
                    Preview
                  </button>
                </li>
              ))}
            </ul>
            <FormError error={error} />
          </div>
        ) : (
          <div className="grid gap-3">
            <dl className="grid grid-cols-2 gap-y-1">
              <dt className="text-zayro-gray">Keep</dt>
              <dd className="text-right break-all">{preview.primary.email}</dd>
              <dt className="text-zayro-gray">Merge away</dt>
              <dd className="text-right break-all">{preview.duplicate.email}</dd>
              <dt className="text-zayro-gray">Bookings to move</dt>
              <dd className="text-right">{preview.moves.bookings}</dd>
              <dt className="text-zayro-gray">Purchases to move</dt>
              <dd className="text-right">{preview.moves.purchases}</dd>
              <dt className="text-zayro-gray">Packages to move</dt>
              <dd className="text-right">{preview.moves.packages}</dd>
              <dt className="text-zayro-gray">Notes to move</dt>
              <dd className="text-right">{preview.moves.notes}</dd>
            </dl>
            {!preview.emailsMatch && (
              <p className="form-error-banner">
                These emails are different. Only merge if you are sure both records are the same person — this can&apos;t be undone automatically.
              </p>
            )}
            {preview.blockers.map((b) => (
              <p key={b} className="form-error-banner">
                {b}
              </p>
            ))}
            <div>
              <label className="field-label" htmlFor="merge-confirm">
                Type <span className="font-mono">{preview.confirmationPhrase}</span> to confirm
              </label>
              <input id="merge-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="font-mono" />
            </div>
            <button type="button" className="crm-link text-left" onClick={() => setPreview(null)}>
              ← Choose another record
            </button>
            <FormError error={error} />
          </div>
        )}
      </Dialog>
    </>
  );
}
