'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callApi, Dialog, FormError, useApiMessage, useJsonSubmit, useToast } from './client';
import { useI18n } from './i18n';

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
  const { t, f, label } = useI18n();
  const apiMessage = useApiMessage();
  const money = (cents: number) => f.money(cents);
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
    if (!customer) return setError(t('packages.form.chooseCustomer'));
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
    if (!res.ok) return setError(res.data.error ? apiMessage(res.data.error, res.status) : t('packages.form.failed'));
    toast('success', t('packages.form.assigned'));
    router.push(`/admin/packages/${res.data.id}`);
  };

  return (
    <form onSubmit={submit} className="card grid gap-4 max-w-2xl">
      <div>
        <label className="field-label" htmlFor="pk-cust">
          {t('packages.form.customer')}
        </label>
        {customer ? (
          <div className="flex items-center justify-between gap-2 border border-zayro-border rounded-xl px-3 py-2">
            <span className="min-w-0">
              <span className="font-medium">{customer.name || customer.email}</span> <span className="text-xs text-zayro-gray break-all">{customer.email}</span>
            </span>
            <button type="button" className="crm-btn crm-btn-sm" onClick={() => setCustomer(null)}>
              {t('packages.form.change')}
            </button>
          </div>
        ) : (
          <>
            <input id="pk-cust" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('packages.form.searchPlaceholder')} autoComplete="off" />
            {hits.length > 0 && (
              <ul className="border border-zayro-border rounded-xl mt-1 divide-y divide-zayro-border">
                {hits.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 text-sm">
                      {h.name || h.email} <span className="text-xs text-zayro-gray">{h.email}</span>
                    </span>
                    <button type="button" className="crm-btn crm-btn-sm" onClick={() => { setCustomer(h); setHits([]); setQuery(''); }}>
                      {t('packages.form.select')}
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
            {t('packages.form.package')}
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
              {t('packages.form.planSummary', { credits: plan.credits, days: plan.validityDays, eligible: plan.eligible })}
            </p>
          )}
        </div>
        <div>
          <label className="field-label" htmlFor="pk-start">
            {t('packages.form.startsOn')}
          </label>
          <input id="pk-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
      </div>
      <fieldset className="grid gap-2 text-sm">
        <legend className="field-label">{t('packages.form.payment')}</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="pk-mode" checked={mode === 'unpaid'} onChange={() => setMode('unpaid')} /> {t('packages.form.unpaid')}
        </label>
        {canRecordPayment && (
          <label className="flex items-center gap-2">
            <input type="radio" name="pk-mode" checked={mode === 'offline_paid'} onChange={() => setMode('offline_paid')} /> {t('packages.form.paid')}
          </label>
        )}
        {mode === 'offline_paid' && (
          <select aria-label={t('packages.form.paymentMethod')} value={method} onChange={(e) => setMethod(e.target.value)} className="!w-auto ml-6 max-w-full">
            {['card_terminal', 'cash', 'bank_transfer', 'other'].map((m) => (
              <option key={m} value={m}>
                {label(m)}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2">
          <input type="radio" name="pk-mode" checked={mode === 'comp'} onChange={() => setMode('comp')} /> {t('packages.form.comp', { zero: money(0) })}
        </label>
      </fieldset>
      <div>
        <label className="field-label" htmlFor="pk-notes">
          {t('packages.form.notes')}
        </label>
        <textarea id="pk-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> {t('packages.form.sendEmail')}
      </label>
      <FormError error={error} />
      <div className="flex justify-end">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy || !customer || !planId}>
          {busy ? t('packages.form.assigning') : t('packages.form.assign')}
        </button>
      </div>
    </form>
  );
}

export function AdjustCreditsForm({ packageId, remaining }: { packageId: string; remaining: number }) {
  const { t, f } = useI18n();
  const [delta, setDelta] = useState('1');
  const [reason, setReason] = useState('');
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/packages/${packageId}/adjust`, successMessage: t('packages.adjust.done'), onSuccess: () => setReason('') });
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
            {t('packages.adjust.change')}
          </label>
          <input id="adj-d" type="number" step={1} min={-remaining} max={100} value={delta} onChange={(e) => setDelta(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="adj-r">
            {t('packages.adjust.reason')}
          </label>
          <input id="adj-r" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
      </div>
      <p className="text-xs text-zayro-gray">{t('packages.adjust.balanceAfter', { balance: f.number(Number.isInteger(n) ? Math.max(remaining + n, 0) : remaining) })}</p>
      <FormError error={error} />
      <div className="flex justify-end">
        <button type="submit" className="crm-btn crm-btn-sm" disabled={busy || invalid}>
          {busy ? t('packages.adjust.saving') : t('packages.adjust.submit')}
        </button>
      </div>
    </form>
  );
}

export function CancelPackageButton({ packageId }: { packageId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/packages/${packageId}/cancel`, successMessage: t('packages.cancel.done'), onSuccess: () => setOpen(false) });
  return (
    <>
      <button type="button" className="crm-btn crm-btn-danger" onClick={() => setOpen(true)}>
        {t('packages.cancel.button')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('packages.cancel.title')}
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
              {t('packages.cancel.keep')}
            </button>
            <button type="button" className="crm-btn crm-btn-danger" disabled={busy || !reason.trim()} onClick={() => submit({ reason })}>
              {busy ? t('packages.cancel.cancelling') : t('packages.cancel.button')}
            </button>
          </>
        }
      >
        <p className="text-zayro-gray mb-3">{t('packages.cancel.body')}</p>
        <label className="field-label" htmlFor="cp-reason">
          {t('packages.cancel.reason')}
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [validity, setValidity] = useState(String(plan.validityDays));
  const [active, setActive] = useState(plan.active);
  const [eligible, setEligible] = useState<number[]>(plan.eligible);
  const { submit, busy, error } = useJsonSubmit({ url: `/api/admin/package-plans/${plan.id}`, method: 'PATCH', successMessage: t('packages.plan.saved'), onSuccess: () => setOpen(false) });
  return (
    <>
      <button type="button" className="crm-btn crm-btn-sm" onClick={() => setOpen(true)}>
        {t('common.actions.edit')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('packages.plan.title')}
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </button>
            <button type="button" className="crm-btn crm-btn-primary" disabled={busy} onClick={() => submit({ validity_days: parseInt(validity, 10), active, eligibleServiceIds: eligible })}>
              {busy ? t('packages.plan.saving') : t('common.actions.save')}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <p className="text-zayro-gray">{t('packages.plan.intro')}</p>
          <div className="max-w-[160px]">
            <label className="field-label" htmlFor="pl-v">
              {t('packages.plan.validity')}
            </label>
            <input id="pl-v" type="number" min={1} max={730} value={validity} onChange={(e) => setValidity(e.target.value)} />
          </div>
          <fieldset>
            <legend className="field-label">{t('packages.plan.usableFor')}</legend>
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
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {t('packages.plan.assignable')}
          </label>
          <FormError error={error} />
        </div>
      </Dialog>
    </>
  );
}
