'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callApi, Dialog, FormError, useJsonSubmit, useToast } from './client';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

interface PlanOption {
  id: number;
  name: string;
  priceCents: number;
  credits: number;
  validityDays: number;
  eligible: string;
}

interface CustomerHit {
  id: string;
  email: string;
  name: string;
}

export function AssignPackageForm({
  plans,
  defaultCustomer,
  canRecordPayment,
  defaultDate,
}: {
  plans: PlanOption[];
  defaultCustomer: CustomerHit | null;
  canRecordPayment: boolean;
  defaultDate: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [customer, setCustomer] = useState<CustomerHit | null>(defaultCustomer);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [planId, setPlanId] = useState(plans[0]?.id ?? 0);
  const [startDate, setStartDate] = useState(defaultDate);
  const [mode, setMode] = useState<'comp' | 'offline_paid' | 'unpaid'>('unpaid');
  const [method, setMethod] = useState('card_terminal');
  const [notes, setNotes] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = plans.find((p) => p.id === planId);

  useEffect(() => {
    if (query.trim().length < 2) return setHits([]);
    const t = setTimeout(async () => {
      const res = await callApi<{ customers: CustomerHit[] }>(`/api/admin/customers/search?q=${encodeURIComponent(query.trim())}`, 'GET');
      if (res.ok) setHits(res.data.customers);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return setError('Choose a customer');
    setBusy(true);
    setError(null);
    const res = await callApi<{ id: string }>('/api/admin/packages/assign', 'POST', {
      customerId: customer.id,
      planId,
      startDate,
      paymentMode: mode,
      ...(mode === 'offline_paid' ? { paymentMethod: method } : {}),
      notes: notes || null,
      sendEmail,
    });
    setBusy(false);
    if (!res.ok) return setError(res.data.error || 'Could not assign the package');
    toast('success', 'Package assigned');
    router.push(`/admin/packages/${res.data.id}`);
  };

  return (
    <form onSubmit={submit} className="card grid gap-4 max-w-2xl">
      <div>
        <label className="field-label" htmlFor="pk-cust">
          Customer
        </label>
        {customer ? (
          <div className="flex items-center justify-between gap-2 border border-zayro-border rounded-xl px-3 py-2">
            <span className="min-w-0">
              <span className="font-medium">{customer.name || customer.email}</span> <span className="text-xs text-zayro-gray break-all">{customer.email}</span>
            </span>
            <button type="button" className="crm-btn crm-btn-sm" onClick={() => setCustomer(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <input id="pk-cust" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" autoComplete="off" />
            {hits.length > 0 && (
              <ul className="border border-zayro-border rounded-xl mt-1 divide-y divide-zayro-border">
                {hits.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 text-sm">
                      {h.name || h.email} <span className="text-xs text-zayro-gray">{h.email}</span>
                    </span>
                    <button type="button" className="crm-btn crm-btn-sm" onClick={() => { setCustomer(h); setHits([]); setQuery(''); }}>
                      Select
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="field-label" htmlFor="pk-plan">
            Package
          </label>
          <select id="pk-plan" value={planId} onChange={(e) => setPlanId(Number(e.target.value))}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {money(p.priceCents)}
              </option>
            ))}
          </select>
          {plan && (
            <p className="text-xs text-zayro-gray mt-1">
              {plan.credits} sessions · valid {plan.validityDays} days · {plan.eligible}
            </p>
          )}
        </div>
        <div>
          <label className="field-label" htmlFor="pk-start">
            Starts on
          </label>
          <input id="pk-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
      </div>
      <fieldset className="grid gap-2 text-sm">
        <legend className="field-label">Payment</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="pk-mode" checked={mode === 'unpaid'} onChange={() => setMode('unpaid')} /> Not paid yet (mark paid later)
        </label>
        {canRecordPayment && (
          <label className="flex items-center gap-2">
            <input type="radio" name="pk-mode" checked={mode === 'offline_paid'} onChange={() => setMode('offline_paid')} /> Paid (not via Stripe)
          </label>
        )}
        {mode === 'offline_paid' && (
          <select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} className="!w-auto ml-6">
            <option value="card_terminal">Card terminal</option>
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="other">Other</option>
          </select>
        )}
        <label className="flex items-center gap-2">
          <input type="radio" name="pk-mode" checked={mode === 'comp'} onChange={() => setMode('comp')} /> Complimentary ($0)
        </label>
      </fieldset>
      <div>
        <label className="field-label" htmlFor="pk-notes">
          Notes
        </label>
        <textarea id="pk-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email the customer that their package is ready
      </label>
      <FormError error={error} />
      <div className="flex justify-end">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy || !customer || !planId}>
          {busy ? 'Assigning…' : 'Assign package'}
        </button>
      </div>
    </form>
  );
}

export function AdjustCreditsForm({ packageId, remaining }: { packageId: string; remaining: number }) {
  const [delta, setDelta] = useState('1');
  const [reason, setReason] = useState('');
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/packages/${packageId}/adjust`, successMessage: 'Credits adjusted', onSuccess: () => setReason('') });
  const n = parseInt(delta, 10);
  const invalid = !Number.isInteger(n) || n === 0 || remaining + n < 0 || !reason.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) submit({ delta: n, reason });
      }}
      className="grid gap-2"
    >
      <div className="grid grid-cols-[90px_1fr] gap-2">
        <div>
          <label className="field-label" htmlFor="adj-d">
            Change
          </label>
          <input id="adj-d" type="number" step={1} min={-remaining} max={100} value={delta} onChange={(e) => setDelta(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="adj-r">
            Reason
          </label>
          <input id="adj-r" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
      </div>
      <p className="text-xs text-zayro-gray">Balance after: {Number.isInteger(n) ? Math.max(remaining + n, 0) : remaining}. Credits can never go below zero.</p>
      <FormError error={error} />
      <div className="flex justify-end">
        <button type="submit" className="crm-btn crm-btn-sm" disabled={busy || invalid}>
          {busy ? 'Saving…' : 'Adjust credits'}
        </button>
      </div>
    </form>
  );
}

export function CancelPackageButton({ packageId }: { packageId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/packages/${packageId}/cancel`, successMessage: 'Package cancelled', onSuccess: () => setOpen(false) });
  return (
    <>
      <button type="button" className="crm-btn crm-btn-danger" onClick={() => setOpen(true)}>
        Cancel package
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Cancel this package?"
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
              Keep
            </button>
            <button type="button" className="crm-btn crm-btn-danger" disabled={busy || !reason.trim()} onClick={() => submit({ reason })}>
              {busy ? 'Cancelling…' : 'Cancel package'}
            </button>
          </>
        }
      >
        <p className="text-zayro-gray mb-3">Remaining credits are removed. Booked sessions stay booked. This does not refund — refund the purchase separately if needed.</p>
        <label className="field-label" htmlFor="cp-reason">
          Reason
        </label>
        <input id="cp-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <FormError error={error} />
      </Dialog>
    </>
  );
}

export function PlanEditor({
  plan,
  services,
}: {
  plan: { id: number; validityDays: number; active: boolean; eligible: number[] };
  services: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [validity, setValidity] = useState(String(plan.validityDays));
  const [active, setActive] = useState(plan.active);
  const [eligible, setEligible] = useState<number[]>(plan.eligible);
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/package-plans/${plan.id}`, method: 'PATCH', successMessage: 'Plan saved', onSuccess: () => setOpen(false) });
  return (
    <>
      <button type="button" className="crm-btn crm-btn-sm" onClick={() => setOpen(true)}>
        Edit
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Package plan settings"
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="crm-btn crm-btn-primary" disabled={busy} onClick={() => submit({ validity_days: parseInt(validity, 10), active, eligibleServiceIds: eligible })}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <p className="text-zayro-gray">Name, price and number of sessions come from the package in Services. Changes here only affect packages assigned from now on.</p>
          <div className="max-w-[160px]">
            <label className="field-label" htmlFor="pl-v">
              Valid for (days)
            </label>
            <input id="pl-v" type="number" min={1} max={730} value={validity} onChange={(e) => setValidity(e.target.value)} />
          </div>
          <fieldset>
            <legend className="field-label">Sessions it can be used for</legend>
            <div className="grid sm:grid-cols-2 gap-1">
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={eligible.includes(s.id)} onChange={(e) => setEligible(e.target.checked ? [...eligible, s.id] : eligible.filter((x) => x !== s.id))} />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Can be assigned
          </label>
          <FormError error={error} />
        </div>
      </Dialog>
    </>
  );
}
