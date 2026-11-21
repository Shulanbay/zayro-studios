'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callApi, Dialog, FormError, useApiMessage, useToast } from './client';
import { useI18n } from './i18n';

export interface ServiceOption {
  id: number;
  name: string;
  category: string;
  duration: number;
  priceCents: number;
  minHours?: number;
  maxHours?: number;
}

interface Slot {
  start: string;
  end: string;
  available: boolean;
}


/** Loads the day's grid for a service and lets staff pick a start time. */
export function SlotPicker({
  date,
  serviceId,
  value,
  onChange,
  excludeBookingId,
  hours,
}: {
  date: string;
  serviceId: number | null;
  /** Hours for hourly services (the grid then shows slots of that length). */
  hours?: number;
  value: string;
  onChange: (start: string) => void;
  excludeBookingId?: string;
}) {
  const { t, f, label } = useI18n();
  const apiMessage = useApiMessage();
  const [state, setState] = useState<{ loading: boolean; slots: Slot[]; closed: string | null; error: string | null }>({
    loading: false,
    slots: [],
    closed: null,
    error: null,
  });

  useEffect(() => {
    if (!date || !serviceId) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    const q = new URLSearchParams({ date, serviceId: String(serviceId), ...(hours && hours > 1 ? { hours: String(hours) } : {}) });
    if (excludeBookingId) q.set('excludeBookingId', excludeBookingId);
    callApi<{ slots: Slot[]; closedReason: string | null; open: unknown }>(`/api/admin/slots?${q}`, 'GET').then((res) => {
      if (cancelled) return;
      if (!res.ok) setState({ loading: false, slots: [], closed: null, error: res.data.error ? apiMessage(res.data.error, res.status) : t('sessions.slots.loadFailed') });
      else setState({ loading: false, slots: res.data.slots, closed: res.data.open ? null : res.data.closedReason || t('sessions.slots.closedDefault'), error: null });
    });
    return () => {
      cancelled = true;
    };
    // apiMessage/t change only with the language; the request depends on the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, serviceId, excludeBookingId, hours]);

  if (!date || !serviceId) return <p className="text-sm text-zayro-gray">{t('sessions.slots.chooseFirst')}</p>;
  if (state.loading)
    return (
      <p className="text-sm text-zayro-gray" aria-live="polite">
        {t('sessions.slots.loading')}
      </p>
    );
  if (state.error) return <p className="field-error">{state.error}</p>;
  if (state.closed) return <p className="text-sm text-amber-800">{t('sessions.slots.closed', { reason: label(state.closed) })}</p>;
  const free = state.slots.filter((s) => s.available).length;
  return (
    <div>
      <p className="text-xs text-zayro-gray mb-2" aria-live="polite">
        {t('sessions.slots.free', { free, total: state.slots.length })}
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-1.5" role="radiogroup" aria-label={t('sessions.slots.startTime')}>
        {state.slots.map((s) => (
          <button
            key={s.start}
            type="button"
            role="radio"
            aria-checked={value === s.start}
            disabled={!s.available}
            onClick={() => onChange(s.start)}
            className={`crm-btn crm-btn-sm !px-1 ${value === s.start ? '!bg-zayro-primary !text-white !border-zayro-primary' : ''} ${s.available ? '' : 'line-through'}`}
          >
            {f.time(s.start)}
          </button>
        ))}
      </div>
    </div>
  );
}

interface CustomerHit {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  company: string | null;
}

export function ManualBookingForm({
  services,
  defaultDate,
  defaultTime,
  defaultCustomer,
  canRecordPayment,
  canUsePackages,
}: {
  services: ServiceOption[];
  defaultDate: string;
  defaultTime?: string;
  defaultCustomer?: CustomerHit | null;
  canRecordPayment: boolean;
  canUsePackages: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { t, f, label } = useI18n();
  const apiMessage = useApiMessage();
  const money = (cents: number) => f.money(cents);
  const [serviceId, setServiceId] = useState<number | null>(services[0]?.id ?? null);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime ?? '');
  const [override, setOverride] = useState(false);
  const [hours, setHours] = useState<number>(services[0]?.minHours ?? 1);
  const [customer, setCustomer] = useState<CustomerHit | null>(defaultCustomer ?? null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [newCustomer, setNewCustomer] = useState({ email: '', firstName: '', lastName: '', phone: '', company: '' });
  const [mode, setMode] = useState<'unpaid' | 'comp' | 'offline_paid' | 'package'>('unpaid');
  const [method, setMethod] = useState<'cash' | 'card_terminal' | 'bank_transfer' | 'other'>('card_terminal');
  const [packages, setPackages] = useState<{ id: string; name: string; remaining: number; expiresAt: string }[]>([]);
  const [packageId, setPackageId] = useState('');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [sendConfirmation, setSendConfirmation] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const service = useMemo(() => services.find((s) => s.id === serviceId) ?? null, [services, serviceId]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await callApi<{ customers: CustomerHit[] }>(`/api/admin/customers/search?q=${encodeURIComponent(query.trim())}`, 'GET');
      if (res.ok) setHits(res.data.customers);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!customer || !canUsePackages || !serviceId) {
      setPackages([]);
      return;
    }
    callApi<{ packages: typeof packages }>(`/api/admin/customers/search?customerId=${customer.id}&serviceId=${serviceId}`, 'GET').then((res) => {
      if (res.ok) setPackages(res.data.packages);
    });
  }, [customer, serviceId, canUsePackages]);

  useEffect(() => {
    if (mode === 'package' && !packages.some((p) => p.id === packageId)) setPackageId(packages[0]?.id ?? '');
  }, [mode, packages, packageId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!service) return setError(t('sessions.form.chooseService'));
    if (!date || !time) return setError(t('sessions.form.chooseDateTime'));
    if (!customer && !newCustomer.email) return setError(t('sessions.form.chooseCustomer'));
    setBusy(true);
    const res = await callApi<{ id: string; bookingId: string; effects: Record<string, string> }>('/api/admin/bookings', 'POST', {
      serviceId: service.id,
      date,
      startTime: time,
      ...(customer
        ? { customerId: customer.id }
        : {
            email: newCustomer.email,
            firstName: newCustomer.firstName || null,
            lastName: newCustomer.lastName || null,
            phone: newCustomer.phone || null,
            company: newCustomer.company || null,
          }),
      notes: notes || null,
      internalNotes: internalNotes || null,
      paymentMode: mode,
      ...(mode === 'offline_paid' ? { paymentMethod: method } : {}),
      ...(mode === 'package' ? { customerPackageId: packageId || null } : {}),
      overrideHours: override,
      sendConfirmation,
      ...(mode !== 'package' && (service.maxHours ?? 1) > 1 ? { hours } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error ? apiMessage(res.data.error, res.status) : t('sessions.form.createFailed'));
      return;
    }
    toast('success', t('sessions.form.created', { id: res.data.bookingId }));
    router.push(`/admin/sessions/${res.data.id}`);
  };

  const grouped = useMemo(() => {
    const g = new Map<string, ServiceOption[]>();
    for (const s of services) g.set(s.category, [...(g.get(s.category) ?? []), s]);
    return Array.from(g.entries());
  }, [services]);

  return (
    <form onSubmit={submit} className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 items-start">
      <div className="grid gap-4 min-w-0">
        <section className="card">
          <h2 className="text-base font-semibold mb-3">{t('sessions.form.step1')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="field-label" htmlFor="svc">
                {t('sessions.form.service')}
              </label>
              <select
                id="svc"
                value={serviceId ?? ''}
                onChange={(e) => {
                  const next = services.find((s) => s.id === Number(e.target.value));
                  setServiceId(Number(e.target.value));
                  setHours(next?.minHours ?? 1);
                  setTime('');
                }}
              >
                {grouped.map(([cat, list]) => (
                  <optgroup key={cat} label={label(cat)}>
                    {list.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {(s.maxHours ?? 1) > 1 ? t('sessions.form.perHour', { price: money(s.priceCents) }) : t('sessions.form.minutesPrice', { minutes: s.duration, price: money(s.priceCents) })}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="date">
                {t('sessions.form.date')}
              </label>
              <input id="date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} required />
            </div>
          </div>
          {override ? (
            <div className="max-w-[200px]">
              <label className="field-label" htmlFor="time">
                {t('sessions.form.startTimeEt')}
              </label>
              <input id="time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>
          ) : (
            <SlotPicker date={date} serviceId={serviceId} value={time} onChange={setTime} hours={mode === 'package' ? 1 : hours} />
          )}
          {service && (service.maxHours ?? 1) > 1 && mode !== 'package' && (
            <div className="max-w-[260px] mt-3">
              <label className="field-label" htmlFor="hours">
                {t('sessions.form.length')}
              </label>
              <select id="hours" value={hours} onChange={(e) => { setHours(Number(e.target.value)); setTime(''); }}>
                {Array.from({ length: (service.maxHours ?? 1) - (service.minHours ?? 1) + 1 }, (_, i) => i + (service.minHours ?? 1)).map((h) => (
                  <option key={h} value={h}>
                    {t('sessions.form.hoursOption', { count: h, price: money(service.priceCents * h) })}
                  </option>
                ))}
              </select>
              {(service.minHours ?? 1) > 1 && <p className="text-xs text-zayro-gray mt-1">{t('sessions.form.minimum', { count: service.minHours })}</p>}
            </div>
          )}
          <label className="flex items-center gap-2 mt-3 text-sm">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            {t('sessions.form.allowOutside')}
          </label>
        </section>

        <section className="card">
          <h2 className="text-base font-semibold mb-3">{t('sessions.form.step2')}</h2>
          {customer ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border border-zayro-border rounded-xl px-3 py-2">
              <div className="min-w-0">
                <p className="font-medium">{customer.name || customer.email}</p>
                <p className="text-xs text-zayro-gray break-all">
                  {customer.email}
                  {customer.phone ? ` · ${customer.phone}` : ''}
                </p>
              </div>
              <button type="button" className="crm-btn crm-btn-sm" onClick={() => setCustomer(null)}>
                {t('sessions.form.change')}
              </button>
            </div>
          ) : (
            <>
              <label className="field-label" htmlFor="cust-q">
                {t('sessions.form.findCustomer')}
              </label>
              <input id="cust-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('sessions.form.findPlaceholder')} autoComplete="off" />
              {hits.length > 0 && (
                <ul className="border border-zayro-border rounded-xl mt-1 divide-y divide-zayro-border overflow-hidden" role="listbox" aria-label={t('sessions.form.matching')}>
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button type="button" role="option" aria-selected={false} className="w-full text-left px-3 py-2 hover:bg-zayro-bg !rounded-none !justify-start !font-normal !p-2 bg-white text-zayro-dark" onClick={() => { setCustomer(h); setQuery(''); setHits([]); }}>
                        <span className="font-medium">{h.name || h.email}</span> <span className="text-xs text-zayro-gray">{h.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-zayro-gray my-3">{t('sessions.form.orNew')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="field-label" htmlFor="nc-email">
                    {t('sessions.form.email')}
                  </label>
                  <input id="nc-email" type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="nc-first">
                    {t('sessions.form.firstName')}
                  </label>
                  <input id="nc-first" value={newCustomer.firstName} onChange={(e) => setNewCustomer({ ...newCustomer, firstName: e.target.value })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="nc-last">
                    {t('sessions.form.lastName')}
                  </label>
                  <input id="nc-last" value={newCustomer.lastName} onChange={(e) => setNewCustomer({ ...newCustomer, lastName: e.target.value })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="nc-phone">
                    {t('sessions.form.phone')}
                  </label>
                  <input id="nc-phone" type="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="nc-company">
                    {t('sessions.form.company')}
                  </label>
                  <input id="nc-company" value={newCustomer.company} onChange={(e) => setNewCustomer({ ...newCustomer, company: e.target.value })} />
                </div>
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2 className="text-base font-semibold mb-3">{t('sessions.form.step3')}</h2>
          <div className="grid gap-3">
            <div>
              <label className="field-label" htmlFor="notes">
                {t('sessions.form.customerNotes')}
              </label>
              <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </div>
            <div>
              <label className="field-label" htmlFor="inotes">
                {t('sessions.form.internalNotes')}
              </label>
              <textarea id="inotes" rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} maxLength={5000} />
            </div>
          </div>
        </section>
      </div>

      <aside className="card xl:sticky xl:top-6">
        <h2 className="text-base font-semibold mb-3">{t('sessions.form.step4')}</h2>
        <fieldset className="grid gap-2 text-sm">
          <legend className="sr-only">{t('sessions.form.payment')}</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" checked={mode === 'unpaid'} onChange={() => setMode('unpaid')} className="mt-1" />
            <span>
              {t('sessions.form.payAtStudio')} <span className="block text-xs text-zayro-gray">{t('sessions.form.payAtStudioHint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" checked={mode === 'comp'} onChange={() => setMode('comp')} className="mt-1" />
            <span>
              {t('sessions.form.comp')} <span className="block text-xs text-zayro-gray">{t('sessions.form.compHint', { zero: money(0) })}</span>
            </span>
          </label>
          {canRecordPayment && (
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={mode === 'offline_paid'} onChange={() => setMode('offline_paid')} className="mt-1" />
              <span>{t('sessions.form.alreadyPaid')}</span>
            </label>
          )}
          {mode === 'offline_paid' && (
            <select aria-label={t('sessions.form.paymentMethod')} value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className="ml-6 !w-auto max-w-full">
              {(['card_terminal', 'cash', 'bank_transfer', 'other'] as const).map((m) => (
                <option key={m} value={m}>
                  {label(m)}
                </option>
              ))}
            </select>
          )}
          {canUsePackages && (
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={mode === 'package'} onChange={() => setMode('package')} disabled={!customer} className="mt-1" />
              <span>
                {t('sessions.form.usePackage')}
                <span className="block text-xs text-zayro-gray">{customer ? t('sessions.form.usablePackages', { count: packages.length }) : t('sessions.form.chooseCustomerFirst')}</span>
              </span>
            </label>
          )}
          {mode === 'package' && packages.length > 0 && (
            <select aria-label={t('sessions.form.package')} value={packageId} onChange={(e) => setPackageId(e.target.value)} className="ml-6 !w-auto max-w-full">
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {t('sessions.form.packageOption', { name: p.name, count: p.remaining, date: f.instantDate(p.expiresAt) })}
                </option>
              ))}
            </select>
          )}
        </fieldset>

        {service && (
          <dl className="text-sm border-t border-zayro-border mt-4 pt-3 grid grid-cols-2 gap-y-1">
            <dt className="text-zayro-gray">{t('sessions.form.summaryService')}</dt>
            <dd className="text-right">{service.name}</dd>
            <dt className="text-zayro-gray">{t('sessions.form.listPrice')}</dt>
            <dd className="text-right tabular-nums">{t('sessions.form.listPriceValue', { price: money(service.priceCents) })}</dd>
            <dt className="text-zayro-gray">{t('sessions.form.when')}</dt>
            <dd className="text-right">{date && time ? t('sessions.form.whenValue', { date: f.dateMedium(date), time: f.time(time) }) : '—'}</dd>
          </dl>
        )}

        <label className="flex items-center gap-2 mt-4 text-sm">
          <input type="checkbox" checked={sendConfirmation} onChange={(e) => setSendConfirmation(e.target.checked)} />
          {t('sessions.form.sendConfirmation')}
        </label>

        <div className="mt-4 grid gap-2">
          <FormError error={error} />
          <button type="submit" className="crm-btn crm-btn-primary w-full !py-2.5" disabled={busy}>
            {busy ? t('sessions.form.creating') : t('sessions.form.create')}
          </button>
        </div>
      </aside>
    </form>
  );
}

/** Reschedule / change service dialog on the session detail page. */
export function RescheduleButton({
  bookingId,
  services,
  current,
}: {
  bookingId: string;
  services: ServiceOption[];
  current: { date: string; start: string; serviceId: number };
}) {
  const router = useRouter();
  const toast = useToast();
  const { t } = useI18n();
  const apiMessage = useApiMessage();
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState(current.serviceId);
  const [date, setDate] = useState(current.date);
  const [time, setTime] = useState('');
  const [override, setOverride] = useState(false);
  const [notify, setNotify] = useState(true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!time) return setError(t('sessions.reschedule.chooseTime'));
    setBusy(true);
    setError(null);
    const res = await callApi<{ effects: Record<string, string> }>(`/api/admin/bookings/${bookingId}/reschedule`, 'POST', {
      date,
      startTime: time,
      serviceId: serviceId !== current.serviceId ? serviceId : undefined,
      overrideHours: override,
      notifyCustomer: notify,
      reason: reason || null,
    });
    setBusy(false);
    if (!res.ok) return setError(res.data.error ? apiMessage(res.data.error, res.status) : t('sessions.reschedule.failed'));
    setOpen(false);
    toast('success', `${t('sessions.reschedule.done')} ${res.data.effects?.calendar ? apiMessage(res.data.effects.calendar) : ''}`.trim());
    router.refresh();
  };

  const changed = serviceId !== current.serviceId;
  return (
    <>
      <button type="button" className="crm-btn" onClick={() => setOpen(true)}>
        {t('sessions.reschedule.button')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('sessions.reschedule.title')}
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)} disabled={busy}>
              {t('common.actions.cancel')}
            </button>
            <button type="button" className="crm-btn crm-btn-primary" onClick={submit} disabled={busy || !time}>
              {busy ? t('sessions.reschedule.saving') : t('sessions.reschedule.move')}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="rs-svc">
                {t('sessions.reschedule.service')}
              </label>
              <select id="rs-svc" value={serviceId} onChange={(e) => { setServiceId(Number(e.target.value)); setTime(''); }}>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t('sessions.reschedule.serviceOption', { name: s.name, minutes: s.duration })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="rs-date">
                {t('sessions.reschedule.newDate')}
              </label>
              <input id="rs-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
            </div>
          </div>
          {changed && <p className="text-xs text-amber-800">{t('sessions.reschedule.serviceChangeNote')}</p>}
          {override ? (
            <div className="max-w-[200px]">
              <label className="field-label" htmlFor="rs-time">
                {t('sessions.reschedule.startTimeEt')}
              </label>
              <input id="rs-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          ) : (
            <SlotPicker date={date} serviceId={serviceId} value={time} onChange={setTime} excludeBookingId={bookingId} />
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> {t('sessions.reschedule.allowOutside')}
          </label>
          <div>
            <label className="field-label" htmlFor="rs-reason">
              {t('sessions.reschedule.reason')}
            </label>
            <input id="rs-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> {t('sessions.reschedule.notify')}
          </label>
          <FormError error={error} />
        </div>
      </Dialog>
    </>
  );
}
