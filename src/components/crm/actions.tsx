'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callApi, Dialog, FormError, useApiMessage, useToast } from './client';
import { useI18n } from './i18n';
import { rich } from '@/lib/i18n/rich';

export function NotesEditor({ url, initial, label, field = 'internalNotes', method = 'PATCH' }: { url: string; initial: string; label?: string; field?: string; method?: 'PATCH' | 'POST' }) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const apiMessage = useApiMessage();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = value !== initial;
  const save = async () => {
    setBusy(true);
    const res = await callApi(url, method, { [field]: value });
    setBusy(false);
    if (!res.ok) return toast('error', res.data.error ? apiMessage(res.data.error, res.status) : t('sessions.notes.saveFailed'));
    toast('success', t('sessions.notes.saved'));
    router.refresh();
  };
  return (
    <div>
      <label className="field-label" htmlFor={`notes-${url}`}>
        {label ?? t('sessions.notes.label')}
      </label>
      <textarea id={`notes-${url}`} rows={4} value={value} onChange={(e) => setValue(e.target.value)} maxLength={5000} />
      <div className="flex justify-end mt-2">
        <button type="button" className="crm-btn crm-btn-sm" disabled={!dirty || busy} onClick={save}>
          {busy ? t('sessions.notes.saving') : t('sessions.notes.save')}
        </button>
      </div>
    </div>
  );
}

export function CancelBookingDialog({
  bookingUuid,
  bookingCode,
  paid,
  usesCredit,
}: {
  bookingUuid: string;
  bookingCode: string;
  paid: boolean;
  usesCredit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const apiMessage = useApiMessage();
  const [open, setOpen] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await callApi<any>(`/api/admin/bookings/${bookingUuid}/cancel`, 'POST', { confirmBookingId: confirmCode.trim(), reason, notifyCustomer: notify });
    setBusy(false);
    if (!res.ok) return setError(res.data.error ? apiMessage(res.data.error, res.status) : t('sessions.cancel.failed'));
    setOpen(false);
    toast('success', res.data.needsRefundDecision ? t('sessions.cancel.cancelledKeepPayment') : t('sessions.cancel.cancelled'));
    router.refresh();
  };

  return (
    <>
      <button type="button" className="crm-btn crm-btn-danger" onClick={() => setOpen(true)}>
        {t('sessions.cancel.button')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('sessions.cancel.title', { code: bookingCode })}
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)} disabled={busy}>
              {t('sessions.cancel.keep')}
            </button>
            <button type="button" className="crm-btn crm-btn-danger" onClick={submit} disabled={busy || confirmCode.trim() !== bookingCode || !reason.trim()}>
              {busy ? t('sessions.cancel.cancelling') : t('sessions.cancel.button')}
            </button>
          </>
        }
      >
        <ul className="list-disc pl-5 space-y-1 mb-4 text-zayro-gray">
          <li>{t('sessions.cancel.released')}</li>
          <li>{t('sessions.cancel.calendarMarked')}</li>
          {paid && (
            <li className="text-amber-800">
              <strong>{t('sessions.cancel.noRefundStrong')}</strong> {t('sessions.cancel.noRefundRest')}
            </li>
          )}
          {usesCredit && <li>{t('sessions.cancel.creditBack')}</li>}
        </ul>
        <div className="grid gap-3">
          <div>
            <label className="field-label" htmlFor="cancel-reason">
              {t('sessions.cancel.reason')}
            </label>
            <input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} required />
          </div>
          <div>
            <label className="field-label" htmlFor="cancel-code">
              {rich(t('sessions.cancel.typeId'), { code: <span className="font-mono">{bookingCode}</span> })}
            </label>
            <input id="cancel-code" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} autoComplete="off" className="font-mono" />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> {t('sessions.cancel.notify')}
          </label>
          <FormError error={error} />
        </div>
      </Dialog>
    </>
  );
}

