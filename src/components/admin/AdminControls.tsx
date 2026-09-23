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

interface ServiceRow {
  id: number;
  name: string;
  base_price: string;
  duration_minutes: number;
  is_active: boolean;
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

export function AdminServicesManager({ initialRows }: { initialRows: ServiceRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [form, setForm] = useState({ name: '', base_price: '', duration_minutes: '60' });
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState({ base_price: '', duration_minutes: '' });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) return;
    setLoading(true);
    try {
      const response = await fetch('/api/admin/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (response.ok) {
        const created = await response.json();
        setRows((rs) => [...rs, created]);
        setForm({ name: '', base_price: '', duration_minutes: '60' });
      }
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (row: ServiceRow) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, is_active: !r.is_active } : r)));
    await fetch('/api/admin/services', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, is_active: !row.is_active }),
    });
  };

  const startEdit = (row: ServiceRow) => {
    setEditingId(row.id);
    setEditValues({ base_price: row.base_price, duration_minutes: String(row.duration_minutes) });
  };

  const saveEdit = async (row: ServiceRow) => {
    const updated = { ...row, base_price: editValues.base_price, duration_minutes: parseInt(editValues.duration_minutes, 10) };
    setRows((rs) => rs.map((r) => (r.id === row.id ? updated : r)));
    setEditingId(null);
    await fetch('/api/admin/services', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, base_price: editValues.base_price, duration_minutes: editValues.duration_minutes }),
    });
  };

  return (
    <div className="card">
      <h2 className="text-lg font-bold mb-4 text-zayro-dark">Services</h2>
      <table className="w-full text-sm mb-5">
        <thead>
          <tr className="text-left text-zayro-gray border-b border-zayro-border">
            <th className="py-2 font-medium">Name</th>
            <th className="font-medium">Price</th>
            <th className="font-medium">Duration</th>
            <th className="font-medium">Active</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-zayro-border last:border-0">
              <td className="py-2.5 text-zayro-dark">
                {row.name}
                {parseFloat(row.base_price) === 0 && (
                  <span className="chip ml-2" style={{ padding: '0.1rem 0.5rem', fontSize: '0.65rem' }}>
                    Free
                  </span>
                )}
              </td>
              {editingId === row.id ? (
                <>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editValues.base_price}
                      onChange={(e) => setEditValues((v) => ({ ...v, base_price: e.target.value }))}
                      className="text-sm py-1 px-2 w-24"
                      aria-label={`${row.name} price`}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      value={editValues.duration_minutes}
                      onChange={(e) => setEditValues((v) => ({ ...v, duration_minutes: e.target.value }))}
                      className="text-sm py-1 px-2 w-20"
                      aria-label={`${row.name} duration`}
                    />
                  </td>
                </>
              ) : (
                <>
                  <td className="text-zayro-gray">${row.base_price}</td>
                  <td className="text-zayro-gray">{row.duration_minutes}m</td>
                </>
              )}
              <td>
                <input
                  type="checkbox"
                  checked={row.is_active}
                  onChange={() => toggle(row)}
                  aria-label={`${row.name} active`}
                  style={{ width: 'auto' }}
                />
              </td>
              <td>
                {editingId === row.id ? (
                  <button onClick={() => saveEdit(row)} className="text-zayro-primary font-semibold hover:underline">
                    Save
                  </button>
                ) : (
                  <button onClick={() => startEdit(row)} className="text-zayro-gray hover:text-zayro-primary hover:underline">
                    Edit
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Service name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="text-sm py-2 px-2 flex-1 min-w-[140px]"
          aria-label="New service name"
        />
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Price ($)"
          value={form.base_price}
          onChange={(e) => setForm((f) => ({ ...f, base_price: e.target.value }))}
          className="text-sm py-2 px-2 w-28"
          aria-label="New service price"
        />
        <input
          type="number"
          min="1"
          placeholder="Minutes"
          value={form.duration_minutes}
          onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
          className="text-sm py-2 px-2 w-24"
          aria-label="New service duration in minutes"
        />
        <button type="submit" disabled={loading} className="button button-primary text-sm py-2 px-4">
          Add Service
        </button>
      </form>
      <p className="text-xs text-zayro-gray mt-3">
        Set price to $0 to create a free (no-Stripe) service — useful for testing the free-booking flow. Deactivate
        it afterward if it shouldn't stay publicly bookable.
      </p>
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
