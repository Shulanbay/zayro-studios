'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { addDays, formatTimeLabel, todayInTz } from '@/lib/crm/time';
import { formatCents } from '@/lib/crm/money';
import type { ManageView } from '@/lib/manageBooking';

/**
 * Manage Your Booking. The secure token arrives in the URL fragment
 * (#t=…), which never reaches the server, analytics or a Referer header.
 * It is moved to sessionStorage straight away and the fragment is removed
 * from the address bar; every API call sends it in the request body.
 */

const TOKEN_KEY = 'zayro-manage-token';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Mode = 'overview' | 'cancel' | 'reschedule' | 'extend';
type Load = { kind: 'loading' } | { kind: 'invalid'; message: string } | { kind: 'ready'; view: ManageView } | { kind: 'error'; message: string };

function readToken(): string | null {
  try {
    const hash = window.location.hash.replace(/^#/, '');
    const fromHash = new URLSearchParams(hash).get('t');
    if (fromHash) {
      sessionStorage.setItem(TOKEN_KEY, fromHash);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return fromHash;
    }
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function call<T>(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: T & { error?: string; code?: string } }> {
  const res = await fetch(`/api/booking/manage/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}
function monthEnd(month: string) {
  const d = new Date(`${month}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}
function shiftMonth(month: string, delta: number) {
  const d = new Date(`${month}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta, 1);
  return d.toISOString().slice(0, 10);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-1">{label}</dt>
      <dd className="text-zayro-dark font-semibold break-words">{children}</dd>
    </div>
  );
}

export default function ManageBookingPage() {
  const [token, setToken] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [mode, setMode] = useState<Mode>('overview');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'info' | 'error'; text: string } | null>(null);
  const panelRef = useRef<HTMLHeadingElement>(null);
  const actionsRef = useRef<HTMLHeadingElement>(null);
  const back = () => {
    setMode('overview');
    // Keyboard and screen-reader users land back on the list of actions.
    setTimeout(() => actionsRef.current?.focus(), 0);
  };

  const refresh = useCallback(async (t: string) => {
    try {
      const res = await call<{ booking: ManageView }>('view', { token: t });
      if (res.ok && res.data.booking) return setLoad({ kind: 'ready', view: res.data.booking }), res.data.booking;
      if (res.status === 404) setLoad({ kind: 'invalid', message: res.data.error || 'This link is invalid or has expired.' });
      else setLoad({ kind: 'error', message: res.data.error || 'We could not load your booking. Please try again.' });
    } catch {
      setLoad({ kind: 'error', message: 'We could not load your booking. Check your connection and try again.' });
    }
    return null;
  }, []);

  useEffect(() => {
    const t = readToken();
    setToken(t);
    if (!t) {
      setLoad({ kind: 'invalid', message: 'Open the Manage Your Booking link from your ZAYRO Studios confirmation email.' });
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const ext = params.get('extension');
    if (ext) window.history.replaceState(null, '', window.location.pathname);
    (async () => {
      const first = await refresh(t);
      if (ext === 'cancelled') setNotice({ tone: 'info', text: 'Payment was not completed. Your booking has not changed.' });
      if (ext === 'paid' && first) {
        setNotice({ tone: 'info', text: 'Payment received — confirming your extra time…' });
        const before = first.endTime;
        for (let i = 0; i < 12; i++) {
          await new Promise((r) => setTimeout(r, 2500));
          const v = await refresh(t);
          if (v && v.endTime !== before) {
            setNotice({ tone: 'ok', text: `Your session has been extended. It now ends at ${formatTimeLabel(v.endTime)} ET.` });
            return;
          }
        }
        setNotice({ tone: 'info', text: 'Your payment is being confirmed. You will receive an email as soon as your extra time is applied.' });
      }
    })();
  }, [refresh]);

  const open = (m: Mode) => {
    setNotice(null);
    setMode(m);
    setTimeout(() => panelRef.current?.focus(), 0);
  };

  if (load.kind === 'loading') {
    return (
      <div className="container py-16 max-w-4xl" aria-busy="true">
        <div className="skeleton h-12 w-2/3 mb-4" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }
  if (load.kind !== 'ready') {
    return (
      <div className="container py-16 md:py-24 max-w-2xl">
        <h1 className="text-[clamp(2rem,9vw,3rem)] font-black text-zayro-dark mb-4">Manage your booking</h1>
        <div className="card">
          <p className="text-zayro-gray mb-6" role="alert">
            {load.message}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/booking/manage/request-link" className="button button-primary">
              Request a new link
            </Link>
            <a href="mailto:hello@zayro.studio" className="button button-secondary">
              Contact the studio
            </a>

          </div>
        </div>
      </div>
    );
  }

  const v = load.view;
  const done = () => {
    setMode('overview');
    if (token) refresh(token);
  };

  return (
    <div className="container py-10 md:py-16 max-w-5xl">
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-zayro-primary mb-3">Booking {v.reference}</p>
      <h1 className="text-[clamp(2rem,9vw,3.5rem)] font-black text-zayro-dark leading-tight mb-6">Manage your booking</h1>

      <div aria-live="polite" className="min-h-0">
        {notice && (
          <p className={`mb-8 rounded-xl-plus border px-5 py-4 font-semibold ${notice.tone === 'error' ? 'form-error-banner' : notice.tone === 'ok' ? 'border-green-200 bg-green-50 text-green-900' : 'border-zayro-border bg-white text-zayro-dark'}`}>
            {notice.text}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 mb-10">
        <dl className="card lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <span className={`chip ${v.status === 'confirmed' ? '' : 'opacity-80'}`}>
              <span className="chip-dot" aria-hidden="true" />
              {v.statusLabel}
            </span>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-1">Service</dt>
            <dd className="text-2xl font-black text-zayro-dark">{v.service}</dd>
            {v.setup && <dd className="text-sm text-zayro-gray mt-1">Setup: {v.setup}</dd>}
          </div>
          <Row label="Date">{longDate(v.date)}</Row>
          <Row label="Time">
            {formatTimeLabel(v.startTime)} – {formatTimeLabel(v.endTime)}
            <span className="block text-sm font-normal text-zayro-gray">
              {v.timezone} · {v.durationLabel}
            </span>
          </Row>
          {v.participants !== null && <Row label="Participants">{v.participants}</Row>}
          <Row label="Extras">{v.extras.length ? v.extras.join(', ') : 'None'}</Row>
          <div className="sm:col-span-2">
            <Row label="Address">{v.address}</Row>
          </div>
        </dl>

        <div className="card h-fit">
          <h2 className="text-xs font-bold text-zayro-gray uppercase tracking-wide mb-5">Payment</h2>
          <dl className="space-y-3 text-sm border-b border-zayro-border pb-5 mb-5">
            <div className="flex justify-between gap-3">
              <dt className="text-zayro-gray">Subtotal</dt>
              <dd className="font-semibold text-zayro-dark">{formatCents(v.money.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zayro-gray">Sales tax</dt>
              <dd className="font-semibold text-zayro-dark">{formatCents(v.money.taxCents)}</dd>
            </div>
            <div className="flex justify-between gap-3 text-base">
              <dt className="font-bold text-zayro-dark">Total paid</dt>
              <dd className="font-black text-zayro-primary">{formatCents(v.money.totalCents)}</dd>
            </div>
          </dl>
          <p className="text-sm text-zayro-dark">
            <span className="font-semibold">Payment status:</span> {v.paymentLabel}
          </p>
          {v.refund && (
            <div className="mt-3 text-sm text-zayro-dark">
              <p className="font-semibold">Refund: {v.refund.label}</p>
              {v.refund.items.length > 1 && (
                <ul className="mt-1 text-zayro-gray">
                  {v.refund.items.map((r, i) => (
                    <li key={i}>
                      {formatCents(r.amountCents)} — {r.status}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {mode === 'overview' && (
        <section aria-labelledby="actions-title" className="mb-10">
          <h2 id="actions-title" ref={actionsRef} tabIndex={-1} className="text-2xl font-black text-zayro-dark mb-4 outline-none">
            What would you like to do?
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ActionCard
              title="Reschedule"
              text={v.can.reschedule ? `Move to another free time. Available until ${v.deadlineLabel}.` : v.reasons.reschedule}
              enabled={v.can.reschedule}
              onClick={() => open('reschedule')}
            />
            <ActionCard
              title="Add More Time"
              text={v.can.extend ? v.policies.extension : v.reasons.extend}
              enabled={v.can.extend}
              onClick={() => open('extend')}
            />
            <ActionCard
              title="Cancel Booking"
              text={v.can.cancel ? `Full refund to your original payment method until ${v.deadlineLabel}.` : v.reasons.cancel}
              enabled={v.can.cancel}
              onClick={() => open('cancel')}
              tone="danger"
            />
            <a href={`mailto:${v.contactEmail}?subject=${encodeURIComponent(`Booking ${v.reference}`)}`} className="card card-interactive block">
              <span className="block text-lg font-black text-zayro-dark mb-1">Contact Studio</span>
              <span className="block text-sm text-zayro-gray">Change your package, extras or details, or ask us anything.</span>
            </a>
          </div>
        </section>
      )}

      {mode === 'cancel' && token && <CancelPanel token={token} view={v} headingRef={panelRef} onBack={back} onDone={(msg) => (setNotice({ tone: 'ok', text: msg }), done())} />}
      {mode === 'reschedule' && token && (
        <ReschedulePanel token={token} view={v} headingRef={panelRef} onBack={back} onDone={(msg) => (setNotice({ tone: 'ok', text: msg }), done())} />
      )}
      {mode === 'extend' && token && <ExtendPanel token={token} view={v} headingRef={panelRef} onBack={back} />}

      <section aria-labelledby="policies-title" className="card">
        <h2 id="policies-title" className="text-xl font-black text-zayro-dark mb-4">
          Studio policies
        </h2>
        <ul className="space-y-3 text-zayro-gray leading-relaxed">
          <li>{v.policies.studioTime}</li>
          <li>{v.policies.earlyArrival}</li>
          <li>{v.policies.setupChange}</li>
          <li>{v.policies.changes}</li>
          <li>{v.policies.refund}</li>
          <li>{v.policies.extension}</li>
        </ul>
        <p className="mt-4 text-sm">
          <Link href="/terms" className="text-zayro-primary font-semibold hover:underline">
            Read the full terms
          </Link>
        </p>
      </section>
    </div>
  );
}

function ActionCard({ title, text, enabled, onClick, tone }: { title: string; text?: string; enabled: boolean; onClick: () => void; tone?: 'danger' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-disabled={!enabled}
      className={`card text-left w-full whitespace-normal ${enabled ? 'card-interactive' : 'opacity-60 cursor-not-allowed'}`}
    >
      <span className={`block text-lg font-black mb-1 ${tone === 'danger' && enabled ? 'text-red-700' : 'text-zayro-dark'}`}>{title}</span>
      {text && <span className="block text-sm text-zayro-gray">{text}</span>}
    </button>
  );
}

interface PanelProps {
  token: string;
  view: ManageView;
  headingRef: React.RefObject<HTMLHeadingElement>;
  onBack: () => void;
}

function PanelShell({ title, headingRef, onBack, children }: { title: string; headingRef: React.RefObject<HTMLHeadingElement>; onBack: () => void; children: React.ReactNode }) {
  return (
    <section className="card mb-10" aria-labelledby="panel-title">
      <div className="flex items-start justify-between gap-4 mb-6">
        <h2 id="panel-title" ref={headingRef} tabIndex={-1} className="text-2xl font-black text-zayro-dark outline-none">
          {title}
        </h2>
        <button type="button" className="button button-secondary !px-4 !py-2" onClick={onBack}>
          Back
        </button>
      </div>
      {children}
    </section>
  );
}

function CancelPanel({ token, view, headingRef, onBack, onDone }: PanelProps & { onDone: (message: string) => void }) {
  const [preview, setPreview] = useState<{ refundCents: number; deadlineLabel: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call<{ refundCents: number; deadlineLabel: string | null }>('cancel-preview', { token }).then((res) => {
      if (res.ok) setPreview(res.data);
      else setError(res.data.error || 'This booking can no longer be canceled online.');
    });
  }, [token]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await call<{ message: string }>('cancel', { token });
      if (res.ok) return onDone(res.data.message);
      setError(res.data.error || 'We could not cancel your booking. Please try again or contact the studio.');
    } catch {
      setError('We could not reach the server. Your booking has not been canceled if you did not see a confirmation — reload to check.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelShell title="Cancel your booking" headingRef={headingRef} onBack={onBack}>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <Row label="Session">
          {longDate(view.date)}, {formatTimeLabel(view.startTime)} – {formatTimeLabel(view.endTime)} ET
        </Row>
        <Row label="Refund">{preview ? formatCents(preview.refundCents) : '…'}</Row>
      </dl>
      <ul className="space-y-2 text-zayro-gray mb-6 leading-relaxed">
        <li>Your session will be canceled and the time released to other customers. This cannot be undone.</li>
        <li>{view.policies.refund}</li>
      </ul>
      <div aria-live="assertive">
        {error && (
          <p className="field-error mb-4" role="alert">
            {error}
          </p>
        )}
      </div>
      <button type="button" onClick={confirm} disabled={busy || !preview} className={`button button-primary w-full sm:w-auto ${busy ? 'is-loading' : ''}`}>
        Cancel Booking and Request Refund
      </button>
    </PanelShell>
  );
}

function ReschedulePanel({ token, view, headingRef, onBack, onDone }: PanelProps & { onDone: (message: string) => void }) {
  const today = todayInTz();
  const [month, setMonth] = useState(() => monthStart(view.date >= today ? view.date : today));
  const [dates, setDates] = useState<Set<string> | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<{ start: string; end: string }[] | null>(null);
  const [slot, setSlot] = useState<{ start: string; end: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDates(null);
    call<{ dates: string[] }>('reschedule-availability', { token, from: month < today ? today : month, to: monthEnd(month) }).then((res) => {
      if (cancelled) return;
      if (res.ok) setDates(new Set(res.data.dates));
      else setError(res.data.error || 'Could not load available dates.');
    });
    return () => {
      cancelled = true;
    };
  }, [token, month, today]);

  const pickDate = async (d: string) => {
    setDate(d);
    setSlot(null);
    setSlots(null);
    setError(null);
    const res = await call<{ slots: { start: string; end: string }[] }>('reschedule-availability', { token, date: d });
    if (res.ok) setSlots(res.data.slots);
    else setError(res.data.error || 'Could not load times.');
  };

  const submit = async () => {
    if (!date || !slot || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await call<{ date: string; startTime: string; endTime: string }>('reschedule', { token, date, startTime: slot.start });
      if (res.ok) return onDone(`Your session has been rescheduled to ${longDate(res.data.date)}, ${formatTimeLabel(res.data.startTime)} ET.`);
      setError(res.data.error || 'We could not reschedule your booking.');
      if (res.data.code === 'slot_taken') {
        setSlot(null);
        pickDate(date);
      }
    } catch {
      setError('We could not reach the server. Reload to check whether your booking moved.');
    } finally {
      setBusy(false);
    }
  };

  const first = new Date(`${month}T12:00:00Z`);
  const days: string[] = [];
  for (let d = month; d <= monthEnd(month); d = addDays(d, 1)) days.push(d);
  const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <PanelShell title="Choose a new time" headingRef={headingRef} onBack={onBack}>
      <p className="text-zayro-gray mb-6">
        Your service, session length ({view.durationLabel}), setup, extras and guests stay the same. Need a different package or length? Contact the studio.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between gap-3 mb-4">
            <button type="button" className="button button-secondary !px-4 !py-2 disabled:opacity-40" disabled={month <= monthStart(today)} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
              <span aria-hidden="true">←</span>
            </button>
            <h3 className="font-bold text-zayro-dark" aria-live="polite">
              {label}
            </h3>
            <button type="button" className="button button-secondary !px-4 !py-2" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
              <span aria-hidden="true">→</span>
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-zayro-gray mb-2" aria-hidden="true">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1" role="group" aria-label={`Available dates in ${label}`} aria-busy={!dates}>
            {Array.from({ length: first.getUTCDay() }).map((_, i) => (
              <span key={`p${i}`} aria-hidden="true" />
            ))}
            {days.map((d) => {
              const ok = !!dates?.has(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!ok}
                  aria-pressed={d === date}
                  aria-label={`${longDate(d)}${ok ? '' : ', unavailable'}`}
                  onClick={() => pickDate(d)}
                  className={`aspect-square min-h-[2.75rem] p-0 rounded-xl text-sm font-semibold ${d === date ? 'bg-gradient-cta text-white' : ok ? 'bg-zayro-bg text-zayro-dark hover:ring-2 hover:ring-zayro-primary' : 'text-zayro-gray/40 cursor-not-allowed'}`}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-zayro-gray mt-4">All times are New York time (ET).</p>
        </div>
        <div>
          {!date && <p className="text-zayro-gray">Pick a date to see free start times.</p>}
          {date && !slots && <p className="text-zayro-gray" role="status">Checking times…</p>}
          {date && slots && slots.length === 0 && <p className="text-zayro-gray">No free times on this date.</p>}
          {date && slots && slots.length > 0 && (
            <fieldset>
              <legend className="field-label mb-3">{longDate(date)}</legend>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {slots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    aria-pressed={slot?.start === s.start}
                    onClick={() => setSlot(s)}
                    className={`rounded-full border-2 border-solid px-3 py-2 text-sm font-semibold min-h-[2.75rem] ${slot?.start === s.start ? 'border-zayro-primary bg-zayro-primary text-white' : 'border-zayro-border bg-white text-zayro-dark hover:border-zayro-primary'}`}
                  >
                    {formatTimeLabel(s.start)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </div>
      {date && slot && (
        <div className="mt-8 border-t border-zayro-border pt-6">
          <p className="text-zayro-dark mb-4">
            <span className="font-semibold">New time:</span> {longDate(date)}, {formatTimeLabel(slot.start)} – {formatTimeLabel(slot.end)} ET
            <span className="block text-sm text-zayro-gray">
              Was {longDate(view.date)}, {formatTimeLabel(view.startTime)} – {formatTimeLabel(view.endTime)} ET
            </span>
          </p>
          <button type="button" onClick={submit} disabled={busy} className={`button button-primary ${busy ? 'is-loading' : ''}`}>
            Confirm new time
          </button>
        </div>
      )}
      <div aria-live="assertive">
        {error && (
          <p className="field-error mt-4" role="alert">
            {error}
          </p>
        )}
      </div>
    </PanelShell>
  );
}

function ExtendPanel({ token, view, headingRef, onBack }: PanelProps) {
  const [hours, setHours] = useState<number | null>(view.extension.options[0]?.hours ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const option = view.extension.options.find((o) => o.hours === hours) ?? null;

  const pay = async () => {
    if (!option || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await call<{ checkoutUrl: string }>('extend', { token, hours: option.hours });
      if (res.ok && res.data.checkoutUrl) return window.location.assign(res.data.checkoutUrl);
      setError(res.data.error || 'We could not start the payment.');
      setBusy(false);
    } catch {
      setError('We could not reach the server. Please try again.');
      setBusy(false);
    }
  };

  return (
    <PanelShell title="Add more time" headingRef={headingRef} onBack={onBack}>
      <p className="text-zayro-gray mb-6">{view.policies.extension} Extra time is added right after your session.</p>
      <fieldset className="mb-6">
        <legend className="field-label mb-3">How much time?</legend>
        <div className="flex flex-wrap gap-2">
          {view.extension.options.map((o) => (
            <button
              key={o.hours}
              type="button"
              aria-pressed={o.hours === hours}
              onClick={() => setHours(o.hours)}
              className={`rounded-full border-2 border-solid px-4 py-2 text-sm font-semibold min-h-[2.75rem] ${o.hours === hours ? 'border-zayro-primary bg-zayro-primary text-white' : 'border-zayro-border bg-white text-zayro-dark hover:border-zayro-primary'}`}
            >
              +{o.hours} h
            </button>
          ))}
        </div>
      </fieldset>
      {option && (
        <dl className="space-y-3 text-sm max-w-md mb-6">
          <div className="flex justify-between gap-3">
            <dt className="text-zayro-gray">Current end</dt>
            <dd className="font-semibold text-zayro-dark">{formatTimeLabel(view.endTime)} ET</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-zayro-gray">New end</dt>
            <dd className="font-semibold text-zayro-dark">{formatTimeLabel(option.newEndTime)} ET</dd>
          </div>
          {option.lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-3">
              <dt className="text-zayro-gray">
                {l.name}
                {l.quantity > 1 ? ` × ${l.quantity}` : ''}
              </dt>
              <dd className="font-semibold text-zayro-dark">{formatCents(l.totalCents)}</dd>
            </div>
          ))}
          {option.taxCents > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-zayro-gray">Sales tax</dt>
              <dd className="font-semibold text-zayro-dark">{formatCents(option.taxCents)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3 text-base border-t border-zayro-border pt-3">
            <dt className="font-bold text-zayro-dark">Due now</dt>
            <dd className="font-black text-zayro-primary">{formatCents(option.totalCents)}</dd>
          </div>
        </dl>
      )}
      <div aria-live="assertive">
        {error && (
          <p className="field-error mb-4" role="alert">
            {error}
          </p>
        )}
      </div>
      <button type="button" onClick={pay} disabled={!option || busy} className={`button button-primary ${busy ? 'is-loading' : ''}`}>
        {option ? `Pay ${formatCents(option.totalCents)} securely` : 'Choose extra time'}
      </button>
      <p className="text-xs text-zayro-gray mt-3">Your booking changes only after the payment succeeds. Additional time is never guaranteed until then.</p>
    </PanelShell>
  );
}
