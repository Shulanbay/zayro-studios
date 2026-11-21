'use client';

import { useState } from 'react';
import { useI18n } from '@/components/crm/i18n';
import { useApiMessage } from '@/components/crm/client';

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

/** Errors come back as English API text (`error`) or a local marker, translated where shown. */
async function send(method: 'POST' | 'PATCH', body: Record<string, unknown>): Promise<{ row?: AddonRow; error?: string; status?: number; network?: boolean }> {
  try {
    const res = await fetch('/api/admin/addons', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || '', status: res.status };
    return { row: data };
  } catch {
    return { error: '', network: true };
  }
}

function useErrorText() {
  const { t } = useI18n();
  const apiMessage = useApiMessage();
  return (r: { error?: string; network?: boolean }) => (r.network ? t('services.addons.network') : r.error ? apiMessage(r.error) : t('services.addons.saveFailed'));
}

function AddonLine({ row, onSaved }: { row: AddonRow; onSaved: (row: AddonRow) => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
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
    if (result.error !== undefined) return setMessage(errorText(result));
    if (result.row) onSaved(result.row);
    setMessage(t('services.addons.saved'));
  };

  return (
    <tr className="border-b border-zayro-border last:border-0 align-middle">
      <td className="py-2.5 pr-3">
        <span className="text-zayro-dark font-medium">{row.name}</span>
        {row.description && <div className="text-xs text-zayro-gray">{row.description}</div>}
      </td>
      <td className="py-2.5 pr-3">
        <label className="sr-only" htmlFor={`addon-price-${row.id}`}>
          {t('services.addons.priceOf', { name: row.name })}
        </label>
        <input id={`addon-price-${row.id}`} type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: '6.5rem' }} />
      </td>
      <td className="py-2.5 pr-3">
        <label className="sr-only" htmlFor={`addon-unit-${row.id}`}>
          {t('services.addons.chargedPer')}
        </label>
        <select id={`addon-unit-${row.id}`} value={unit} onChange={(e) => setUnit(e.target.value as AddonRow['unit'])} style={{ width: '9rem' }}>
          <option value="session">{t('services.addons.perSession')}</option>
          <option value="hour">{t('services.addons.perHour')}</option>
        </select>
      </td>
      <td className="py-2.5 pr-3">
        <label className="sr-only" htmlFor={`addon-max-${row.id}`}>
          {t('services.addons.maxOf', { name: row.name })}
        </label>
        <input id={`addon-max-${row.id}`} type="number" min="1" max="20" step="1" value={max} onChange={(e) => setMax(e.target.value)} style={{ width: '4.5rem' }} />
      </td>
      <td className="py-2.5 pr-3">
        <label className="flex items-center gap-2 text-sm text-zayro-dark">
          <input type="checkbox" style={{ width: 'auto' }} checked={row.active} disabled={busy} onChange={(e) => save({ active: e.target.checked })} />
          {t('services.addons.offered')}
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
          {t('common.actions.save')}
        </button>
      </td>
    </tr>
  );
}

/** Extras customers can add while booking. Price edits affect new bookings only. */
export default function AdminAddonsManager({ initialRows }: { initialRows: AddonRow[] }) {
  const { t } = useI18n();
  const errorText = useErrorText();
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
    if (result.error !== undefined || !result.row) return setError(errorText(result));
    setRows((r) => [...r, result.row!]);
    setName('');
    setPrice('');
  };

  return (
    <div className="card">
      <h2 className="text-lg font-bold text-zayro-dark mb-1">{t('services.addons.title')}</h2>
      <p className="text-sm text-zayro-gray mb-4">{t('services.addons.intro')}</p>
      <div className="crm-table-wrap">
        <table className="crm-table w-full text-sm">
          <thead>
            <tr className="text-left text-zayro-gray">
              {(['addon', 'price', 'charged', 'max', 'status'] as const).map((c) => (
                <th key={c} className="py-2 pr-3 font-semibold">
                  {t(`services.addons.cols.${c}`)}
                </th>
              ))}
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
            {t('services.addons.newAddon')}
          </label>
          <input id="new-addon-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required placeholder={t('services.addons.namePlaceholder')} />
        </div>
        <div>
          <label htmlFor="new-addon-price" className="field-label">
            {t('services.addons.cols.price')}
          </label>
          <input id="new-addon-price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required style={{ width: '7rem' }} />
        </div>
        <div>
          <label htmlFor="new-addon-unit" className="field-label">
            {t('services.addons.cols.charged')}
          </label>
          <select id="new-addon-unit" value={unit} onChange={(e) => setUnit(e.target.value as AddonRow['unit'])}>
            <option value="session">{t('services.addons.perSession')}</option>
            <option value="hour">{t('services.addons.perHour')}</option>
          </select>
        </div>
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy}>
          {t('services.addons.add')}
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
