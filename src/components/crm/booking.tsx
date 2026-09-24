'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { callApi, Dialog, FormError, useToast } from './client';

export interface ServiceOption {
  id: number;
  name: string;
  category: string;
  duration: number;
  priceCents: number;
}

interface Slot {
  start: string;
  end: string;
  available: boolean;
}

function label12(time: string) {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

/** Loads the day's grid for a service and lets staff pick a start time. */
export function SlotPicker({
  date,
  serviceId,
  value,
  onChange,
  excludeBookingId,
}: {
  date: string;
  serviceId: number | null;
  value: string;
  onChange: (start: string) => void;
  excludeBookingId?: string;
}) {
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
    const q = new URLSearchParams({ date, serviceId: String(serviceId) });
    if (excludeBookingId) q.set('excludeBookingId', excludeBookingId);
    callApi<{ slots: Slot[]; closedReason: string | null; open: unknown }>(`/api/admin/slots?${q}`, 'GET').then((res) => {
      if (cancelled) return;
      if (!res.ok) setState({ loading: false, slots: [], closed: null, error: res.data.error || 'Could not load times' });
      else setState({ loading: false, slots: res.data.slots, closed: res.data.open ? null : res.data.closedReason || 'Closed', error: null });
    });
    return () => {
      cancelled = true;
    };
  }, [date, serviceId, excludeBookingId]);

  if (!date || !serviceId) return <p className="text-sm text-zayro-gray">Choose a service and a date to see open times.</p>;
  if (state.loading) return <p className="text-sm text-zayro-gray" aria-live="polite">Loading times…</p>;
  if (state.error) return <p className="field-error">{state.error}</p>;
  if (state.closed) return <p className="text-sm text-amber-800">Studio closed: {state.closed}. Use “allow outside hours” to book anyway.</p>;
  const free = state.slots.filter((s) => s.available).length;
  return (
    <div>
      <p className="text-xs text-zayro-gray mb-2" aria-live="polite">
        {free} of {state.slots.length} start times free (ET). Crossed-out times overlap a booking, hold, buffer or blocked time.
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-1.5" role="radiogroup" aria-label="Start time">
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
            {label12(s.start)}
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
  const [serviceId, setServiceId] = useState<number | null>(services[0]?.id ?? null);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime ?? '');
  const [override, setOverride] = useState(false);
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
    if (!service) return setError('Choose a service');
    if (!date || !time) return setError('Choose a date and a start time');
    if (!customer && !newCustomer.email) return setError('Choose a customer or enter a new customer’s email');
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
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error || 'Could not create the booking');
      return;
    }
    toast('success', `Booking ${res.data.bookingId} created`);
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
          <h2 className="text-base font-semibold mb-3">1. Service and time</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="field-label" htmlFor="svc">
                Service
              </label>
              <select id="svc" value={serviceId ?? ''} onChange={(e) => { setServiceId(Number(e.target.value)); setTime(''); }}>
                {grouped.map(([cat, list]) => (
                  <optgroup key={cat} label={cat[0].toUpperCase() + cat.slice(1)}>
                    {list.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.duration} min · {money(s.priceCents)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="date">
                Date
              </label>
              <input id="date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} required />
            </div>
          </div>
          {override ? (
            <div className="max-w-[200px]">
              <label className="field-label" htmlFor="time">
                Start time (ET)
              </label>
              <input id="time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>
          ) : (
            <SlotPicker date={date} serviceId={serviceId} value={time} onChange={setTime} />
          )}
          <label className="flex items-center gap-2 mt-3 text-sm">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Allow outside opening hours / off the grid (still never on top of another booking)
          </label>
        </section>

        <section className="card">
          <h2 className="text-base font-semibold mb-3">2. Customer</h2>
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
                Change
              </button>
            </div>
          ) : (
            <>
              <label className="field-label" htmlFor="cust-q">
                Find an existing customer
              </label>
              <input id="cust-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, email or phone" autoComplete="off" />
              {hits.length > 0 && (
                <ul className="border border-zayro-border rounded-xl mt-1 divide-y divide-zayro-border overflow-hidden" role="listbox" aria-label="Matching customers">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button type="button" role="option" aria-selected={false} className="w-full text-left px-3 py-2 hover:bg-zayro-bg !rounded-none !justify-start !font-normal !p-2 bg-white text-zayro-dark" onClick={() => { setCustomer(h); setQuery(''); setHits([]); }}>
                        <span className="font-medium">{h.name || h.email}</span> <span className="text-xs text-zayro-gray">{h.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-zayro-gray my-3">…or enter a new customer (an existing email is matched automatically, case-insensitively):</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="field-label" htmlFor="nc-email">
                    Email
                  </label>
                  <input id="nc-email" type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="nc-first">
                    First name
                  </label>
                  <input id="nc-first" value={newCustomer.firstName} onChange={(e) => setNewCustomer({ ...newCustomer, firstName: e.target.value })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="nc-last">
                    Last name
                  </label>
                  <input id="nc-last" value={newCustomer.lastName} onChange={(e) => setNewCustomer({ ...newCustomer, lastName: e.target.value })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="nc-phone">
                    Phone
                  </label>
                  <input id="nc-phone" type="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="nc-company">
                    Company
                  </label>
                  <input id="nc-company" value={newCustomer.company} onChange={(e) => setNewCustomer({ ...newCustomer, company: e.target.value })} />
                </div>
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2 className="text-base font-semibold mb-3">3. Notes</h2>
          <div className="grid gap-3">
            <div>
              <label className="field-label" htmlFor="notes">
                Customer notes (appear in Calendar and emails)
              </label>
              <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </div>
            <div>
              <label className="field-label" htmlFor="inotes">
                Internal notes (staff only)
              </label>
              <textarea id="inotes" rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} maxLength={5000} />
            </div>
          </div>
        </section>
      </div>

      <aside className="card xl:sticky xl:top-6">
        <h2 className="text-base font-semibold mb-3">4. Payment</h2>
        <fieldset className="grid gap-2 text-sm">
          <legend className="sr-only">Payment</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" checked={mode === 'unpaid'} onChange={() => setMode('unpaid')} className="mt-1" />
            <span>
              Pay at the studio <span className="block text-xs text-zayro-gray">Booking is confirmed; the purchase stays unpaid until marked paid.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" checked={mode === 'comp'} onChange={() => setMode('comp')} className="mt-1" />
            <span>
              Complimentary <span className="block text-xs text-zayro-gray">$0; the list price is kept in the record.</span>
            </span>
          </label>
          {canRecordPayment && (
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={mode === 'offline_paid'} onChange={() => setMode('offline_paid')} className="mt-1" />
              <span>Already paid (not via Stripe)</span>
            </label>
          )}
          {mode === 'offline_paid' && (
            <select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className="ml-6 !w-auto">
              <option value="card_terminal">Card terminal</option>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="other">Other</option>
            </select>
          )}
          {canUsePackages && (
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={mode === 'package'} onChange={() => setMode('package')} disabled={!customer} className="mt-1" />
              <span>
                Use a package credit
                <span className="block text-xs text-zayro-gray">{customer ? `${packages.length} usable package${packages.length === 1 ? '' : 's'}` : 'Choose an existing customer first'}</span>
              </span>
            </label>
          )}
          {mode === 'package' && packages.length > 0 && (
            <select aria-label="Package" value={packageId} onChange={(e) => setPackageId(e.target.value)} className="ml-6 !w-auto">
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.remaining} left, until {new Date(p.expiresAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
                </option>
              ))}
            </select>
          )}
        </fieldset>

        {service && (
          <dl className="text-sm border-t border-zayro-border mt-4 pt-3 grid grid-cols-2 gap-y-1">
            <dt className="text-zayro-gray">Service</dt>
            <dd className="text-right">{service.name}</dd>
            <dt className="text-zayro-gray">List price</dt>
            <dd className="text-right tabular-nums">{money(service.priceCents)} + tax</dd>
            <dt className="text-zayro-gray">When</dt>
            <dd className="text-right">{date && time ? `${date} · ${label12(time)} ET` : '—'}</dd>
          </dl>
        )}

        <label className="flex items-center gap-2 mt-4 text-sm">
          <input type="checkbox" checked={sendConfirmation} onChange={(e) => setSendConfirmation(e.target.checked)} />
          Email the customer a confirmation
        </label>

        <div className="mt-4 grid gap-2">
          <FormError error={error} />
          <button type="submit" className="crm-btn crm-btn-primary w-full !py-2.5" disabled={busy}>
            {busy ? 'Creating…' : 'Create booking'}
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
    if (!time) return setError('Choose a start time');
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
    if (!res.ok) return setError(res.data.error || 'Could not reschedule');
    setOpen(false);
    toast('success', `Rescheduled. ${res.data.effects?.calendar ?? ''}`);
    router.refresh();
  };

  const changed = serviceId !== current.serviceId;
  return (
    <>
      <button type="button" className="crm-btn" onClick={() => setOpen(true)}>
        Reschedule / change service
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Reschedule session"
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="crm-btn crm-btn-primary" onClick={submit} disabled={busy || !time}>
              {busy ? 'Saving…' : 'Move session'}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="rs-svc">
                Service
              </label>
              <select id="rs-svc" value={serviceId} onChange={(e) => { setServiceId(Number(e.target.value)); setTime(''); }}>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.duration} min)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="rs-date">
                New date
              </label>
              <input id="rs-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
            </div>
          </div>
          {changed && <p className="text-xs text-amber-800">Changing the service doesn’t change what was paid. Settle any price difference with a refund or a manual payment.</p>}
          {override ? (
            <div className="max-w-[200px]">
              <label className="field-label" htmlFor="rs-time">
                Start time (ET)
              </label>
              <input id="rs-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          ) : (
            <SlotPicker date={date} serviceId={serviceId} value={time} onChange={setTime} excludeBookingId={bookingId} />
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Allow outside opening hours
          </label>
          <div>
            <label className="field-label" htmlFor="rs-reason">
              Reason (audit log)
            </label>
            <input id="rs-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the customer the new time
          </label>
          <FormError error={error} />
        </div>
      </Dialog>
    </>
  );
}
