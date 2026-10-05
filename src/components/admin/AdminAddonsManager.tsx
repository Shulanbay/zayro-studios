'use client';

import { useState } from 'react';

export interface AddonRow {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;
  unit: 'session' | 'hour';
  max_quantity: number;
  active: boolean;
  sort_order: number;
}

async function send(method: 'POST' | 'PATCH', body: Record<string, unknown>): Promise<{ row?: AddonRow; error?: string }> {
  try {
    const res = await fetch('/api/admin/addons', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || 'Could not save' };
    return { row: data };
  } catch {
    return { error: 'Network error — nothing was saved' };
  }
}

function AddonLine({ row, onSaved }: { row: AddonRow; onSaved: (row: AddonRow) => void }) {
  const [price, setPrice] = useState((row.price_cents / 100).toFixed(2));
  const [unit, setUnit] = useState(row.unit);
  const [max, setMax] = useState(String(row.max_quantity));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = price !== (row.price_cents / 100).toFixed(2) || unit !== row.unit || max !== String(row.max_quantity);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMessage(null);
    const result = await send('PATCH', { id: row.id, ...body });
    setBusy(false);
    if (result.error) return setMessage(result.error);
    if (result.row) onSaved(result.row);
    setMessage('Saved');
  };

  return (
    <tr className="border-b border-zayro-border last:border-0 align-middle">
      <td className="py-2.5 pr-3">
        <span className="text-zayro-dark font-medium">{row.name}</span>
        {row.description && <div className="text-xs text-zayro-gray">{row.description}</div>}
      </td>
      <td className="py-2.5 pr-3">
        <label className="sr-only" htmlFor={`addon-price-${row.id}`}>
          Price of {row.name} in dollars
        </label>
        <input id={`addon-price-${row.id}`} type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: '6.5rem' }} />
      </td>
      <td className="py-2.5 pr-3">
        <label className="sr-only" htmlFor={`addon-unit-${row.id}`}>
          Charged per
        </label>
        <select id={`addon-unit-${row.id}`} value={unit} onChange={(e) => setUnit(e.target.value as AddonRow['unit'])} style={{ width: '7.5rem' }}>
          <option value="session">per session</option>
          <option value="hour">per hour</option>
        </select>
      </td>
      <td className="py-2.5 pr-3">
        <label className="sr-only" htmlFor={`addon-max-${row.id}`}>
          Maximum quantity of {row.name}
        </label>
        <input id={`addon-max-${row.id}`} type="number" min="1" max="20" step="1" value={max} onChange={(e) => setMax(e.target.value)} style={{ width: '4.5rem' }} />
      </td>
      <td className="py-2.5 pr-3">
        <label className="flex items-center gap-2 text-sm text-zayro-dark">
          <input type="checkbox" style={{ width: 'auto' }} checked={row.active} disabled={busy} onChange={(e) => save({ active: e.target.checked })} />
          Offered
        </label>
      </td>
      <td className="py-2.5 text-right whitespace-nowrap">
        {message && (
          <span className="text-xs text-zayro-gray mr-2" role="status">
            {message}
          </span>
        )}
        <button
          type="button"
          className="crm-btn crm-btn-sm"
          disabled={busy || !dirty}
          onClick={() => save({ price: parseFloat(price), unit, max_quantity: parseInt(max, 10) })}
        >
          Save
        </button>
      </td>
    </tr>
  );
}

/** Extras customers can add while booking. Price edits affect new bookings only. */
export default function AdminAddonsManager({ initialRows }: { initialRows: AddonRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState<AddonRow['unit']>('session');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await send('POST', { name, price: parseFloat(price), unit });
    setBusy(false);
    if (result.error || !result.row) return setError(result.error || 'Could not save');
    setRows((r) => [...r, result.row!]);
    setName('');
    setPrice('');
  };

  return (
    <div className="card">
      <h2 className="text-lg font-bold text-zayro-dark mb-1">Add-ons</h2>
      <p className="text-sm text-zayro-gray mb-4">
        Extras offered with paid podcast sessions during booking. &ldquo;Per hour&rdquo; add-ons are charged for every booked hour.
      </p>
      <div className="crm-table-wrap">
        <table className="crm-table w-full text-sm">
          <thead>
            <tr className="text-left text-zayro-gray">
              <th className="py-2 pr-3 font-semibold">Add-on</th>
              <th className="py-2 pr-3 font-semibold">Price ($)</th>
              <th className="py-2 pr-3 font-semibold">Charged</th>
              <th className="py-2 pr-3 font-semibold">Max qty</th>
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <AddonLine key={row.id} row={row} onSaved={(saved) => setRows((r) => r.map((x) => (x.id === saved.id ? saved : x)))} />
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={create} className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="new-addon-name" className="field-label">
            New add-on
          </label>
          <input id="new-addon-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required placeholder="Name" />
        </div>
        <div>
          <label htmlFor="new-addon-price" className="field-label">
            Price ($)
          </label>
          <input id="new-addon-price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required style={{ width: '7rem' }} />
        </div>
        <div>
          <label htmlFor="new-addon-unit" className="field-label">
            Charged
          </label>
          <select id="new-addon-unit" value={unit} onChange={(e) => setUnit(e.target.value as AddonRow['unit'])}>
            <option value="session">per session</option>
            <option value="hour">per hour</option>
          </select>
        </div>
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy}>
          Add
        </button>
        {error && (
          <p className="field-error w-full" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
