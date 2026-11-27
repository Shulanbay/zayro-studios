'use client';

/**
 * Landing-page builder: blocks on the left, the selected block's settings on
 * the right, SEO and per-page tracking code in their own tabs. Validated with
 * the same zod schema as the server before saving.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton, callApi, useApiMessage, useToast } from '@/components/crm/client';
import { useI18n } from '@/components/crm/i18n';
import { BLOCK_TYPES, contentBlocks, emptyBlock, newBlockId, type BlockType, type ContentBlock } from '@/lib/marketing/blocks';
import CodeField from './CodeField';

export interface EditorPage {
  id: string;
  slug: string;
  title: string;
  meta_description: string;
  og_image_url: string;
  noindex: boolean;
  is_published: boolean;
  content_blocks: ContentBlock[];
  head_scripts: string;
  body_scripts: string;
  scripts_consent: 'necessary' | 'analytics' | 'advertising';
}

type Kind = 'text' | 'textarea' | 'image' | 'href' | 'select' | 'checkbox' | 'cta' | 'lines' | 'services' | 'video';
interface FieldDef {
  key: string;
  kind: Kind;
  options?: string[];
  showIf?: (b: Record<string, unknown>) => boolean;
}
interface ListDef {
  key: string;
  fields: FieldDef[];
  showIf?: (b: Record<string, unknown>) => boolean;
}

const FIELDS: Record<BlockType, { fields: FieldDef[]; list?: ListDef }> = {
  hero: {
    fields: [
      { key: 'eyebrow', kind: 'text' },
      { key: 'heading', kind: 'text' },
      { key: 'subheading', kind: 'textarea' },
      { key: 'primary', kind: 'cta' },
      { key: 'secondary', kind: 'cta' },
      { key: 'image', kind: 'image' },
      { key: 'imageAlt', kind: 'text' },
      { key: 'theme', kind: 'select', options: ['dark', 'light'] },
    ],
  },
  features: { fields: [{ key: 'heading', kind: 'text' }, { key: 'subheading', kind: 'textarea' }], list: { key: 'items', fields: [{ key: 'title', kind: 'text' }, { key: 'body', kind: 'textarea' }] } },
  packages: {
    fields: [
      { key: 'heading', kind: 'text' },
      { key: 'subheading', kind: 'textarea' },
      { key: 'source', kind: 'select', options: ['catalog', 'custom'] },
      { key: 'category', kind: 'select', options: ['podcast', 'video', 'photography', 'package', 'tour', 'all'], showIf: (b) => b.source === 'catalog' },
      { key: 'serviceIds', kind: 'services', showIf: (b) => b.source === 'catalog' },
      { key: 'ctaLabel', kind: 'text', showIf: (b) => b.source === 'catalog' },
    ],
    list: {
      key: 'items',
      showIf: (b) => b.source === 'custom',
      fields: [
        { key: 'name', kind: 'text' },
        { key: 'price', kind: 'text' },
        { key: 'period', kind: 'text' },
        { key: 'description', kind: 'textarea' },
        { key: 'features', kind: 'lines' },
        { key: 'cta', kind: 'cta' },
        { key: 'highlight', kind: 'checkbox' },
      ],
    },
  },
  setups: {
    fields: [{ key: 'heading', kind: 'text' }, { key: 'subheading', kind: 'textarea' }, { key: 'source', kind: 'select', options: ['studio', 'custom'] }],
    list: { key: 'items', showIf: (b) => b.source === 'custom', fields: [{ key: 'title', kind: 'text' }, { key: 'body', kind: 'textarea' }, { key: 'image', kind: 'image' }] },
  },
  gallery: { fields: [{ key: 'heading', kind: 'text' }, { key: 'videoUrl', kind: 'video' }], list: { key: 'images', fields: [{ key: 'src', kind: 'image' }, { key: 'alt', kind: 'text' }] } },
  testimonials: { fields: [{ key: 'heading', kind: 'text' }], list: { key: 'items', fields: [{ key: 'quote', kind: 'textarea' }, { key: 'author', kind: 'text' }, { key: 'role', kind: 'text' }] } },
  faq: { fields: [{ key: 'heading', kind: 'text' }], list: { key: 'items', fields: [{ key: 'q', kind: 'text' }, { key: 'a', kind: 'textarea' }] } },
  leadForm: {
    fields: [
      { key: 'heading', kind: 'text' },
      { key: 'subheading', kind: 'textarea' },
      { key: 'askEmail', kind: 'checkbox' },
      { key: 'askMessage', kind: 'checkbox' },
      { key: 'showMessengers', kind: 'checkbox' },
      { key: 'submitLabel', kind: 'text' },
      { key: 'successMessage', kind: 'textarea' },
    ],
  },
  cta: { fields: [{ key: 'heading', kind: 'text' }, { key: 'body', kind: 'textarea' }, { key: 'button', kind: 'cta' }] },
  text: { fields: [{ key: 'heading', kind: 'text' }, { key: 'body', kind: 'textarea' }] },
};

const SITE_IMAGES = ['/setups/sofa-lounge.webp', '/setups/conversation-corner.webp', '/setups/conference-table.webp', '/setups/bookshelf.webp'];

type Any = Record<string, unknown>;

export default function PageEditor({
  page,
  services,
  canEditCode,
  builtIn,
}: {
  page: EditorPage;
  services: { id: number; name: string; category: string }[];
  canEditCode: boolean;
  builtIn: { vendor: string; configured: boolean }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const apiMessage = useApiMessage();
  const [tab, setTab] = useState<'content' | 'seo' | 'code'>('content');
  const [saved, setSaved] = useState(page);
  const [v, setV] = useState(page);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ block: number | null; text: string } | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(saved);

  const blocks = v.content_blocks;
  const setBlocks = (next: ContentBlock[]) => setV((s) => ({ ...s, content_blocks: next }));
  const updateBlock = (i: number, patch: Any) => setBlocks(blocks.map((b, j) => (j === i ? ({ ...b, ...patch } as ContentBlock) : b)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
    setSel(j);
  };

  const save = async (extra: Partial<EditorPage> = {}) => {
    const check = contentBlocks.safeParse(blocks);
    if (!check.success) {
      const issue = check.error.issues[0];
      const idx = typeof issue.path[0] === 'number' ? issue.path[0] : null;
      setProblem({ block: idx, text: issue.message === 'Required' || issue.message.startsWith('Invalid') || issue.message.startsWith('String') ? t('pages.errors.field', { field: fieldName(issue.path) }) : apiMessage(issue.message) });
      if (idx !== null) {
        setSel(idx);
        setTab('content');
      }
      return false;
    }
    setProblem(null);
    setBusy(true);
    const body: Any = {
      title: v.title,
      slug: v.slug,
      meta_description: v.meta_description || null,
      og_image_url: v.og_image_url || null,
      noindex: v.noindex,
      content_blocks: check.data,
      ...(canEditCode && (v.head_scripts !== saved.head_scripts || v.body_scripts !== saved.body_scripts || v.scripts_consent !== saved.scripts_consent)
        ? { head_scripts: v.head_scripts || null, body_scripts: v.body_scripts || null, scripts_consent: v.scripts_consent }
        : {}),
      ...extra,
    };
    const res = await callApi(`/api/admin/pages/${page.id}`, 'PATCH', body);
    setBusy(false);
    if (!res.ok) {
      const path = (res.data as { path?: (string | number)[] }).path;
      setProblem({ block: path?.[0] === 'content_blocks' && typeof path[1] === 'number' ? path[1] : null, text: apiMessage(res.data?.error, res.status) });
      toast('error', apiMessage(res.data?.error, res.status));
      return false;
    }
    const next = { ...v, ...extra, content_blocks: check.data };
    setV(next);
    setSaved(next);
    toast('success', extra.is_published === true ? t('pages.publishedToast') : extra.is_published === false ? t('pages.unpublishedToast') : t('pages.saved'));
    router.refresh();
    return true;
  };

  const url = v.slug === 'home' ? '/' : `/${v.slug}`;
  const current = blocks[sel];

  return (
    <div className="grid gap-4">
      <div className="card !p-3 flex flex-wrap items-center gap-2 sticky top-14 lg:top-2 z-20">
        <span className={`crm-badge ${saved.is_published ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>{saved.is_published ? t('pages.published') : t('pages.draft')}</span>
        <span className="text-sm font-mono text-zayro-gray break-all">zayro.studio{url}</span>
        {dirty && <span className="text-xs text-amber-700">● {t('pages.unsaved')}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <a className="crm-btn crm-btn-sm" href={`/admin/pages/${page.id}/preview`} target="_blank" rel="noopener" title={dirty ? t('pages.previewSavedOnly') : undefined}>
            {t('pages.preview')}
          </a>
          {saved.is_published && (
            <a className="crm-btn crm-btn-sm" href={url} target="_blank" rel="noopener">
              {t('pages.open')} ↗
            </a>
          )}
          <button type="button" className="crm-btn crm-btn-sm" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? t('common.actions.saving') : t('common.actions.save')}
          </button>
          {saved.is_published ? (
            <button type="button" className="crm-btn crm-btn-sm" disabled={busy} onClick={() => void save({ is_published: false })}>
              {t('pages.unpublish')}
            </button>
          ) : (
            <button type="button" className="crm-btn crm-btn-sm crm-btn-primary" disabled={busy} onClick={() => void save({ is_published: true })}>
              {dirty ? t('pages.saveAndPublish') : t('pages.publish')}
            </button>
          )}
        </div>
      </div>

      {problem && (
        <p className="form-error-banner" role="alert">
          {problem.block !== null ? `${t('pages.errors.inBlock', { n: problem.block + 1 })} ` : ''}
          {problem.text}
        </p>
      )}

      <div className="flex gap-1 flex-wrap" role="tablist" aria-label={t('pages.tabs.label')}>
        {(['content', 'seo', 'code'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`crm-btn crm-btn-sm ${tab === k ? 'crm-btn-primary' : ''}`} onClick={() => setTab(k)}>
            {t(`pages.tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'content' && (
        <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
          <div className="card !p-3 grid gap-2 min-w-0 xl:sticky xl:top-24">
            <ol className="grid gap-1">
              {blocks.map((b, i) => (
                <li key={b.id}>
                  <div className={`rounded-xl border px-2 py-2 flex items-center gap-1 ${i === sel ? 'border-zayro-primary bg-blue-50/50' : 'border-zayro-border'} ${problem?.block === i ? '!border-red-400' : ''}`}>
                    <button type="button" className="flex-1 w-0 min-w-0 overflow-hidden text-left !py-0 !px-1 !bg-transparent !border-0 !shadow-none !min-h-0 !block !font-normal" onClick={() => setSel(i)}>
                      <span className="block text-xs text-zayro-gray">
                        {i + 1}. {t(`pages.blocks.${b.type}`)}
                        {b.hidden ? ` · ${t('pages.hidden')}` : ''}
                      </span>
                      <span className={`block text-sm truncate ${b.hidden ? 'text-zayro-gray line-through' : 'text-zayro-dark'}`}>{blockTitle(b) || '—'}</span>
                    </button>
                    <button type="button" className="crm-btn crm-btn-sm !px-1.5" aria-label={t('pages.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="crm-btn crm-btn-sm !px-1.5" aria-label={t('pages.moveDown')} disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <label className="block">
              <span className="field-label">{t('pages.addBlock')}</span>
              <select
                value=""
                onChange={(e) => {
                  const type = e.target.value as BlockType;
                  if (!type) return;
                  const next = [...blocks];
                  next.splice(sel + 1, 0, emptyBlock(type));
                  setBlocks(next);
                  setSel(Math.min(sel + 1, next.length - 1));
                }}
              >
                <option value="">{t('pages.chooseBlock')}</option>
                {BLOCK_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {t(`pages.blocks.${b}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {current ? (
            <div className="card grid gap-4 min-w-0">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <h2 className="text-base font-semibold">
                  {t(`pages.blocks.${current.type}`)}
                  <span className="block text-xs font-normal text-zayro-gray">{t(`pages.blockHelp.${current.type}`)}</span>
                </h2>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="crm-btn crm-btn-sm" onClick={() => updateBlock(sel, { hidden: !current.hidden })}>
                    {current.hidden ? t('pages.show') : t('pages.hide')}
                  </button>
                  <button
                    type="button"
                    className="crm-btn crm-btn-sm"
                    onClick={() => {
                      const next = [...blocks];
                      next.splice(sel + 1, 0, { ...structuredClone(current), id: newBlockId() });
                      setBlocks(next);
                      setSel(sel + 1);
                    }}
                  >
                    {t('pages.duplicateBlock')}
                  </button>
                  <button
                    type="button"
                    className="crm-btn crm-btn-sm crm-btn-danger"
                    onClick={() => {
                      setBlocks(blocks.filter((_, j) => j !== sel));
                      setSel(Math.max(0, sel - 1));
                    }}
                  >
                    {t('pages.removeBlock')}
                  </button>
                </div>
              </div>
              <BlockForm block={current} services={services} onChange={(patch) => updateBlock(sel, patch)} />
              <div className="grid sm:grid-cols-2 gap-3 border-t border-zayro-border pt-3">
                <Text label={t('pages.fields.anchor')} hint={t('pages.hints.anchor')} value={String(current.anchor ?? '')} onChange={(x) => updateBlock(sel, { anchor: x.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) })} mono />
              </div>
            </div>
          ) : (
            <div className="card text-sm text-zayro-gray">{t('pages.noBlocks')}</div>
          )}
        </div>
      )}

      {tab === 'seo' && (
        <div className="card grid gap-4 max-w-3xl">
          <Text label={t('pages.fields.title')} hint={t('pages.hints.title', { n: v.title.length })} value={v.title} onChange={(x) => setV({ ...v, title: x.slice(0, 200) })} />
          <Text
            label={t('pages.fields.slug')}
            hint={t('pages.hints.slug')}
            value={v.slug}
            mono
            disabled={saved.is_published}
            onChange={(x) => setV({ ...v, slug: x.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80) })}
          />
          <Text label={t('pages.fields.meta')} hint={t('pages.hints.meta', { n: v.meta_description.length })} value={v.meta_description} multiline onChange={(x) => setV({ ...v, meta_description: x.slice(0, 320) })} />
          <ImagePick label={t('pages.fields.og')} value={v.og_image_url} onChange={(x) => setV({ ...v, og_image_url: x })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.noindex} onChange={(e) => setV({ ...v, noindex: e.target.checked })} /> {t('pages.fields.noindex')}
          </label>
          <div className="rounded-xl border border-zayro-border p-3 text-sm">
            <p className="text-xs text-zayro-gray mb-1">{t('pages.googlePreview')}</p>
            <p className="text-[#1a0dab] text-lg leading-snug break-words">{v.title || '—'}</p>
            <p className="text-[#006621] text-xs">zayro.studio{url}</p>
            <p className="text-zayro-gray break-words">{v.meta_description || t('pages.noMeta')}</p>
          </div>
        </div>
      )}

      {tab === 'code' && (
        <div className="grid gap-4 max-w-4xl">
          {!canEditCode && <p className="form-error-banner">{t('pages.codeNoPermission')}</p>}
          <div className="card grid gap-3">
            <p className="text-sm text-zayro-gray">{t('pages.codeIntro')}</p>
            <label className="block max-w-sm">
              <span className="field-label">{t('tracking.consent')}</span>
              <select value={v.scripts_consent} disabled={!canEditCode} onChange={(e) => setV({ ...v, scripts_consent: e.target.value as EditorPage['scripts_consent'] })}>
                {(['advertising', 'analytics', 'necessary'] as const).map((c) => (
                  <option key={c} value={c}>
                    {t(`tracking.consents.${c}`)}
                  </option>
                ))}
              </select>
            </label>
            <CodeField id="pg-head" label={t('pages.headCode')} value={v.head_scripts} disabled={!canEditCode} onChange={(x) => setV({ ...v, head_scripts: x })} builtIn={builtIn} consent={v.scripts_consent} />
            <CodeField id="pg-body" label={t('pages.bodyCode')} value={v.body_scripts} disabled={!canEditCode} onChange={(x) => setV({ ...v, body_scripts: x })} builtIn={builtIn} consent={v.scripts_consent} />
          </div>
        </div>
      )}

      <div className="card !p-3 flex flex-wrap gap-2 justify-between items-center">
        <span className="text-xs text-zayro-gray">{t('pages.dangerNote')}</span>
        <div className="flex flex-wrap gap-2">
          <ActionButton url={`/api/admin/pages/${page.id}/duplicate`} label={t('pages.duplicatePage')} className="crm-btn crm-btn-sm" redirectTo="/admin/pages" />
          {!saved.is_published && (
            <ActionButton
              url={`/api/admin/pages/${page.id}`}
              method="DELETE"
              label={t('pages.deletePage')}
              className="crm-btn crm-btn-sm crm-btn-danger"
              redirectTo="/admin/pages"
              confirm={{ title: t('pages.deleteTitle'), body: t('pages.deleteBody', { slug: saved.slug }), confirmLabel: t('pages.deletePage'), danger: true }}
            />
          )}
        </div>
      </div>
    </div>
  );

  function fieldName(path: (string | number)[]): string {
    const key = [...path].reverse().find((p): p is string => typeof p === 'string');
    return key ? t.dynamic(`pages.fields.${key}`, key) : '';
  }

  function blockTitle(b: ContentBlock): string {
    const x = b as unknown as Any;
    return String(x.heading || x.body || '').slice(0, 60);
  }
}

// ---------------------------------------------------------------------------

function BlockForm({ block, services, onChange }: { block: ContentBlock; services: { id: number; name: string; category: string }[]; onChange: (patch: Any) => void }) {
  const def = FIELDS[block.type];
  const b = block as unknown as Any;
  const { t } = useI18n();
  // The service picker lists only the chosen catalogue category.
  const pick = block.type === 'packages' && block.category !== 'all' ? services.filter((s) => s.category === block.category) : services;
  return (
    <div className="grid gap-3">
      <div className="grid sm:grid-cols-2 gap-3">
        {def.fields
          .filter((fd) => !fd.showIf || fd.showIf(b))
          .map((fd) => (
            <div key={fd.key} className={['textarea', 'cta', 'services', 'image', 'video'].includes(fd.kind) ? 'sm:col-span-2' : ''}>
              <Field def={fd} value={b[fd.key]} services={pick} onChange={(val) => onChange(fd.key === 'category' ? { category: val, serviceIds: [] } : { [fd.key]: val })} />
            </div>
          ))}
      </div>
      {def.list && (!def.list.showIf || def.list.showIf(b)) && (
        <ListEditor
          title={t.dynamic(`pages.lists.${block.type}`, block.type)}
          items={(b[def.list.key] as Any[]) ?? []}
          fields={def.list.fields}
          services={services}
          onChange={(items) => onChange({ [def.list!.key]: items })}
          blank={() => Object.fromEntries(def.list!.fields.map((fd) => [fd.key, fd.kind === 'checkbox' ? false : fd.kind === 'lines' ? [] : fd.kind === 'cta' ? { label: '', href: '' } : '']))}
        />
      )}
    </div>
  );
}

function ListEditor({ title, items, fields, services, onChange, blank }: { title: string; items: Any[]; fields: FieldDef[]; services: { id: number; name: string; category: string }[]; onChange: (items: Any[]) => void; blank: () => Any }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2">
      <p className="field-label !mb-0">
        {title} ({items.length})
      </p>
      {items.map((it, i) => (
        <div key={i} className="rounded-xl border border-zayro-border p-3 grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zayro-gray">#{i + 1}</span>
            <div className="flex gap-1">
              <button type="button" className="crm-btn crm-btn-sm !px-1.5" aria-label={t('pages.moveUp')} disabled={i === 0} onClick={() => onChange(swap(items, i, i - 1))}>
                ↑
              </button>
              <button type="button" className="crm-btn crm-btn-sm !px-1.5" aria-label={t('pages.moveDown')} disabled={i === items.length - 1} onClick={() => onChange(swap(items, i, i + 1))}>
                ↓
              </button>
              <button type="button" className="crm-btn crm-btn-sm crm-btn-danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                {t('common.actions.remove')}
              </button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {fields.map((fd) => (
              <div key={fd.key} className={['textarea', 'lines', 'cta', 'image'].includes(fd.kind) ? 'sm:col-span-2' : ''}>
                <Field def={fd} value={it[fd.key]} services={services} onChange={(val) => onChange(items.map((x, j) => (j === i ? { ...x, [fd.key]: val } : x)))} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div>
        <button type="button" className="crm-btn crm-btn-sm" onClick={() => onChange([...items, blank()])}>
          + {t('pages.addItem')}
        </button>
      </div>
    </div>
  );
}

const swap = <T,>(arr: T[], i: number, j: number) => {
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

function Field({ def, value, services, onChange }: { def: FieldDef; value: unknown; services: { id: number; name: string; category: string }[]; onChange: (v: unknown) => void }) {
  const { t, label } = useI18n();
  const name = t.dynamic(`pages.fields.${def.key}`, def.key);
  switch (def.kind) {
    case 'text':
      return <Text label={name} value={String(value ?? '')} onChange={onChange} />;
    case 'textarea':
      return <Text label={name} value={String(value ?? '')} onChange={onChange} multiline />;
    case 'lines':
      return <Text label={name} hint={t('pages.hints.lines')} value={((value as string[]) ?? []).join('\n')} onChange={(x) => onChange(x.split('\n').map((s) => s.trimStart()).filter((s, i, a) => s || i < a.length - 1).slice(0, 12))} multiline />;
    case 'href':
      return <Text label={name} value={String(value ?? '')} onChange={onChange} mono />;
    case 'video':
      return <Text label={name} hint={t('pages.hints.video')} value={String(value ?? '')} onChange={onChange} mono />;
    case 'image':
      return <ImagePick label={name} value={String(value ?? '')} onChange={onChange} />;
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm mt-6">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {name}
        </label>
      );
    case 'select':
      return (
        <label className="block">
          <span className="field-label">{name}</span>
          <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            {def.options!.map((o) => (
              <option key={o} value={o}>
                {t.dynamic(`pages.options.${o}`, label(o))}
              </option>
            ))}
          </select>
        </label>
      );
    case 'cta': {
      const c = (value as { label?: string; href?: string }) ?? {};
      return (
        <fieldset className="grid sm:grid-cols-2 gap-2">
          <legend className="field-label">{name}</legend>
          <Text label={t('pages.fields.buttonLabel')} value={c.label ?? ''} onChange={(x) => onChange({ ...c, label: x })} />
          <Text label={t('pages.fields.buttonHref')} hint={t('pages.hints.href')} value={c.href ?? ''} onChange={(x) => onChange({ ...c, href: x })} mono list="page-links" />
          <datalist id="page-links">
            {['/booking', '/booking?category=tour', '/pricing', '/contact', '#contact', '#pricing', '/packages'].map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
        </fieldset>
      );
    }
    case 'services': {
      const ids = (value as number[]) ?? [];
      return (
        <fieldset>
          <legend className="field-label">{name}</legend>
          <p className="text-xs text-zayro-gray mb-2">{t('pages.hints.services')}</p>
          <div className="grid sm:grid-cols-2 gap-1 max-h-56 overflow-y-auto rounded-xl border border-zayro-border p-2">
            {services.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ids.includes(s.id)} onChange={(e) => onChange(e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id))} />
                <span className="min-w-0 break-words">
                  {s.name} <span className="text-xs text-zayro-gray">· {label(s.category)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
  }
}

function Text({ label, value, onChange, multiline, hint, mono, disabled, list }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; hint?: string; mono?: boolean; disabled?: boolean; list?: string }) {
  const id = useMemo(() => `f-${Math.random().toString(36).slice(2, 9)}`, []);
  return (
    <div className="min-w-0">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea id={id} rows={3} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={mono ? 'font-mono text-xs' : ''} />
      ) : (
        <input id={id} value={value} disabled={disabled} list={list} onChange={(e) => onChange(e.target.value)} className={mono ? 'font-mono text-sm' : ''} />
      )}
      {hint && <p className="text-xs text-zayro-gray mt-1">{hint}</p>}
    </div>
  );
}

function ImagePick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <Text label={label} hint={t('pages.hints.image')} value={value} onChange={onChange} mono />
      <div className="flex flex-wrap gap-2 mt-2">
        {SITE_IMAGES.map((src) => (
          <button key={src} type="button" onClick={() => onChange(src)} className={`!p-0 rounded-lg overflow-hidden border-2 ${value === src ? 'border-zayro-primary' : 'border-transparent'}`} aria-label={src}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="w-16 h-11 object-cover" />
          </button>
        ))}
        {value && (
          <button type="button" className="crm-btn crm-btn-sm" onClick={() => onChange('')}>
            {t('common.actions.clear')}
          </button>
        )}
      </div>
    </div>
  );
}

