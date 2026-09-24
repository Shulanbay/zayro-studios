'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callApi, Dialog, FormError, useToast } from './client';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export function NotesEditor({ url, initial, label = 'Internal notes', field = 'internalNotes', method = 'PATCH' }: { url: string; initial: string; label?: string; field?: string; method?: 'PATCH' | 'POST' }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = value !== initial;
  const save = async () => {
    setBusy(true);
    const res = await callApi(url, method, { [field]: value });
    setBusy(false);
    if (!res.ok) return toast('error', res.data.error || 'Could not save');
    toast('success', 'Saved');
    router.refresh();
  };
  return (
    <div>
      <label className="field-label" htmlFor={`notes-${url}`}>
        {label}
      </label>
      <textarea id={`notes-${url}`} rows={4} value={value} onChange={(e) => setValue(e.target.value)} maxLength={5000} />
      <div className="flex justify-end mt-2">
        <button type="button" className="crm-btn crm-btn-sm" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save notes'}
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
    if (!res.ok) return setError(res.data.error || 'Could not cancel');
    setOpen(false);
    toast('success', res.data.needsRefundDecision ? 'Cancelled. The payment is kept — decide on a refund.' : 'Booking cancelled');
    router.refresh();
  };

  return (
    <>
      <button type="button" className="crm-btn crm-btn-danger" onClick={() => setOpen(true)}>
        Cancel booking
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Cancel ${bookingCode}?`}
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)} disabled={busy}>
              Keep booking
            </button>
            <button type="button" className="crm-btn crm-btn-danger" onClick={submit} disabled={busy || confirmCode.trim() !== bookingCode || !reason.trim()}>
              {busy ? 'Cancelling…' : 'Cancel booking'}
            </button>
          </>
        }
      >
        <ul className="list-disc pl-5 space-y-1 mb-4 text-zayro-gray">
          <li>The slot is released immediately for public booking.</li>
          <li>The Calendar event is marked CANCELLED and the sheet row updated (nothing is deleted).</li>
          {paid && (
            <li className="text-amber-800">
              <strong>No refund is issued.</strong> The booking is flagged so you can refund from the purchase.
            </li>
          )}
          {usesCredit && <li>The package credit is given back.</li>}
        </ul>
        <div className="grid gap-3">
          <div>
            <label className="field-label" htmlFor="cancel-reason">
              Reason (kept in the audit log)
            </label>
            <input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} required />
          </div>
          <div>
            <label className="field-label" htmlFor="cancel-code">
              Type the booking ID <span className="font-mono">{bookingCode}</span> to confirm
            </label>
            <input id="cancel-code" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} autoComplete="off" className="font-mono" />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the customer that it was cancelled
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
      setError(res.data.error || 'Refund failed');
      setStep('form');
      return;
    }
    setOpen(false);
    setStep('form');
    const status = res.data.refund?.status;
    toast(status === 'failed' ? 'error' : 'success', status === 'failed' ? `Stripe refused the refund: ${res.data.refund?.failure_reason ?? ''}` : `Refund ${status}: ${money(cents)}`);
    router.refresh();
  };

  return (
    <>
      <button type="button" className="crm-btn" onClick={() => { setOpen(true); setStep('form'); }} disabled={availableCents <= 0}>
        Refund…
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={step === 'form' ? 'Refund' : 'Confirm refund'}
        footer={
          step === 'form' ? (
            <>
              <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="crm-btn crm-btn-primary" disabled={!valid} onClick={() => setStep('confirm')}>
                Review refund
              </button>
            </>
          ) : (
            <>
              <button type="button" className="crm-btn" onClick={() => setStep('form')} disabled={busy}>
                Back
              </button>
              <button type="button" className="crm-btn crm-btn-danger" onClick={submit} disabled={busy}>
                {busy ? 'Refunding…' : `Refund ${money(cents)}`}
              </button>
            </>
          )
        }
      >
        <dl className="grid grid-cols-2 gap-y-1 mb-4">
          <dt className="text-zayro-gray">Order</dt>
          <dd className="text-right font-mono text-xs">{orderNumber}</dd>
          {bookingCode && (
            <>
              <dt className="text-zayro-gray">Booking</dt>
              <dd className="text-right font-mono text-xs">{bookingCode}</dd>
            </>
          )}
          <dt className="text-zayro-gray">Customer</dt>
          <dd className="text-right">{customerName}</dd>
          <dt className="text-zayro-gray">Original amount</dt>
          <dd className="text-right tabular-nums">{money(totalCents)}</dd>
          <dt className="text-zayro-gray">Already refunded</dt>
          <dd className="text-right tabular-nums">{money(refundedCents)}</dd>
          <dt className="text-zayro-gray">Refundable now</dt>
          <dd className="text-right tabular-nums font-semibold">{money(availableCents)}</dd>
        </dl>
        {step === 'form' ? (
          <div className="grid gap-3">
            <div>
              <label className="field-label" htmlFor="rf-amount">
                Refund amount (USD)
              </label>
              <input id="rf-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className="text-xs text-zayro-gray mt-1">
                <button type="button" className="crm-link" onClick={() => setAmount((availableCents / 100).toFixed(2))}>
                  Full remaining amount
                </button>
              </p>
            </div>
            <div>
              <label className="field-label" htmlFor="rf-reason">
                Reason
              </label>
              <input id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </div>
            {canCancelBooking && bookingUuid && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={cancel} onChange={(e) => setCancel(e.target.checked)} /> Also cancel the booking
              </label>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the customer about the refund
            </label>
            {!isStripe && <p className="text-xs text-amber-800">This was paid outside Stripe: the refund is only recorded — return the money yourself.</p>}
            <FormError error={error} />
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-base">
              Refund <strong>{money(cents)}</strong> {isStripe ? 'to the customer’s card via Stripe (Test mode in this environment)' : '(recorded only)'}
              {cancel ? ' and cancel the booking' : ''}.
            </p>
            <p className="text-zayro-gray">Reason: {reason}</p>
            <p className="text-zayro-gray">This can’t be undone.</p>
          </div>
        )}
      </Dialog>
    </>
  );
}
