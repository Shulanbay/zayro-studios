'use client';

import { useState } from 'react';
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
      className="text-sm text-zayro-gray hover:text-zayro-dark underline"
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
    <div className="bg-white border border-zayro-bg p-6">
      <h2 className="text-xl font-bold mb-4">Business Hours</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zayro-gray border-b border-zayro-bg">
            <th className="py-2">Day</th>
            <th>Start</th>
            <th>End</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-zayro-bg last:border-0">
              <td className="py-2 font-medium">{row.day_of_week}</td>
              <td>
                <input
                  type="time"
                  defaultValue={row.start_time}
                  onBlur={(e) => e.target.value !== row.start_time && update(row, { start_time: e.target.value })}
                  className="border border-zayro-bg p-1"
                />
              </td>
              <td>
                <input
                  type="time"
                  defaultValue={row.end_time}
                  onBlur={(e) => e.target.value !== row.end_time && update(row, { end_time: e.target.value })}
                  className="border border-zayro-bg p-1"
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={row.is_available}
                  disabled={savingId === row.id}
                  onChange={(e) => update(row, { is_available: e.target.checked })}
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
    <div className="bg-white border border-zayro-bg p-6">
      <h2 className="text-xl font-bold mb-4">Blocked Times</h2>
      <form onSubmit={add} className="flex flex-wrap gap-2 mb-4">
        <input
          type="datetime-local"
          value={form.start}
          onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
          className="border border-zayro-bg p-2 text-sm"
          required
        />
        <input
          type="datetime-local"
          value={form.end}
          onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
          className="border border-zayro-bg p-2 text-sm"
          required
        />
        <input
          type="text"
          placeholder="Reason (optional)"
          value={form.reason}
          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          className="border border-zayro-bg p-2 text-sm flex-1 min-w-[140px]"
        />
        <button type="submit" disabled={loading} className="button button-primary px-4 text-sm disabled:opacity-50">
          Add
        </button>
      </form>
      <ul className="space-y-2 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex justify-between items-center border-b border-zayro-bg pb-2">
            <span>
              {new Date(row.start_datetime).toLocaleString()} → {new Date(row.end_datetime).toLocaleString()}
              {row.reason ? ` — ${row.reason}` : ''}
            </span>
            <button onClick={() => remove(row.id)} className="text-red-600 hover:underline">
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

  return (
    <div className="bg-white border border-zayro-bg p-6">
      <h2 className="text-xl font-bold mb-4">Services</h2>
      <table className="w-full text-sm mb-4">
        <thead>
          <tr className="text-left text-zayro-gray border-b border-zayro-bg">
            <th className="py-2">Name</th>
            <th>Price</th>
            <th>Duration</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-zayro-bg last:border-0">
              <td className="py-2">{row.name}</td>
              <td>${row.base_price}</td>
              <td>{row.duration_minutes}m</td>
              <td>
                <input type="checkbox" checked={row.is_active} onChange={() => toggle(row)} />
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
          className="border border-zayro-bg p-2 text-sm flex-1 min-w-[140px]"
        />
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Price ($)"
          value={form.base_price}
          onChange={(e) => setForm((f) => ({ ...f, base_price: e.target.value }))}
          className="border border-zayro-bg p-2 text-sm w-28"
        />
        <input
          type="number"
          min="1"
          placeholder="Minutes"
          value={form.duration_minutes}
          onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
          className="border border-zayro-bg p-2 text-sm w-24"
        />
        <button type="submit" disabled={loading} className="button button-primary px-4 text-sm disabled:opacity-50">
          Add Service
        </button>
      </form>
    </div>
  );
}
