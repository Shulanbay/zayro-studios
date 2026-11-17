import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';

/**
 * Server-only key handling for analytics.
 *
 *  - hashKey(): HMAC of a random browser cookie value. Only the hash is
 *    stored, so a database copy can't be matched back to a browser cookie.
 *  - encryptJson()/decryptJson(): AES-256-GCM for advertising click IDs and
 *    vendor browser IDs (_fbp, _ga, …), which the Conversions APIs need in
 *    clear text. Requires ANALYTICS_ENCRYPTION_SECRET (≥ 32 characters);
 *    without it nothing is encrypted and those values are not stored at
 *    all — only the fact that one was present.
 *  - deterministicEventId(): one stable ID per real-world action, so a
 *    retried webhook, a retried delivery and the browser pixel all use the
 *    same ID. Derived from the internal id, never from an IP address.
 */

function encryptionSecret(): string | null {
  const s = process.env.ANALYTICS_ENCRYPTION_SECRET;
  return s && s.length >= 32 ? s : null;
}

export function canEncrypt(): boolean {
  return encryptionSecret() !== null;
}

function hashSecret(): string {
  return encryptionSecret() || process.env.NEXTAUTH_SECRET || 'zayro-analytics-hash';
}

export function hashKey(purpose: string, value: string): string {
  return createHmac('sha256', `${purpose}:${hashSecret()}`).update(value).digest('hex');
}

function aesKey(secret: string): Buffer {
  return createHash('sha256').update(`zayro-analytics-aes:${secret}`).digest();
}

export function encryptJson(value: Record<string, string>): string | null {
  const secret = encryptionSecret();
  if (!secret || Object.keys(value).length === 0) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${body.toString('base64url')}`;
}

export function decryptJson(token: string | null | undefined): Record<string, string> {
  const secret = encryptionSecret();
  if (!secret || !token) return {};
  try {
    const [v, iv, tag, body] = token.split('.');
    if (v !== 'v1') return {};
    const decipher = createDecipheriv('aes-256-gcm', aesKey(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const text = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(parsed)) if (typeof val === 'string') out[k] = val;
    return out;
  } catch {
    return {};
  }
}

/** UUID-shaped deterministic ID for `kind` + internal reference. */
export function deterministicEventId(kind: string, reference: string): string {
  const h = createHash('sha256').update(`zayro-analytics-event:${kind}:${reference}`).digest('hex');
  // Version-5-style layout (variant bits set) so it validates as a UUID.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}
