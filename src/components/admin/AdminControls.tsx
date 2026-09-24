'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface AvailabilityRow {
  id: number;
  day_of_week: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

interface BlockedTimeRow {
  id: string;
  start_datetime: string;
  end_datetime: string;
  reason: string | null;
}

export function AdminLogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch('/api/admin/logout', { method: 'POST' });
        router.push('/admin/login');
        router.refresh();
      }}
      className="button button-secondary text-sm py-2 px-4"
    >
      Log out
    </button>
  );
}

export function AdminAvailabilityManager({ initialRows }: { initialRows: AvailabilityRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [savingId, setSavingId] = useState<number | null>(null);

  const update = async (row: AvailabilityRow, updates: Partial<AvailabilityRow>) => {
    setSavingId(row.id);
    const next = { ...row, ...updates };
    setRows((rs) => rs.map((r) => (r.id === row.id ? next : r)));
    try {
      await fetch('/api/admin/availability', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, ...updates }),
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="card">
      <h2 className="text-lg font-bold mb-4 text-zayro-dark">Business Hours</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zayro-gray border-b border-zayro-border">
            <th className="py-2 font-medium">Day</th>
            <th className="font-medium">Start</th>
            <th className="font-medium">End</th>
            <th className="font-medium">Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-zayro-border last:border-0">
              <td className="py-2.5 font-medium text-zayro-dark">{row.day_of_week}</td>
              <td>
                <input
                  type="time"
                  defaultValue={row.start_time}
                  aria-label={`${row.day_of_week} opening time`}
                  onBlur={(e) => e.target.value !== row.start_time && update(row, { start_time: e.target.value })}
                  className="text-sm py-1.5 px-2"
                />
              </td>
              <td>
                <input
                  type="time"
                  defaultValue={row.end_time}
                  aria-label={`${row.day_of_week} closing time`}
                  onBlur={(e) => e.target.value !== row.end_time && update(row, { end_time: e.target.value })}
                  className="text-sm py-1.5 px-2"
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={row.is_available}
                  aria-label={`${row.day_of_week} open for booking`}
                  disabled={savingId === row.id}
                  onChange={(e) => update(row, { is_available: e.target.checked })}
                  style={{ width: 'auto' }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminBlockedTimesManager({ initialRows }: { initialRows: BlockedTimeRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [form, setForm] = useState({ start: '', end: '', reason: '' });
  const [loading, setLoading] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.start || !form.end) return;
    setLoading(true);
    try {
      const response = await fetch('/api/admin/blocked-times', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_datetime: form.start, end_datetime: form.end, reason: form.reason }),
      });
      if (response.ok) {
        const created = await response.json();
        setRows((rs) => [created, ...rs]);
        setForm({ start: '', end: '', reason: '' });
      }
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    setRows((rs) => rs.filter((r) => r.id !== id));
    await fetch(`/api/admin/blocked-times?id=${id}`, { method: 'DELETE' });
  };

  return (
    <div className="card">
      <h2 className="text-lg font-bold mb-4 text-zayro-dark">Blocked Times</h2>
      <form onSubmit={add} className="flex flex-wrap gap-2 mb-5">
        <input
          type="datetime-local"
          value={form.start}
          aria-label="Blocked time start"
          onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
          className="text-sm py-2 px-2 w-auto"
          required
        />
        <input
          type="datetime-local"
          value={form.end}
          aria-label="Blocked time end"
          onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
          className="text-sm py-2 px-2 w-auto"
          required
        />
        <input
          type="text"
          placeholder="Reason (optional)"
          value={form.reason}
          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          className="text-sm py-2 px-2 flex-1 min-w-[140px]"
        />
        <button type="submit" disabled={loading} className="button button-primary text-sm py-2 px-4">
          Add
        </button>
      </form>
      <ul className="space-y-2 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex justify-between items-center gap-3 border-b border-zayro-border pb-2">
            <span className="text-zayro-gray">
              {new Date(row.start_datetime).toLocaleString()} → {new Date(row.end_datetime).toLocaleString()}
              {row.reason ? ` — ${row.reason}` : ''}
            </span>
            <button onClick={() => remove(row.id)} className="text-red-600 hover:underline flex-shrink-0">
              Remove
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="text-zayro-gray">No blocked times.</li>}
      </ul>
    </div>
  );
}

export function StripeWebhookStatus() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading');
  const [detail, setDetail] = useState<string>('');

  useEffect(() => {
    fetch('/api/admin/stripe-webhook-status')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setStatus('error');
          setDetail(data.error);
          return;
        }
        const live = (data.endpoints || []).find((e: any) => e.url.endsWith('/api/payment/webhook'));
        if (live) {
          setStatus('ok');
          setDetail(`${live.status} · events: ${live.enabled_events.join(', ')}`);
        } else {
          setStatus('missing');
          setDetail('No webhook endpoint found for /api/payment/webhook in this Stripe account.');
        }
      })
      .catch(() => {
        setStatus('error');
        setDetail('Could not reach Stripe.');
      });
  }, []);

  const color = status === 'ok' ? 'text-green-700' : status === 'loading' ? 'text-zayro-gray' : 'text-red-700';

  return (
    <div className="card">
      <h2 className="text-lg font-bold mb-3 text-zayro-dark">Stripe Webhook</h2>
      <p className={`text-sm font-medium ${color}`}>
        {status === 'loading' && 'Checking...'}
        {status === 'ok' && '✓ Configured'}
        {status === 'missing' && '✗ Not configured'}
        {status === 'error' && '✗ Could not check'}
      </p>
      {detail && <p className="text-xs text-zayro-gray mt-2">{detail}</p>}
      <p className="text-xs text-zayro-gray mt-3">
        Signing secret is never shown here — configure it directly in Vercel's environment variables.
      </p>
    </div>
  );
}

