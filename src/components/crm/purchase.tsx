'use client';

import { useState } from 'react';
import { Dialog, FormError, useJsonSubmit } from './client';

export function MarkPaidButton({ purchaseId }: { purchaseId: string }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState('card_terminal');
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/purchases/${purchaseId}/mark-paid`, successMessage: 'Marked as paid', onSuccess: () => setOpen(false) });
  return (
    <>
      <button type="button" className="crm-btn" onClick={() => setOpen(true)}>
        Mark as paid…
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Record payment received"
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="crm-btn crm-btn-primary" disabled={busy} onClick={() => submit({ method })}>
              {busy ? 'Saving…' : 'Mark paid'}
            </button>
          </>
        }
      >
        <label className="field-label" htmlFor="mp-method">
          How was it paid?
        </label>
        <select id="mp-method" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="card_terminal">Card terminal</option>
          <option value="cash">Cash</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="other">Other</option>
        </select>
        <FormError error={error} />
      </Dialog>
    </>
  );
}

export function ResolveReviewButton({ purchaseId }: { purchaseId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/purchases/${purchaseId}/resolve-review`, successMessage: 'Marked as reviewed', onSuccess: () => setOpen(false) });
  return (
    <>
      <button type="button" className="crm-btn" onClick={() => setOpen(true)}>
        No refund needed…
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Close the refund review without refunding"
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="crm-btn crm-btn-primary" disabled={busy || !note.trim()} onClick={() => submit({ note })}>
              {busy ? 'Saving…' : 'Close review'}
            </button>
          </>
        }
      >
        <p className="text-zayro-gray mb-3">For example: the customer rebooked, or the cancellation policy applies. The reason is kept in the audit log.</p>
        <label className="field-label" htmlFor="rr-note">
          Reason
        </label>
        <textarea id="rr-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        <FormError error={error} />
      </Dialog>
    </>
  );
}
