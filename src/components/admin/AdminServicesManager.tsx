'use client';

import { Fragment, useId, useState } from 'react';
import { PACKAGE_TYPES, PACKAGE_TYPE_LABELS, SERVICE_CATEGORIES, computePackagePricing, sortServices, type CatalogService } from '@/lib/catalog';
import { decimalToCents } from '@/lib/crm/money';
import { useI18n } from '@/components/crm/i18n';
import { useApiMessage } from '@/components/crm/client';

/** Catalog price ("150.00") in the admin's language; data currency (USD) kept. */
function usePrice() {
  const { t, f } = useI18n();
  return (value: string | number) => {
    const cents = decimalToCents(value);
    return cents === 0 ? t('services.free') : cents % 100 === 0 ? f.moneyWhole(cents) : f.money(cents);
  };
}

function useDuration() {
  const { t } = useI18n();
  return (minutes: number) => {
    if (minutes < 60) return t('services.minutes', { count: minutes });
    const h = t('services.hours', { count: Math.floor(minutes / 60) });
    return minutes % 60 ? t('services.hoursMinutes', { hours: h, minutes: minutes % 60 }) : h;
  };
}

export type AdminServiceRow = CatalogService;

const FILTERS = [{ id: 'all' }, { id: 'podcast' }, { id: 'photography' }, { id: 'tour' }, { id: 'package' }, { id: 'other' }] as const;

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
  visible_in_booking: boolean;
  quote_only: boolean;
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
    visible_in_booking: row?.visible_in_booking ?? true,
    quote_only: row?.quote_only ?? false,
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
    visible_in_booking: form.visible_in_booking,
    quote_only: form.quote_only,
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
  const { t, label } = useI18n();
  const formatPrice = usePrice();
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
        <label htmlFor={`${id}-name`} className="field-label">{t('services.form.name')}</label>
        <input id={`${id}-name`} value={form.name} onChange={(e) => set('name', e.target.value)} required />
      </div>
      <div className="md:col-span-2">
        <label htmlFor={`${id}-description`} className="field-label">{t('services.form.description')}</label>
        <textarea id={`${id}-description`} className="h-20" value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div>
        <label htmlFor={`${id}-category`} className="field-label">{t('services.form.category')}</label>
        <select id={`${id}-category`} value={form.category} onChange={(e) => set('category', e.target.value)}>
          {SERVICE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {label(c)} ({c})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-price`} className="field-label">{isPackage ? t('services.form.packagePrice') : t('services.form.price')}</label>
        <input id={`${id}-price`} type="number" step="0.01" min="0" value={form.base_price} onChange={(e) => set('base_price', e.target.value)} required />
      </div>
      <div>
        <label htmlFor={`${id}-duration`} className="field-label">
          {isPackage ? t('services.form.sessionLength') : t('services.form.duration')}
        </label>
        <input id={`${id}-duration`} type="number" min="15" max="720" step="15" value={form.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} required />
      </div>
      <div>
        <label htmlFor={`${id}-order`} className="field-label">{t('services.form.order')}</label>
        <input id={`${id}-order`} type="number" value={form.display_order} onChange={(e) => set('display_order', e.target.value)} />
      </div>
      <div>
        <label htmlFor={`${id}-badge`} className="field-label">{t('services.form.badge')}</label>
        <input id={`${id}-badge`} maxLength={40} placeholder={t('services.form.badgePlaceholder')} value={form.badge} onChange={(e) => set('badge', e.target.value)} />
      </div>
      <fieldset className="md:col-span-2 flex flex-wrap items-center gap-x-6 gap-y-3 pb-2">
        <legend className="field-label">{t('services.form.visibility')}</legend>
        <label className="flex items-center gap-2 text-sm text-zayro-dark">
          <input type="checkbox" style={{ width: 'auto' }} checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          {t('services.form.active')}
        </label>
        {!isPackage && (
          <label className="flex items-center gap-2 text-sm text-zayro-dark">
            <input type="checkbox" style={{ width: 'auto' }} checked={form.visible_in_booking} onChange={(e) => set('visible_in_booking', e.target.checked)} />
            {t('services.form.bookable')}
          </label>
        )}
        {!isPackage && (
          <label className="flex items-center gap-2 text-sm text-zayro-dark">
            <input type="checkbox" style={{ width: 'auto' }} checked={form.quote_only} onChange={(e) => set('quote_only', e.target.checked)} />
            {t('services.form.quoteOnly')}
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-zayro-dark">
          <input type="checkbox" style={{ width: 'auto' }} checked={form.is_featured} onChange={(e) => set('is_featured', e.target.checked)} />
          {t('services.form.featured')}
        </label>
      </fieldset>
      <div className="md:col-span-2">
        <label htmlFor={`${id}-features`} className="field-label">{t('services.form.features')}</label>
        <textarea id={`${id}-features`} className="h-32" value={form.features} onChange={(e) => set('features', e.target.value)} />
      </div>

      {isPackage && (
        <fieldset className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 border border-zayro-border rounded-lg p-4">
          <legend className="text-sm font-bold text-zayro-dark px-1">{t('services.form.monthly')}</legend>
          <div>
            <label htmlFor={`${id}-ptype`} className="field-label">{t('services.form.packageType')}</label>
            <select id={`${id}-ptype`} value={form.package_type} onChange={(e) => set('package_type', e.target.value)} required>
              <option value="">{t('services.form.choose')}</option>
              {PACKAGE_TYPES.map((p) => (
                <option key={p} value={p}>
                  {t.dynamic(`services.packageTypes.${p}`, PACKAGE_TYPE_LABELS[p])}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-base`} className="field-label">{t('services.form.pricedFrom')}</label>
            <select id={`${id}-base`} value={form.package_base_service_id} onChange={(e) => set('package_base_service_id', e.target.value)}>
              <option value="">{t('services.form.none')}</option>
              {baseOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({formatPrice(s.base_price)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-sessions`} className="field-label">{t('services.form.sessions')}</label>
            <input id={`${id}-sessions`} type="number" min="1" max="50" value={form.session_count} onChange={(e) => set('session_count', e.target.value)} required />
          </div>
          <div>
            <label htmlFor={`${id}-validity`} className="field-label">{t('services.form.validity')}</label>
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
          {saving ? t('services.form.saving') : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="button button-ghost text-sm py-2 px-4">
            {t('common.actions.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}

export default function AdminServicesManager({ initialRows }: { initialRows: AdminServiceRow[] }) {
  const { t, label } = useI18n();
  const apiMessage = useApiMessage();
  const formatPrice = usePrice();
  const formatDuration = useDuration();
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
      if (!response.ok) return data.error ? apiMessage(data.error, response.status) : t('services.saveFailed');
      setRows((rs) => sortServices(method === 'POST' ? [...rs, data] : rs.map((r) => (r.id === data.id ? data : r))));
      setEditingId(null);
      return null;
    } catch {
      return t('services.unreachable');
    }
  };

  const toggleActive = async (row: AdminServiceRow) => {
    await save('PATCH', { id: row.id, is_active: !row.is_active });
  };

  const defaultNewCategory = filter === 'all' || filter === 'other' ? 'podcast' : filter;

  return (
    <div className="card">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-zayro-dark">{t('services.title')}</h2>
        <button
          type="button"
          onClick={() => setEditingId(editingId === 'new' ? null : 'new')}
          className="button button-secondary text-sm py-2 px-4"
        >
          {editingId === 'new' ? t('services.close') : t('services.add')}
        </button>
      </div>

      <div role="group" aria-label={t('services.filterLabel')} className="flex flex-wrap gap-2 mb-5">
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
              {t(`services.filters.${f.id}`)} ({count})
            </button>
          );
        })}
      </div>

      {editingId === 'new' && (
        <div className="border border-zayro-border rounded-lg p-4 mb-5">
          <h3 className="text-sm font-bold text-zayro-dark mb-3">{t('services.newService')}</h3>
          <ServiceForm
            initial={toForm(undefined, defaultNewCategory)}
            baseOptions={baseOptions}
            submitLabel={t('services.create')}
            onSubmit={(form) => save('POST', toPayload(form))}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-zayro-gray border-b border-zayro-border">
              <th className="py-2 font-medium">{t('services.cols.order')}</th>
              <th className="font-medium">{t('services.cols.name')}</th>
              <th className="font-medium">{t('services.cols.category')}</th>
              <th className="font-medium">{t('services.cols.price')}</th>
              <th className="font-medium">{t('services.cols.duration')}</th>
              <th className="font-medium">{t('services.cols.active')}</th>
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
                    {row.is_featured && <span className="text-xs text-zayro-primary ml-2">{t('services.featured')}</span>}
                    {row.category !== 'package' && (row.quote_only || row.visible_in_booking === false) && (
                      <span className="text-xs text-zayro-gray ml-2">{row.quote_only ? t('services.quoteOnly') : t('services.notBookable')}</span>
                    )}
                  </td>
                  <td className="py-2.5 text-zayro-gray">{label(row.category)}</td>
                  <td className="py-2.5 text-zayro-dark">
                    {formatPrice(row.base_price)}
                    {pkg?.discountPercent ? (
                      <div className="text-xs text-green-700">
                        {t('services.discount', { percent: pkg.discountPercent, price: formatPrice(pkg.regularPrice!) })}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2.5 text-zayro-gray">
                    {pkg ? t('services.packageSummary', { sessions: pkg.sessions, days: pkg.validityDays }) : formatDuration(row.duration_minutes)}
                  </td>
                  <td className="py-2.5">
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={() => toggleActive(row)}
                      aria-label={t('services.activeLabel', { name: row.name })}
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
                        {t('common.actions.edit')}
                      </button>
                    )}
                  </td>
                </tr>
                {editingId === row.id && (
                  <tr className="border-b border-zayro-border bg-zayro-bg">
                    <td colSpan={7} className="p-4">
                      <h3 className="text-sm font-bold text-zayro-dark mb-3">{t('services.editTitle', { name: row.name })}</h3>
                      <ServiceForm
                        initial={toForm(row)}
                        baseOptions={baseOptions.filter((b) => b.id !== row.id)}
                        submitLabel={t('common.actions.saveChanges')}
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
                  {t('services.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zayro-gray mt-3">
        {t('services.footnote')}
      </p>
    </div>
  );
}
