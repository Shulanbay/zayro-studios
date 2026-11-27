'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, FormError, useJsonSubmit } from '@/components/crm/client';
import { useI18n } from '@/components/crm/i18n';

const TEMPLATES = ['blank', 'home', 'video-podcast', 'reels-pack', 'promo-ads'] as const;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

export default function NewPageButton({ openInitially = false }: { openInitially?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(openInitially);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]>('video-podcast');
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/pages', refresh: false, successMessage: t('pages.created'), onSuccess: (d) => router.push(`/admin/pages/${d.id}`) });
  return (
    <>
      <button type="button" className="crm-btn crm-btn-primary" onClick={() => setOpen(true)}>
        {t('pages.new')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('pages.newTitle')}
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </button>
            <button type="button" className="crm-btn crm-btn-primary" disabled={busy || !title.trim()} onClick={() => submit({ title, slug: slug || slugify(title), template })}>
              {busy ? t('common.actions.saving') : t('pages.create')}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <div>
            <label className="field-label" htmlFor="np-title">
              {t('pages.fields.title')}
            </label>
            <input
              id="np-title"
              value={title}
              maxLength={200}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugEdited) setSlug(slugify(e.target.value));
              }}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="np-slug">
              {t('pages.fields.slug')}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-zayro-gray">zayro.studio/</span>
              <input
                id="np-slug"
                value={slug}
                maxLength={80}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                }}
                className="font-mono"
              />
            </div>
          </div>
          <fieldset>
            <legend className="field-label">{t('pages.template')}</legend>
            <div className="grid sm:grid-cols-2 gap-2">
              {TEMPLATES.map((k) => (
                <label key={k} className={`rounded-xl border p-3 cursor-pointer text-sm ${template === k ? 'border-zayro-primary bg-blue-50/50' : 'border-zayro-border'}`}>
                  <input type="radio" name="np-template" className="sr-only" checked={template === k} onChange={() => setTemplate(k)} />
                  <span className="font-semibold block">{t(`pages.templates.${k}.name`)}</span>
                  <span className="text-xs text-zayro-gray">{t(`pages.templates.${k}.body`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <FormError error={error} />
        </div>
      </Dialog>
    </>
  );
}