interface IntegrationCheck {
  ok: boolean;
  message: string;
  tabs?: { sheetName: string; ok: boolean; message: string }[];
}

export function GoogleConnectionTest() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ calendar?: IntegrationCheck; sheets?: IntegrationCheck; error?: string } | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/integrations?check=1');
      const data = await response.json();
      setResult(response.ok ? data : { error: data.error || 'Check failed' });
    } catch {
      setResult({ error: 'Could not reach the server.' });
    } finally {
      setLoading(false);
    }
  };

  const line = (label: string, check?: IntegrationCheck) =>
    check && (
      <div className="text-xs mt-2">
        <span className={check.ok ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
          {check.ok ? '✓' : '✗'} {label}:
        </span>{' '}
        <span className="text-zayro-gray">{check.message}</span>
        {check.tabs?.map((t) => (
          <div key={t.sheetName} className="ml-4 mt-1">
            <span className={t.ok ? 'text-green-700' : 'text-red-700'}>{t.ok ? '✓' : '✗'}</span>{' '}
            <span className="text-zayro-gray">
              {t.sheetName}: {t.message}
            </span>
          </div>
        ))}
      </div>
    );

  return (
    <div className="mt-4">
      <button onClick={run} disabled={loading} className="button button-secondary text-sm py-2 px-4">
        {loading ? 'Checking…' : 'Test connection (read-only)'}
      </button>
      {result?.error && <p className="text-xs text-red-700 mt-2">{result.error}</p>}
      {line('Calendar', result?.calendar)}
      {line('Sheets', result?.sheets)}
    </div>
  );
}

export function BookingSyncButton({ bookingId, label = 'Retry sync' }: { bookingId: string; label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const run = async () => {
    setState('running');
    try {
      const response = await fetch(`/api/admin/bookings/${bookingId}/sync`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        setState('error');
        setMessage(data.error || 'Retry failed');
        return;
      }
      const failed = [data.calendar, data.sheets].filter(
        (r: { status: string }) => r.status === 'failed' || r.status === 'not_configured'
      );
      setState(failed.length ? 'error' : 'done');
      setMessage(failed.length ? failed.map((r: { message: string }) => r.message).join(' · ') : 'Synced');
      router.refresh();
    } catch {
      setState('error');
      setMessage('Could not reach the server.');
    }
  };

  return (
    <span className="inline-flex flex-col items-start">
      <button
        onClick={run}
        disabled={state === 'running'}
        className="p-0 text-xs text-zayro-primary font-semibold hover:underline disabled:opacity-50"
      >
        {state === 'running' ? 'Syncing…' : label}
      </button>
      {message && (
        <span className={`text-[11px] max-w-[220px] ${state === 'error' ? 'text-red-700' : 'text-green-700'}`}>{message}</span>
      )}
    </span>
  );
}

export function CancelBookingButton({
  bookingId,
  bookingNumber,
  status,
  paymentStatus,
}: {
  bookingId: string;
  bookingNumber: string;
  status: string;
  paymentStatus: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const run = async () => {
    const paid = paymentStatus === 'succeeded';
    const lines = [
      `Cancel booking ${bookingNumber}?`,
      '',
      '• The booking is marked cancelled and its time slot is released.',
      '• The Google Calendar event is renamed "CANCELLED — …" (not deleted).',
      '• The Google Sheets row is marked cancelled (not deleted).',
      status !== 'confirmed' ? '• Any open Stripe Checkout link for it is expired.' : null,
      paid
        ? '• NO refund is issued. Refund it separately in the Stripe Dashboard if needed.'
        : '• No payment was taken, so nothing needs refunding.',
      '• No email is sent to the customer.',
    ].filter((l) => l !== null);
    if (!window.confirm(lines.join('\n'))) return;

    setState('running');
    try {
      const response = await fetch(`/api/admin/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmBookingId: bookingNumber }),
      });
      const data = await response.json();
      if (!response.ok) {
        setState('error');
        setMessage(data.error || 'Cancel failed');
        return;
      }
      const problems = [data.calendar, data.sheets, data.stripeSession].filter(
        (r: { status: string }) => r.status === 'failed' || r.status === 'not_configured'
      );
      setState(problems.length ? 'error' : 'done');
      setMessage(
        problems.length
          ? `Cancelled, but: ${problems.map((r: { message: string }) => r.message).join(' · ')}`
          : paid
            ? 'Cancelled. Refund in Stripe if needed.'
            : 'Cancelled.'
      );
      router.refresh();
    } catch {
      setState('error');
      setMessage('Could not reach the server.');
    }
  };

  return (
    <span className="inline-flex flex-col items-start">
      <button
        onClick={run}
        disabled={state === 'running' || state === 'done'}
        className="p-0 text-xs text-red-700 font-semibold hover:underline disabled:opacity-50"
      >
        {state === 'running' ? 'Cancelling…' : 'Cancel booking'}
      </button>
      {message && (
        <span className={`text-[11px] max-w-[220px] ${state === 'error' ? 'text-red-700' : 'text-green-700'}`}>{message}</span>
      )}
    </span>
  );
}
