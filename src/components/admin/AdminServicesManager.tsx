'use client';

import { Fragment, useId, useState } from 'react';
import {
  CATEGORY_LABELS,
  PACKAGE_TYPES,
  PACKAGE_TYPE_LABELS,
  SERVICE_CATEGORIES,
  computePackagePricing,
  formatDuration,
  formatPrice,
  sortServices,
  type CatalogService,
} from '@/lib/catalog';

export type AdminServiceRow = CatalogService;

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'podcast', label: 'Podcast' },
  { id: 'photography', label: 'Photography' },
  { id: 'tour', label: 'Tours' },
  { id: 'package', label: 'Monthly Packages' },
  { id: 'other', label: 'Other' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

function matchesFilter(row: AdminServiceRow, filter: FilterId) {
  if (filter === 'all') return true;
  if (filter === 'other') return !['podcast', 'photography', 'tour', 'package'].includes(row.category);
  return row.category === filter;
}

interface FormState {
  name: string;
  description: string;
  base_price: string;
  duration_minutes: string;
  category: string;
  features: string;
  badge: string;
  display_order: string;
  is_featured: boolean;
  is_active: boolean;
  session_count: string;
  validity_days: string;
  package_type: string;
  package_base_service_id: string;
}

function toForm(row?: AdminServiceRow, defaultCategory = 'podcast'): FormState {
  return {
    name: row?.name ?? '',
    description: row?.description ?? '',
    base_price: row?.base_price ?? '',
    duration_minutes: String(row?.duration_minutes ?? 60),
    category: row?.category ?? defaultCategory,
    features: (row?.features ?? []).join('\n'),
    badge: row?.badge ?? '',
    display_order: String(row?.display_order ?? 0),
    is_featured: row?.is_featured ?? false,
    is_active: row?.is_active ?? true,
    session_count: row?.session_count ? String(row.session_count) : '',
    validity_days: row?.validity_days ? String(row.validity_days) : '30',
    package_type: row?.package_type ?? '',
    package_base_service_id: row?.package_base_service_id ? String(row.package_base_service_id) : '',
  };
}

function toPayload(form: FormState) {
  const payload: Record<string, unknown> = {
    name: form.name,
    description: form.description,
    base_price: form.base_price,
    duration_minutes: form.duration_minutes,
    category: form.category,
    features: form.features,
    badge: form.badge,
    display_order: form.display_order || '0',
    is_featured: form.is_featured,
    is_active: form.is_active,
  };
  if (form.category === 'package') {
    payload.session_count = form.session_count;
    payload.validity_days = form.validity_days;
    payload.package_type = form.package_type;
    payload.package_base_service_id = form.package_base_service_id;
  }
  return payload;
}

function ServiceForm({
  initial,
  baseOptions,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: FormState;
  baseOptions: AdminServiceRow[];
  submitLabel: string;
  onSubmit: (form: FormState) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const id = useId();
  const isPackage = form.category === 'package';

  return (
    <form
      className="grid grid-cols-1 md:grid-cols-2 gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        const err = await onSubmit(form);
        setSaving(false);
        if (err) setError(err);
      }}
    >
      <div className="md:col-span-2">
        <label htmlFor={`${id}-name`} className="field-label">Name</label>
        <input id={`${id}-name`} value={form.name} onChange={(e) => set('name', e.target.value)} required />
      </div>
      <div className="md:col-span-2">
        <label htmlFor={`${id}-description`} className="field-label">Description</label>
        <textarea id={`${id}-description`} className="h-20" value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div>
        <label htmlFor={`${id}-category`} className="field-label">Category</label>
        <select id={`${id}-category`} value={form.category} onChange={(e) => set('category', e.target.value)}>
          {SERVICE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]} ({c})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-price`} className="field-label">{isPackage ? 'Package price ($)' : 'Price ($)'}</label>
        <input id={`${id}-price`} type="number" step="0.01" min="0" value={form.base_price} onChange={(e) => set('base_price', e.target.value)} required />
      </div>
      <div>
        <label htmlFor={`${id}-duration`} className="field-label">
          {isPackage ? 'Session length (minutes)' : 'Duration (minutes)'}
        </label>
        <input id={`${id}-duration`} type="number" min="15" max="720" step="15" value={form.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} required />
      </div>
      <div>
        <label htmlFor={`${id}-order`} className="field-label">Display order</label>
        <input id={`${id}-order`} type="number" value={form.display_order} onChange={(e) => set('display_order', e.target.value)} />
      </div>
      <div>
        <label htmlFor={`${id}-badge`} className="field-label">Badge (optional)</label>
        <input id={`${id}-badge`} maxLength={40} placeholder="Most Popular" value={form.badge} onChange={(e) => set('badge', e.target.value)} />
      </div>
      <div className="flex items-end gap-6 pb-2">
        <label className="flex items-center gap-2 text-sm text-zayro-dark">
          <input type="checkbox" style={{ width: 'auto' }} checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Active (bookable / visible)
        </label>
        <label className="flex items-center gap-2 text-sm text-zayro-dark">
          <input type="checkbox" style={{ width: 'auto' }} checked={form.is_featured} onChange={(e) => set('is_featured', e.target.checked)} />
          Featured
        </label>
      </div>
      <div className="md:col-span-2">
        <label htmlFor={`${id}-features`} className="field-label">Features (one per line)</label>
        <textarea id={`${id}-features`} className="h-32" value={form.features} onChange={(e) => set('features', e.target.value)} />
      </div>

      {isPackage && (
        <fieldset className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 border border-zayro-border rounded-lg p-4">
          <legend className="text-sm font-bold text-zayro-dark px-1">Monthly package</legend>
          <div>
            <label htmlFor={`${id}-ptype`} className="field-label">Package type</label>
            <select id={`${id}-ptype`} value={form.package_type} onChange={(e) => set('package_type', e.target.value)} required>
              <option value="">Choose…</option>
              {PACKAGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PACKAGE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-base`} className="field-label">Priced from (base session)</label>
            <select id={`${id}-base`} value={form.package_base_service_id} onChange={(e) => set('package_base_service_id', e.target.value)}>
              <option value="">None</option>
              {baseOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({formatPrice(s.base_price)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-sessions`} className="field-label">Sessions included</label>
            <input id={`${id}-sessions`} type="number" min="1" max="50" value={form.session_count} onChange={(e) => set('session_count', e.target.value)} required />
          </div>
          <div>
            <label htmlFor={`${id}-validity`} className="field-label">Valid for (days from start date)</label>
            <input id={`${id}-validity`} type="number" min="1" max="365" value={form.validity_days} onChange={(e) => set('validity_days', e.target.value)} required />
          </div>
        </fieldset>
      )}

      {error && (
        <p className="field-error md:col-span-2" role="alert">
          {error}
        </p>
      )}
      <div className="md:col-span-2 flex flex-wrap gap-3">
        <button type="submit" disabled={saving} className="button button-primary text-sm py-2 px-5">
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="button button-ghost text-sm py-2 px-4">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default function AdminServicesManager({ initialRows }: { initialRows: AdminServiceRow[] }) {
  const [rows, setRows] = useState(() => sortServices(initialRows));
  const [filter, setFilter] = useState<FilterId>('all');
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);

  const baseOptions = rows.filter((r) => r.category !== 'package');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const visible = rows.filter((r) => matchesFilter(r, filter));

  const save = async (method: 'POST' | 'PATCH', payload: Record<string, unknown>): Promise<string | null> => {
    try {
      const response = await fetch('/api/admin/services', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) return data.error || 'Save failed';
      setRows((rs) => sortServices(method === 'POST' ? [...rs, data] : rs.map((r) => (r.id === data.id ? data : r))));
      setEditingId(null);
      return null;
    } catch {
      return 'Could not reach the server';
    }
  };

  const toggleActive = async (row: AdminServiceRow) => {
    await save('PATCH', { id: row.id, is_active: !row.is_active });
  };

  const defaultNewCategory = filter === 'all' || filter === 'other' ? 'podcast' : filter;

  return (
    <div className="card">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-zayro-dark">Services &amp; Pricing</h2>
        <button
          type="button"
          onClick={() => setEditingId(editingId === 'new' ? null : 'new')}
          className="button button-secondary text-sm py-2 px-4"
        >
          {editingId === 'new' ? 'Close' : '+ Add service'}
        </button>
      </div>

      <div role="group" aria-label="Filter services by category" className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => {
          const count = rows.filter((r) => matchesFilter(r, f.id)).length;
          if (f.id === 'other' && count === 0) return null;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`text-sm px-3 py-1.5 rounded-full border ${
                filter === f.id ? 'bg-zayro-dark text-white border-zayro-dark' : 'border-zayro-border text-zayro-gray hover:text-zayro-dark'
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      {editingId === 'new' && (
        <div className="border border-zayro-border rounded-lg p-4 mb-5">
          <h3 className="text-sm font-bold text-zayro-dark mb-3">New service</h3>
          <ServiceForm
            initial={toForm(undefined, defaultNewCategory)}
            baseOptions={baseOptions}
            submitLabel="Create service"
            onSubmit={(form) => save('POST', toPayload(form))}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-zayro-gray border-b border-zayro-border">
              <th className="py-2 font-medium">Order</th>
              <th className="font-medium">Name</th>
              <th className="font-medium">Category</th>
              <th className="font-medium">Price</th>
              <th className="font-medium">Duration / Sessions</th>
              <th className="font-medium">Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const pkg =
                row.category === 'package'
                  ? computePackagePricing(row, byId.get(row.package_base_service_id ?? -1) ?? null)
                  : null;
              return (
                <Fragment key={row.id}>
                <tr className="border-b border-zayro-border last:border-0 align-top">
                  <td className="py-2.5 text-zayro-gray">{row.display_order}</td>
                  <td className="py-2.5 pr-3">
                    <span className="text-zayro-dark font-medium">{row.name}</span>
                    {row.badge && <span className="chip ml-2">{row.badge}</span>}
                    {row.is_featured && <span className="text-xs text-zayro-primary ml-2">featured</span>}
                  </td>
                  <td className="py-2.5 text-zayro-gray">{CATEGORY_LABELS[row.category as keyof typeof CATEGORY_LABELS] ?? row.category}</td>
                  <td className="py-2.5 text-zayro-dark">
                    {formatPrice(row.base_price)}
                    {pkg?.discountPercent ? (
                      <div className="text-xs text-green-700">
                        {pkg.discountPercent}% off {formatPrice(pkg.regularPrice!)}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2.5 text-zayro-gray">
                    {pkg ? `${pkg.sessions} sessions · ${pkg.validityDays} days` : formatDuration(row.duration_minutes)}
                  </td>
                  <td className="py-2.5">
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={() => toggleActive(row)}
                      aria-label={`${row.name} active`}
                      style={{ width: 'auto' }}
                    />
                  </td>
                  <td className="py-2.5 text-right">
                    {editingId !== row.id && (
                      <button
                        type="button"
                        onClick={() => setEditingId(row.id)}
                        className="text-zayro-primary font-semibold hover:underline"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
                {editingId === row.id && (
                  <tr className="border-b border-zayro-border bg-zayro-bg">
                    <td colSpan={7} className="p-4">
                      <h3 className="text-sm font-bold text-zayro-dark mb-3">Edit {row.name}</h3>
                      <ServiceForm
                        initial={toForm(row)}
                        baseOptions={baseOptions.filter((b) => b.id !== row.id)}
                        submitLabel="Save changes"
                        onSubmit={(form) => save('PATCH', { id: row.id, ...toPayload(form) })}
                        onCancel={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-zayro-gray">
                  No services in this category.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zayro-gray mt-3">
        Inactive services are hidden from the pricing and booking pages. Only category <strong>tour</strong> goes to
        the &quot;Studio Tours&quot; sheet; monthly packages are requested via the contact form and never take a time slot.
      </p>
    </div>
  );
}
