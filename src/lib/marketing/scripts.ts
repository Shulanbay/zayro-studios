/**
 * Custom tracking code (GTM, GA4, pixels…) pasted by the marketer: limits,
 * a vendor inspector for the admin ("what does this snippet load?") and the
 * isomorphic parser the browser uses to inject it after consent.
 *
 * Safety rules (enforced by the loader, see components/marketing/CustomCode):
 *   - runs only on public, trackable pages — never in the admin, on API
 *     routes or on Manage Booking (same rule as the built-in tags);
 *   - runs only after the visitor allowed the snippet's consent category;
 *   - <noscript> fallbacks are dropped (they can't wait for consent);
 *   - only <script> elements are injected; any other markup is ignored.
 */

export const MAX_SNIPPET_CHARS = 30_000;

/** Pages custom code never runs on: the booking flow, where customers type their contact details. */
export const CUSTOM_CODE_EXCLUDED = /^\/(booking|packages\/buy)(\/|$)/;

export interface VendorHit {
  vendor: string;
  ids: string[];
}

const VENDORS: { vendor: string; detect: RegExp; id?: RegExp }[] = [
  { vendor: 'Google Tag Manager', detect: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,10}/, id: /\b(GTM-[A-Z0-9]{4,10})\b/g },
  { vendor: 'Google Analytics 4', detect: /gtag\(\s*['"]config['"]\s*,\s*['"]G-|googletagmanager\.com\/gtag\/js\?id=G-/, id: /\b(G-[A-Z0-9]{6,12})\b/g },
  { vendor: 'Google Ads', detect: /AW-\d{6,12}/, id: /\b(AW-\d{6,12})\b/g },
  { vendor: 'Meta Pixel', detect: /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init['"]/, id: /fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,20})['"]/g },
  { vendor: 'TikTok Pixel', detect: /analytics\.tiktok\.com|ttq\.load\(/, id: /ttq\.load\(\s*['"]([A-Z0-9]{10,30})['"]/g },
  { vendor: 'Reddit Pixel', detect: /redditstatic\.com\/ads\/pixel\.js|rdt\(\s*['"]init['"]/, id: /rdt\(\s*['"]init['"]\s*,\s*['"](t2_[a-z0-9]+|a2_[a-z0-9]+)['"]/gi },
  { vendor: 'Pinterest Tag', detect: /s\.pinimg\.com\/ct\/core\.js|pintrk\(\s*['"]load['"]/, id: /pintrk\(\s*['"]load['"]\s*,\s*['"](\d{8,20})['"]/g },
  { vendor: 'X (Twitter) Pixel', detect: /static\.ads-twitter\.com\/uwt\.js|twq\(\s*['"]config['"]/, id: /twq\(\s*['"]config['"]\s*,\s*['"]([a-z0-9]{4,10})['"]/g },
  { vendor: 'LinkedIn Insight', detect: /snap\.licdn\.com|_linkedin_partner_id/, id: /_linkedin_partner_id\s*=\s*['"](\d{4,12})['"]/g },
  { vendor: 'Microsoft Ads (UET)', detect: /bat\.bing\.com\/bat\.js/, id: /\bti\s*:\s*['"](\d{4,12})['"]/g },
  { vendor: 'Snap Pixel', detect: /sc-static\.net\/scevent\.min\.js|snaptr\(/, id: /snaptr\(\s*['"]init['"]\s*,\s*['"]([a-f0-9-]{20,40})['"]/g },
  { vendor: 'Microsoft Clarity', detect: /clarity\.ms\/tag/, id: /clarity\.ms\/tag\/["' +]*([a-z0-9]{6,12})/g },
  { vendor: 'Hotjar', detect: /static\.hotjar\.com|hjid\s*:/, id: /hjid\s*:\s*(\d{4,10})/g },
  { vendor: 'OpenAI / ChatGPT Ads', detect: /openai\.com\/[^"']*pixel|chatgpt\.com\/[^"']*pixel|oaiq\(/ },
];

/** Which known vendors (and IDs) a snippet loads — shown next to the editor. */
export function inspectSnippet(code: string | null | undefined): VendorHit[] {
  if (!code) return [];
  const hits: VendorHit[] = [];
  for (const v of VENDORS) {
    if (!v.detect.test(code)) continue;
    const ids = new Set<string>();
    if (v.id) for (const m of code.matchAll(v.id)) ids.add(m[1]);
    hits.push({ vendor: v.vendor, ids: [...ids] });
  }
  return hits;
}

export interface SnippetProblem {
  level: 'error' | 'warning';
  code: 'too_long' | 'no_script' | 'noscript_dropped' | 'html_ignored' | 'document_write' | 'duplicate_builtin' | 'unbalanced';
  detail?: string;
}

/** Problems with a snippet, for the editor (errors block saving). */
export function checkSnippet(code: string | null | undefined, builtIn: { vendor: string; configured: boolean }[] = []): SnippetProblem[] {
  const out: SnippetProblem[] = [];
  if (!code || !code.trim()) return out;
  if (code.length > MAX_SNIPPET_CHARS) out.push({ level: 'error', code: 'too_long' });
  const opens = (code.match(/<script\b/gi) ?? []).length;
  const closes = (code.match(/<\/script>/gi) ?? []).length;
  if (opens !== closes) out.push({ level: 'error', code: 'unbalanced' });
  if (opens === 0) out.push({ level: 'error', code: 'no_script' });
  if (/<noscript\b/i.test(code)) out.push({ level: 'warning', code: 'noscript_dropped' });
  const withoutScripts = code.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  if (/<[a-z]/i.test(withoutScripts)) out.push({ level: 'warning', code: 'html_ignored' });
  if (/document\.write\s*\(/.test(code)) out.push({ level: 'warning', code: 'document_write' });
  for (const hit of inspectSnippet(code)) {
    const twin = builtIn.find((b) => b.configured && b.vendor === hit.vendor);
    if (twin) out.push({ level: 'warning', code: 'duplicate_builtin', detail: hit.vendor });
  }
  return out;
}

export interface ParsedScript {
  src: string | null;
  inline: string | null;
  attributes: Record<string, string>;
}

const ATTR_ALLOW = /^(async|defer|type|id|crossorigin|referrerpolicy|nonce|data-[a-z0-9-]+|charset|integrity)$/i;

/**
 * The <script> elements of a snippet (src or inline + safe attributes).
 * Pure string parsing so it behaves the same in the browser and in tests.
 */
export function parseScripts(code: string | null | undefined): ParsedScript[] {
  if (!code) return [];
  const cleaned = code.replace(/<!--[\s\S]*?-->/g, '').replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');
  const out: ParsedScript[] = [];
  for (const m of cleaned.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes: Record<string, string> = {};
    for (const a of m[1].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      const name = a[1].toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? '';
      if (name === 'src' || ATTR_ALLOW.test(name)) attributes[name] = value;
    }
    const src = attributes.src && /^https:\/\//i.test(attributes.src) ? attributes.src : null;
    delete attributes.src;
    const type = (attributes.type || '').toLowerCase();
    // Data blocks (JSON-LD etc.) are not executable: skip them.
    if (type && !['text/javascript', 'module', 'application/javascript'].includes(type)) continue;
    const inline = m[2].trim() ? m[2] : null;
    if (!src && !inline) continue;
    out.push({ src, inline, attributes });
  }
  return out;
}

/** <meta name content> pairs for site verification (Meta, Pinterest, Google…), rendered in <head>. */
export interface VerificationTag {
  name: string;
  content: string;
}

export function cleanVerificationTags(value: unknown): VerificationTag[] {
  if (!Array.isArray(value)) return [];
  const out: VerificationTag[] = [];
  for (const v of value.slice(0, 10)) {
    if (!v || typeof v !== 'object') continue;
    const name = String((v as VerificationTag).name ?? '').trim();
    const content = String((v as VerificationTag).content ?? '').trim();
    if (/^[a-z0-9:_.-]{2,60}$/i.test(name) && /^[\w\-.:=+/]{2,200}$/.test(content)) out.push({ name, content });
  }
  return out;
}

/** Parses pasted `<meta name="…" content="…">` tags into pairs (everything else ignored). */
export function verificationFromHtml(html: string): VerificationTag[] {
  const out: VerificationTag[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    if (name && content) out.push({ name, content });
  }
  return cleanVerificationTags(out);
}
