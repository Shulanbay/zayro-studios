'use client';

import { useState } from 'react';
import { callApi, FormError, useJsonSubmit } from './client';

export interface DayRow {
  id: number;
  day_of_week: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

function DayEditor({ row }: { row: DayRow }) {
  const [open, setOpen] = useState(row.is_available);
  const [start, setStart] = useState(row.start_time);
  const [end, setEnd] = useState(row.end_time);
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/availability', method: 'PATCH', successMessage: `${row.day_of_week} saved` });
  const dirty = open !== row.is_available || start !== row.start_time || end !== row.end_time;
  return (
    <li className="py-2 grid grid-cols-[110px_auto_1fr] sm:grid-cols-[120px_90px_120px_120px_auto] items-center gap-2">
      <span className="font-medium text-sm">{row.day_of_week}</span>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> Open
      </label>
      <div className="col-span-3 sm:col-span-1 grid grid-cols-2 sm:contents gap-2">
        <input aria-label={`${row.day_of_week} opens`} type="time" step={900} value={start} disabled={!open} onChange={(e) => setStart(e.target.value)} />
        <input aria-label={`${row.day_of_week} closes`} type="time" step={900} value={end} disabled={!open} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <div className="col-span-3 sm:col-span-1 flex items-center gap-2 justify-end">
        {error && <span className="text-xs text-red-700">{error}</span>}
        <button type="button" className="crm-btn crm-btn-sm" disabled={!dirty || busy} onClick={() => submit({ id: row.id, start_time: start, end_time: end, is_available: open })}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </li>
  );
}

export function WeeklyHoursEditor({ rows }: { rows: DayRow[] }) {
  return (
    <ul className="divide-y divide-zayro-border">
      {rows.map((r) => (
        <DayEditor key={r.id} row={r} />
      ))}
    </ul>
  );
}

export function BookingRulesForm({ initial }: { initial: { bufferBefore: number; bufferAfter: number; increment: number; minAdvanceHours: number; horizonDays: number } }) {
  const [v, setV] = useState(Object.fromEntries(Object.entries(initial).map(([k, n]) => [k, String(n)])) as Record<keyof typeof initial, string>);
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/settings', method: 'PATCH', successMessage: 'Booking rules saved' });
  const fields: [keyof typeof initial, string, string][] = [
    ['increment', 'Slot interval (min)', 'Start times offered every N minutes'],
    ['minAdvanceHours', 'Booking cutoff (hours)', 'Customers can’t book sooner than this'],
    ['bufferBefore', 'Buffer before (min)', 'Gap kept free before each session'],
    ['bufferAfter', 'Buffer after (min)', 'Gap kept free after each session'],
    ['horizonDays', 'Book ahead (days)', 'How far ahead the calendar opens'],
  ];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit({ bookingRules: Object.fromEntries(Object.entries(v).map(([k, s]) => [k, Number(s)])) });
      }}
      className="grid gap-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map(([k, label, hint]) => (
          <div key={k}>
            <label className="field-label" htmlFor={`rule-${k}`}>
              {label}
            </label>
            <input id={`rule-${k}`} type="number" min={0} step={k === 'minAdvanceHours' ? 0.5 : 1} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
            <p className="text-xs text-zayro-gray mt-1">{hint}</p>
          </div>
        ))}
      </div>
      <FormError error={error} />
      <div className="flex justify-end">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save rules'}
        </button>
      </div>
    </form>
  );
}

export function OverrideForm() {
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<'custom_hours' | 'holiday' | 'day_off' | 'closure'>('holiday');
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('18:00');
  const [reason, setReason] = useState('');
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/availability-overrides', successMessage: 'Date override saved', onSuccess: () => setReason('') });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit({ date, kind, reason: reason || null, ...(kind === 'custom_hours' ? { start_time: start, end_time: end } : {}) });
      }}
      className="grid gap-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="field-label" htmlFor="ov-date">
            Date
          </label>
          <input id="ov-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="ov-kind">
            Type
          </label>
          <select id="ov-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="holiday">Holiday (closed)</option>
            <option value="day_off">Day off (closed)</option>
            <option value="closure">Studio closure (closed)</option>
            <option value="custom_hours">Different opening hours</option>
          </select>
        </div>
        {kind === 'custom_hours' && (
          <>
            <div>
              <label className="field-label" htmlFor="ov-start">
                Opens
              </label>
              <input id="ov-start" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="ov-end">
                Closes
              </label>
              <input id="ov-end" type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </>
        )}
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="ov-reason">
            Reason (optional)
          </label>
          <input id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder="e.g. Thanksgiving" />
        </div>
      </div>
      <FormError error={error} />
      <div className="flex justify-end">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy || !date}>
          {busy ? 'Saving…' : 'Save date'}
        </button>
      </div>
    </form>
  );
}

