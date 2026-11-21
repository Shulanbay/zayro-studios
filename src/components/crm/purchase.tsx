'use client';

import { useState } from 'react';
import { Dialog, FormError, useJsonSubmit } from './client';
import { useI18n } from './i18n';

export function MarkPaidButton({ purchaseId }: { purchaseId: string }) {
  const { t, label } = useI18n();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState('card_terminal');
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/purchases/${purchaseId}/mark-paid`, successMessage: t('purchases.markPaid.done'), onSuccess: () => setOpen(false) });
  return (
    <>
      <button type="button" className="crm-btn" onClick={() => setOpen(true)}>
        {t('purchases.markPaid.button')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('purchases.markPaid.title')}
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </button>
            <button type="button" className="crm-btn crm-btn-primary" disabled={busy} onClick={() => submit({ method })}>
              {busy ? t('purchases.markPaid.saving') : t('purchases.markPaid.submit')}
            </button>
          </>
        }
      >
        <label className="field-label" htmlFor="mp-method">
          {t('purchases.markPaid.how')}
        </label>
        <select id="mp-method" value={method} onChange={(e) => setMethod(e.target.value)}>
          {['card_terminal', 'cash', 'bank_transfer', 'other'].map((m) => (
            <option key={m} value={m}>
              {label(m)}
            </option>
          ))}
        </select>
        <FormError error={error} />
      </Dialog>
    </>
  );
}

export function ResolveReviewButton({ purchaseId }: { purchaseId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/purchases/${purchaseId}/resolve-review`, successMessage: t('purchases.review.done'), onSuccess: () => setOpen(false) });
  return (
    <>
      <button type="button" className="crm-btn" onClick={() => setOpen(true)}>
        {t('purchases.review.button')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('purchases.review.title')}
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </button>
            <button type="button" className="crm-btn crm-btn-primary" disabled={busy || !note.trim()} onClick={() => submit({ note })}>
              {busy ? t('purchases.review.saving') : t('purchases.review.submit')}
            </button>
          </>
        }
      >
        <p className="text-zayro-gray mb-3">{t('purchases.review.intro')}</p>
        <label className="field-label" htmlFor="rr-note">
          {t('purchases.review.reason')}
        </label>
        <textarea id="rr-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        <FormError error={error} />
      </Dialog>
    </>
  );
}