export function RefundDialog({
  purchaseId,
  orderNumber,
  bookingCode,
  bookingUuid,
  customerName,
  totalCents,
  refundedCents,
  availableCents,
  isStripe,
  canCancelBooking,
}: {
  purchaseId: string;
  orderNumber: string;
  bookingCode?: string | null;
  bookingUuid?: string | null;
  customerName: string;
  totalCents: number;
  refundedCents: number;
  availableCents: number;
  isStripe: boolean;
  canCancelBooking: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { t, f, label } = useI18n();
  const apiMessage = useApiMessage();
  const money = (cents: number) => f.money(cents);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [amount, setAmount] = useState((availableCents / 100).toFixed(2));
  const [reason, setReason] = useState('');
  const [cancel, setCancel] = useState(false);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cents = Math.round(parseFloat(amount || '0') * 100);
  const valid = Number.isFinite(cents) && cents > 0 && cents <= availableCents && reason.trim().length > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await callApi<any>(`/api/admin/purchases/${purchaseId}/refund`, 'POST', {
      amountCents: cents,
      reason,
      expectedAvailableCents: availableCents,
      bookingId: bookingUuid ?? null,
      cancelBooking: cancel,
      notifyCustomer: notify,
      confirmOrderNumber: orderNumber,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error ? apiMessage(res.data.error, res.status) : t('sessions.refund.failed'));
      setStep('form');
      return;
    }
    setOpen(false);
    setStep('form');
    const status = res.data.refund?.status;
    toast(
      status === 'failed' ? 'error' : 'success',
      status === 'failed' ? t('sessions.refund.stripeRefused', { reason: res.data.refund?.failure_reason ?? '' }) : t('sessions.refund.done', { status: label(status).toLowerCase(), amount: money(cents) })
    );
    router.refresh();
  };

  return (
    <>
      <button type="button" className="crm-btn" onClick={() => { setOpen(true); setStep('form'); }} disabled={availableCents <= 0}>
        {t('sessions.refund.button')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={step === 'form' ? t('sessions.refund.title') : t('sessions.refund.confirmTitle')}
        footer={
          step === 'form' ? (
            <>
              <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
                {t('common.actions.cancel')}
              </button>
              <button type="button" className="crm-btn crm-btn-primary" disabled={!valid} onClick={() => setStep('confirm')}>
                {t('sessions.refund.review')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="crm-btn" onClick={() => setStep('form')} disabled={busy}>
                {t('sessions.refund.back')}
              </button>
              <button type="button" className="crm-btn crm-btn-danger" onClick={submit} disabled={busy}>
                {busy ? t('sessions.refund.refunding') : t('sessions.refund.refundAmount', { amount: money(cents) })}
              </button>
            </>
          )
        }
      >
        <dl className="grid grid-cols-2 gap-y-1 mb-4">
          <dt className="text-zayro-gray">{t('sessions.refund.order')}</dt>
          <dd className="text-right font-mono text-xs">{orderNumber}</dd>
          {bookingCode && (
            <>
              <dt className="text-zayro-gray">{t('sessions.refund.booking')}</dt>
              <dd className="text-right font-mono text-xs">{bookingCode}</dd>
            </>
          )}
          <dt className="text-zayro-gray">{t('sessions.refund.customer')}</dt>
          <dd className="text-right">{customerName}</dd>
          <dt className="text-zayro-gray">{t('sessions.refund.original')}</dt>
          <dd className="text-right tabular-nums">{money(totalCents)}</dd>
          <dt className="text-zayro-gray">{t('sessions.refund.already')}</dt>
          <dd className="text-right tabular-nums">{money(refundedCents)}</dd>
          <dt className="text-zayro-gray">{t('sessions.refund.refundable')}</dt>
          <dd className="text-right tabular-nums font-semibold">{money(availableCents)}</dd>
        </dl>
        {step === 'form' ? (
          <div className="grid gap-3">
            <div>
              <label className="field-label" htmlFor="rf-amount">
                {t('sessions.refund.amountLabel')}
              </label>
              <input id="rf-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className="text-xs text-zayro-gray mt-1">
                <button type="button" className="crm-link" onClick={() => setAmount((availableCents / 100).toFixed(2))}>
                  {t('sessions.refund.full')}
                </button>
              </p>
            </div>
            <div>
              <label className="field-label" htmlFor="rf-reason">
                {t('sessions.refund.reason')}
              </label>
              <input id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </div>
            {canCancelBooking && bookingUuid && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={cancel} onChange={(e) => setCancel(e.target.checked)} /> {t('sessions.refund.alsoCancel')}
              </label>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> {t('sessions.refund.notify')}
            </label>
            {!isStripe && <p className="text-xs text-amber-800">{t('sessions.refund.offline')}</p>}
            <FormError error={error} />
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-base">
              {rich(t(isStripe ? 'sessions.refund.confirmStripe' : 'sessions.refund.confirmRecorded'), { amount: <strong>{money(cents)}</strong> })}
              {cancel ? t('sessions.refund.andCancel') : ''}.
            </p>
            <p className="text-zayro-gray">{t('sessions.refund.reasonLine', { reason })}</p>
            <p className="text-zayro-gray">{t('sessions.refund.irreversible')}</p>
          </div>
        )}
      </Dialog>
    </>
  );
}
