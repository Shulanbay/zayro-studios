import { Fragment, type ReactNode } from 'react';

/**
 * Inserts React nodes into a translated sentence: rich('Type {code} to confirm', { code: <b>…</b> }).
 * Keeps word order per language (the placeholder can sit anywhere). Server- and client-safe.
 */
export function rich(text: string, parts: Record<string, ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  const re = /\{(\w+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!(m[1] in parts)) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<Fragment key={`${m[1]}-${m.index}`}>{parts[m[1]]}</Fragment>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
