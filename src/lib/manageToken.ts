import { createHash, createHmac, randomBytes } from 'node:crypto';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from './db';
import { bookings } from './db/schema';
import type { Booking } from './db/schema';
import type { Executor } from './db/types';
import { SITE_URL } from './seo';

/**
 * Manage Booking links. A link is a capability for exactly one booking:
 *
 *   token = base64url(HMAC-SHA256(BOOKING_MANAGE_SECRET, "zayro:booking-manage:v1:" + booking uuid + ":" + nonce))
 *
 * - The nonce is 32 random bytes generated on the server; the database
 *   stores it and sha256(token) (for lookup), never the token itself. A copy
 *   of the database alone can't produce a working link.
 * - The token is re-derivable from the nonce, so a retried confirmation
 *   email carries the same link instead of silently breaking the first one.
 * - Rotating the nonce (new link) or setting manage_token_revoked_at
 *   revokes every earlier link.
 * - Booking ids, emails, phone numbers and Stripe ids never authorise
 *   anything here.
 *
 * The link puts the token in the URL fragment (/booking/manage#t=…), which
 * browsers never send to the server, to analytics or in a Referer header.
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Minimum key length: 32 bytes (64 hex chars or ≥ 43 base64 chars). */
const MIN_SECRET_LENGTH = 32;

export class ManageLinkConfigError extends Error {}

/**
 * The dedicated signing key for Manage Booking links. Deliberately separate
 * from NEXTAUTH_SECRET (admin auth) and STRIPE_SECRET_KEY (payments): rotating
 * one never affects the other two systems, and there is no fallback. Without
 * it every token operation fails closed.
 */
function secret(): string {
  const key = process.env.BOOKING_MANAGE_SECRET;
  if (!key || key.length < MIN_SECRET_LENGTH) throw new ManageLinkConfigError('BOOKING_MANAGE_SECRET is not configured');
  return key;
}

export function isManageSecretConfigured(): boolean {
  const key = process.env.BOOKING_MANAGE_SECRET;
  return !!key && key.length >= MIN_SECRET_LENGTH;
}

export function deriveManageToken(bookingUuid: string, nonce: string): string {
  return createHmac('sha256', secret()).update(`zayro:booking-manage:v1:${bookingUuid}:${nonce}`).digest('base64url');
}

export function hashManageToken(token: string): string {
  return createHash('sha256').update(`zayro:booking-manage-hash:v1:${token}`).digest('hex');
}

export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export function manageUrl(token: string, base = SITE_URL): string {
  return `${base}/booking/manage#t=${token}`;
}

/**
 * Returns the booking's current management token, creating one the first
 * time (bookings made before Manage Booking existed get theirs lazily).
 * Never issues a token for a revoked link — staff rotate it explicitly.
 */
export async function ensureManageToken(bookingUuid: string, exec: Executor = db): Promise<string | null> {
  const row = await exec.query.bookings.findFirst({ where: eq(bookings.id, bookingUuid) });
  if (!row) return null;
  if (row.manage_token_revoked_at) return null;
  if (row.manage_token_nonce) return deriveManageToken(row.id, row.manage_token_nonce);
  const nonce = randomBytes(32).toString('hex');
  const token = deriveManageToken(row.id, nonce);
  // Compare-and-set: two emails racing each other end up with the same link.
  const updated = await exec
    .update(bookings)
    .set({ manage_token_nonce: nonce, manage_token_hash: hashManageToken(token), manage_token_issued_at: new Date() })
    .where(and(eq(bookings.id, row.id), isNull(bookings.manage_token_nonce)))
    .returning({ id: bookings.id });
  if (updated.length > 0) return token;
  const fresh = await exec.query.bookings.findFirst({ where: eq(bookings.id, row.id) });
  return fresh?.manage_token_nonce && !fresh.manage_token_revoked_at ? deriveManageToken(fresh.id, fresh.manage_token_nonce) : null;
}

/** Issues a new link and revokes every earlier one (staff action). */
export async function rotateManageToken(bookingUuid: string, exec: Executor = db): Promise<string | null> {
  const nonce = randomBytes(32).toString('hex');
  const token = deriveManageToken(bookingUuid, nonce);
  const updated = await exec
    .update(bookings)
    .set({ manage_token_nonce: nonce, manage_token_hash: hashManageToken(token), manage_token_issued_at: new Date(), manage_token_revoked_at: null })
    .where(eq(bookings.id, bookingUuid))
    .returning({ id: bookings.id });
  return updated.length ? token : null;
}

/** Disables the management link entirely. */
export async function revokeManageToken(bookingUuid: string, exec: Executor = db): Promise<void> {
  await exec.update(bookings).set({ manage_token_revoked_at: new Date() }).where(eq(bookings.id, bookingUuid));
}

/**
 * The booking a token opens, or null. Callers must answer every null the
 * same way, so a response never reveals whether a booking exists.
 */
export async function bookingForToken(token: unknown, exec: Executor = db): Promise<Booking | null> {
  if (!isWellFormedToken(token)) return null;
  let hash: string;
  try {
    hash = hashManageToken(token);
  } catch {
    return null;
  }
  const row = await exec.query.bookings.findFirst({
    where: and(eq(bookings.manage_token_hash, hash), isNotNull(bookings.manage_token_nonce), isNull(bookings.manage_token_revoked_at)),
  });
  if (!row?.manage_token_nonce) return null;
  // Defence in depth: the token must also be the one derived from the current nonce.
  return deriveManageToken(row.id, row.manage_token_nonce) === token ? row : null;
}
