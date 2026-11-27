'use client';

/**
 * Lead pipeline board (HubSpot-style): drag a card to another column, or use
 * the status menu on the card (keyboard and touch friendly). Changes are
 * saved immediately and written to the lead's timeline.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { callApi, useApiMessage, useToast } from '@/components/crm/client';
import { useI18n } from '@/components/crm/i18n';
import { STATUS_COLORS } from './Bits';

export interface BoardLead {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  platform: string;
  utm_source: string | null;
  utm_campaign: string | null;
  landing_page_slug: string | null;
  contact_method: string;
  revenue_cents: number;
  created_at: string;
}

const STATUSES = ['new', 'in_progress', 'booked', 'paid', 'rejected'] as const;

export default function LeadBoard({ leads, canEdit }: { leads: BoardLead[]; canEdit: boolean }) {
  const { t, f, label } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const apiMessage = useApiMessage();
  const [items, setItems] = useState(leads);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const move = async (id: number, status: string) => {
    const before = items.find((l) => l.id === id);
    if (!before || before.status === status) return;
    setItems((list) => list.map((l) => (l.id === id ? { ...l, status } : l)));
    const res = await callApi(`/api/admin/leads/${id}`, 'PATCH', { status });
    if (!res.ok) {
      setItems((list) => list.map((l) => (l.id === id ? before : l)));
      toast('error', apiMessage(res.data?.error, res.status));
      return;
    }
    toast('success', t('marketing.leads.moved', { id, status: t.dynamic(`marketing.status.${status}`, status) }));
    router.refresh();
  };

  return (
    <div className="crm-table-wrap -mx-1 px-1 pb-2">
      <div className="grid grid-flow-col auto-cols-[minmax(250px,1fr)] gap-3 min-w-full">
        {STATUSES.map((s) => {
          const col = items.filter((l) => l.status === s);
          const sum = col.reduce((a, l) => a + l.revenue_cents, 0);
          return (
            <section
              key={s}
              aria-label={t(`marketing.status.${s}`)}
              className={`rounded-2xl border bg-white/70 p-2 min-h-[240px] transition-colors ${over === s ? 'border-zayro-primary bg-blue-50/40' : 'border-zayro-border'}`}
              onDragOver={(e) => {
                if (!canEdit || dragging === null) return;
                e.preventDefault();
                setOver(s);
              }}
              onDragLeave={() => setOver((o) => (o === s ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                if (dragging !== null) void move(dragging, s);
                setDragging(null);
              }}
            >
              <header className="flex items-center justify-between gap-2 px-2 py-1.5">
                <span className={`crm-badge ${STATUS_COLORS[s]}`}>{t(`marketing.status.${s}`)}</span>
                <span className="text-xs text-zayro-gray tabular-nums">
                  {f.number(col.length)}
                  {sum > 0 ? ` · ${f.money(sum)}` : ''}
                </span>
              </header>
              <ol className="grid gap-2 mt-1">
                {col.length === 0 && <li className="text-xs text-zayro-gray px-2 py-6 text-center">{t('marketing.leads.emptyColumn')}</li>}
                {col.map((l) => (
                  <li
                    key={l.id}
                    draggable={canEdit}
                    onDragStart={() => setDragging(l.id)}
                    onDragEnd={() => setDragging(null)}
                    className={`rounded-xl border border-zayro-border bg-white p-3 shadow-sm ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging === l.id ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/admin/leads/${l.id}`} className="font-semibold text-zayro-dark min-w-0 break-words hover:text-zayro-primary">
                        {l.name || l.phone || l.email || t('marketing.leads.noName')}
                      </Link>
                      <span className="text-[11px] text-zayro-gray shrink-0">#{l.id}</span>
                    </div>
                    <p className="text-xs text-zayro-gray mt-0.5 break-words">
                      {t.dynamic(`analytics.platforms.${l.platform}`, l.platform)}
                      {l.utm_campaign ? ` · ${l.utm_campaign}` : ''}
                    </p>
                    <p className="text-xs text-zayro-gray break-words">
                      {label(l.contact_method)}
                      {l.landing_page_slug ? ` · /${l.landing_page_slug}` : ''} · {f.instantDate(l.created_at)}
                    </p>
                    {l.revenue_cents > 0 && <p className="text-xs font-semibold text-emerald-700 mt-1">{f.money(l.revenue_cents)}</p>}
                    {canEdit && (
                      <label className="block mt-2">
                        <span className="sr-only">{t('marketing.leads.moveTo')}</span>
                        <select value={l.status} onChange={(e) => void move(l.id, e.target.value)} className="!py-1 !text-xs !min-h-0">
                          {STATUSES.map((x) => (
                            <option key={x} value={x}>
                              {t(`marketing.status.${x}`)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
