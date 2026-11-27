'use client';

/**
 * A code box for tracking snippets with a live inspector: what the snippet
 * loads (vendor + IDs), and problems/warnings before the marketer saves.
 */
import { useI18n } from '@/components/crm/i18n';
import { checkSnippet, inspectSnippet, MAX_SNIPPET_CHARS } from '@/lib/marketing/scripts';

const AD_VENDORS = new Set(['Google Ads', 'Meta Pixel', 'TikTok Pixel', 'Reddit Pixel', 'Pinterest Tag', 'X (Twitter) Pixel', 'LinkedIn Insight', 'Microsoft Ads (UET)', 'Snap Pixel', 'OpenAI / ChatGPT Ads']);

export default function CodeField({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
  builtIn = [],
  consent,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  builtIn?: { vendor: string; configured: boolean }[];
  /** The consent category the snippet waits for: ad pixels under any other category get a warning. */
  consent?: 'necessary' | 'analytics' | 'advertising';
}) {
  const { t, f } = useI18n();
  const hits = inspectSnippet(value);
  const problems = value.trim() ? checkSnippet(value, builtIn) : [];
  const adVendors = consent && consent !== 'advertising' ? hits.filter((h) => AD_VENDORS.has(h.vendor)).map((h) => h.vendor) : [];
  return (
    <div className="min-w-0 grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label className="field-label !mb-0" htmlFor={id}>
          {label}
        </label>
        <span className={`text-xs tabular-nums ${value.length > MAX_SNIPPET_CHARS ? 'text-red-700' : 'text-zayro-gray'}`}>
          {f.number(value.length)} / {f.number(MAX_SNIPPET_CHARS)}
        </span>
      </div>
      <textarea
        id={id}
        rows={8}
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => onChange(e.target.value)}
        placeholder={'<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX"></script>\n<script>\n  …\n</script>'}
        className="font-mono text-xs leading-relaxed !bg-slate-950 !text-slate-100 placeholder:!text-slate-500"
      />
      {hint && <p className="text-xs text-zayro-gray">{hint}</p>}
      {(hits.length > 0 || problems.length > 0 || adVendors.length > 0) && (
        <div className="rounded-xl border border-zayro-border p-3 grid gap-2 text-sm">
          {hits.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zayro-gray mb-1">{t('tracking.inspector.detected')}</p>
              <ul className="flex flex-wrap gap-1.5">
                {hits.map((h) => (
                  <li key={h.vendor} className="crm-badge bg-blue-50 text-blue-800 border-blue-100">
                    {h.vendor}
                    {h.ids.length > 0 && <span className="font-mono ml-1">{h.ids.join(', ')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {adVendors.length > 0 && <p className="text-amber-800">⚠ {t('tracking.problems.ad_consent', { vendor: adVendors.join(', ') })}</p>}
          {problems.map((p, i) => (
            <p key={i} className={p.level === 'error' ? 'text-red-700' : 'text-amber-800'}>
              {p.level === 'error' ? '✕ ' : '⚠ '}
              {t.dynamic(`tracking.problems.${p.code}`, p.code, { vendor: p.detail ?? '' })}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
