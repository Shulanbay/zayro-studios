'use client';

import { useState } from 'react';
import { callApi, FormError, useApiMessage, useJsonSubmit } from './client';
import { useI18n } from './i18n';

const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Monday" (stored) → the weekday's name in the admin's language, capitalised. */
function useDayName() {
  const { f } = useI18n();
  return (day: string) => {
    const i = WEEK.indexOf(day);
    if (i < 0) return day;
    const name = f.weekday(i, 'long');
    return name.charAt(0).toLocaleUpperCase(f.intl) + name.slice(1);
  };
}

export interface DayRow {
  id: number;
  day_of_week: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

function DayEditor({ row }: { row: DayRow }) {
  const { t } = useI18n();
  const dayName = useDayName()(row.day_of_week);
  const [open, setOpen] = useState(row.is_available);
  const [start, setStart] = useState(row.start_time);
  const [end, setEnd] = useState(row.end_time);
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/availability', method: 'PATCH', successMessage: t('availability.day.saved', { day: dayName }) });
  const dirty = open !== row.is_available || start !== row.start_time || end !== row.end_time;
  return (
    <li className="py-2 grid grid-cols-[110px_auto_1fr] sm:grid-cols-[120px_90px_120px_120px_auto] items-center gap-2">
      <span className="font-medium text-sm break-words">{dayName}</span>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> {t('availability.day.open')}
      </label>
      <div className="col-span-3 sm:col-span-1 grid grid-cols-2 sm:contents gap-2">
        <input aria-label={t('availability.day.opens', { day: dayName })} type="time" step={900} value={start} disabled={!open} onChange={(e) => setStart(e.target.value)} />
        <input aria-label={t('availability.day.closes', { day: dayName })} type="time" step={900} value={end} disabled={!open} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <div className="col-span-3 sm:col-span-1 flex items-center gap-2 justify-end">
        {error && <span className="text-xs text-red-700">{error}</span>}
        <button type="button" className="crm-btn crm-btn-sm" disabled={!dirty || busy} onClick={() => submit({ id: row.id, start_time: start, end_time: end, is_available: open })}>
          {busy ? t('availability.day.saving') : t('common.actions.save')}
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
  const { t } = useI18n();
  const [v, setV] = useState(Object.fromEntries(Object.entries(initial).map(([k, n]) => [k, String(n)])) as Record<keyof typeof initial, string>);
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/settings', method: 'PATCH', successMessage: t('availability.rule.saved') });
  const keys = ['increment', 'minAdvanceHours', 'bufferBefore', 'bufferAfter', 'horizonDays'] as const;
  const fields: [keyof typeof initial, string, string][] = keys.map((k) => [k, t(`availability.rule.${k}`), t(`availability.rule.${k}Hint`)]);
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
          {busy ? t('availability.rule.saving') : t('availability.rule.save')}
        </button>
      </div>
    </form>
  );
}

export function OverrideForm() {
  const { t } = useI18n();
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<'custom_hours' | 'holiday' | 'day_off' | 'closure'>('holiday');
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('18:00');
  const [reason, setReason] = useState('');
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/availability-overrides', successMessage: t('availability.override.saved'), onSuccess: () => setReason('') });
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
            {t('availability.override.date')}
          </label>
          <input id="ov-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="ov-kind">
            {t('availability.override.type')}
          </label>
          <select id="ov-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="holiday">{t('availability.override.holiday')}</option>
            <option value="day_off">{t('availability.override.dayOff')}</option>
            <option value="closure">{t('availability.override.closure')}</option>
            <option value="custom_hours">{t('availability.override.customHours')}</option>
          </select>
        </div>
        {kind === 'custom_hours' && (
          <>
            <div>
              <label className="field-label" htmlFor="ov-start">
                {t('availability.override.opens')}
              </label>
              <input id="ov-start" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="ov-end">
                {t('availability.override.closes')}
              </label>
              <input id="ov-end" type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </>
        )}
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="ov-reason">
            {t('availability.override.reason')}
          </label>
          <input id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder={t('availability.override.reasonPlaceholder')} />
        </div>
      </div>
      <FormError error={error} />
      <div className="flex justify-end">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy || !date}>
          {busy ? t('availability.override.saving') : t('availability.override.save')}
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
  const { t, f, label } = useI18n();
  const apiMessage = useApiMessage();
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
    if (!res.ok) return setError(res.data.error ? apiMessage(res.data.error, res.status) : t('availability.previewForm.loadFailed'));
    setResult(res.data);
  };
  const free = result?.slots.filter((s) => s.available) ?? [];
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <div>
          <label className="field-label" htmlFor="pv-date">
            {t('availability.previewForm.date')}
          </label>
          <input id="pv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="pv-svc">
            {t('availability.previewForm.service')}
          </label>
          <select id="pv-svc" value={serviceId} onChange={(e) => setServiceId(Number(e.target.value))}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {t('availability.previewForm.serviceOption', { name: s.name, minutes: s.duration })}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="crm-btn" onClick={run} disabled={busy}>
          {busy ? t('availability.previewForm.checking') : t('availability.previewForm.preview')}
        </button>
      </div>
      <FormError error={error} />
      {result && (
        <div aria-live="polite">
          {!result.open ? (
            <p className="text-sm text-amber-800">{t('availability.previewForm.closed', { reason: label(result.closedReason) })}</p>
          ) : (
            <>
              <p className="text-sm text-zayro-gray mb-2">
                {t('availability.previewForm.bookable', { count: free.length })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {result.slots.map((s) => (
                  <span key={s.start} className={`crm-badge ${s.available ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-slate-100 text-slate-400 border-slate-200 line-through'}`}>
                    {f.time(s.start)}
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
  const { t } = useI18n();
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/blocked-times', successMessage: t('availability.blocked.form.blocked'), onSuccess: () => setReason('') });
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
            {t('availability.blocked.form.date')}
          </label>
          <input id="bt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="bt-enddate">
            {t('availability.blocked.form.until')}
          </label>
          <input id="bt-enddate" type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="bt-start">
            {t('availability.blocked.form.from')}
          </label>
          <input id="bt-start" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="bt-end">
            {t('availability.blocked.form.to')}
          </label>
          <input id="bt-end" type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        <div>
          <label className="field-label" htmlFor="bt-kind">
            {t('availability.blocked.form.type')}
          </label>
          <select id="bt-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {(['block', 'maintenance', 'private_event', 'holiday'] as const).map((k) => (
              <option key={k} value={k}>
                {t(`availability.blocked.kinds.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="bt-repeat">
            {t('availability.blocked.form.repeat')}
          </label>
          <select id="bt-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            <option value="0">{t('availability.blocked.form.no')}</option>
            {[1, 3, 7, 11, 25].map((n) => (
              <option key={n} value={n}>
                {t('availability.blocked.form.weeks', { count: n + 1 })}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="field-label" htmlFor="bt-reason">
            {t('availability.blocked.form.reason')}
          </label>
          <input id="bt-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder={t('availability.blocked.form.reasonPlaceholder')} />
        </div>
      </div>
      <p className="text-xs text-zayro-gray">{t('availability.blocked.form.note')}</p>
      <FormError error={error} />
      <div className="flex justify-end">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy}>
          {busy ? t('availability.blocked.form.blocking') : t('availability.blocked.form.submit')}
        </button>
      </div>
    </form>
  );
}