interface Slot {
  start: string;
  end: string;
  available: boolean;
}

/** What a customer would see for a date and session length right now. */
export function AvailabilityPreview({ defaultDate, services }: { defaultDate: string; services: { id: number; name: string; duration: number }[] }) {
  const [date, setDate] = useState(defaultDate);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? 0);
  const [result, setResult] = useState<{ slots: Slot[]; closedReason: string | null; open: { start: number; end: number } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    const res = await callApi<typeof result & object>(`/api/admin/slots?date=${date}&serviceId=${serviceId}&public=1`, 'GET');
    setBusy(false);
    if (!res.ok) return setError(res.data.error || 'Could not load');
    setResult(res.data);
  };
  const free = result?.slots.filter((s) => s.available) ?? [];
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <div>
          <label className="field-label" htmlFor="pv-date">
            Date
          </label>
          <input id="pv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="pv-svc">
            Service
          </label>
          <select id="pv-svc" value={serviceId} onChange={(e) => setServiceId(Number(e.target.value))}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.duration} min)
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="crm-btn" onClick={run} disabled={busy}>
          {busy ? 'Checking…' : 'Preview'}
        </button>
      </div>
      <FormError error={error} />
      {result && (
        <div aria-live="polite">
          {!result.open ? (
            <p className="text-sm text-amber-800">Closed: {result.closedReason}</p>
          ) : (
            <>
              <p className="text-sm text-zayro-gray mb-2">
                {free.length} bookable start time{free.length === 1 ? '' : 's'} for customers (cutoff and buffers applied).
              </p>
              <div className="flex flex-wrap gap-1.5">
                {result.slots.map((s) => (
                  <span key={s.start} className={`crm-badge ${s.available ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-slate-100 text-slate-400 border-slate-200 line-through'}`}>
                    {s.start}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function BlockTimeForm({ defaultDate }: { defaultDate: string }) {
  const [date, setDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState('');
  const [start, setStart] = useState('12:00');
  const [end, setEnd] = useState('14:00');
  const [kind, setKind] = useState('block');
  const [reason, setReason] = useState('');
  const [repeat, setRepeat] = useState('0');
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/blocked-times', successMessage: 'Time blocked', onSuccess: () => setReason('') });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit({ date, end_date: endDate || undefined, start_time: start, end_time: end, kind, reason: reason || undefined, repeat_weekly: Number(repeat) });
      }}
      className="grid gap-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label" htmlFor="bt-date">
            Date
          </label>
          <input id="bt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="bt-enddate">
            Until date (optional)
          </label>
          <input id="bt-enddate" type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="bt-start">
            From (ET)
          </label>
          <input id="bt-start" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="bt-end">
            To (ET)
          </label>
          <input id="bt-end" type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="bt-kind">
            Type
          </label>
          <select id="bt-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="block">Blocked</option>
            <option value="maintenance">Maintenance</option>
            <option value="private_event">Private event</option>
            <option value="holiday">Holiday</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="bt-repeat">
            Repeat weekly
          </label>
          <select id="bt-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            <option value="0">No</option>
            {[1, 3, 7, 11, 25].map((n) => (
              <option key={n} value={n}>
                {n + 1} weeks in total
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="field-label" htmlFor="bt-reason">
            Reason
          </label>
          <input id="bt-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder="Shown in the admin calendar and Google Calendar" />
        </div>
      </div>
      <p className="text-xs text-zayro-gray">Takes effect immediately for public booking. Refused if a confirmed booking is already in that time.</p>
      <FormError error={error} />
      <div className="flex justify-end">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy}>
          {busy ? 'Blocking…' : 'Block time'}
        </button>
      </div>
    </form>
  );
}
