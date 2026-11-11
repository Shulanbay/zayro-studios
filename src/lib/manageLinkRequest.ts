import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from './db';
import { bookings, emailLogs } from './db/schema';
import { writeAudit } from './crm/audit';
import { hitRateLimit } from './crm/rateLimit';
import { ensureManageToken, rotateManageToken } from './manageToken';
import { sendManageLinkEmail } from './email';

/**
 * "Resend Manage Booking Link": booking reference + the email on the
 * booking. The public answer is always the same, whatever happened, so it
 * can't be used to find out whether a booking exists or which email it uses.
 *
 * - The link only ever goes to the email stored on the booking (never to a
 *   guest, never to an address from the request).
 * - A new request issues a new link and invalidates earlier ones (a lost or
 *   forwarded link stops working). Old bookings without a link get one.
 * - A link staff revoked on purpose is not re-issued from here.
 * - Unpaid / abandoned checkouts get nothing.
 * - One email per booking per 10 minutes (cooldown), rate limited per IP and
 *   per booking reference, logged and retryable through email_logs.
 */

export const REQUEST_LINK_RESPONSE = "If the booking details match our records, we'll send a secure management link to the email used for the booking.";
export const LINK_COOLDOWN_MINUTES = 10;

const ELIGIBLE = ['confirmed', 'completed', 'no_show', 'cancelled'] as const;

export function normalizeReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase().replace(/\s+/g, '');
  return /^ZAY-[A-Z0-9]{4,20}$/.test(v) ? v : null;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return v.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export type RequestLinkOutcome = 'sent' | 'cooldown' | 'no_match' | 'not_eligible' | 'rate_limited' | 'invalid' | 'failed';

/** Internal outcome for logs/tests only — callers must show REQUEST_LINK_RESPONSE regardless. */
export async function requestManageLink(input: { reference: unknown; email: unknown }, clientIp: string, now = new Date()): Promise<RequestLinkOutcome> {
  const reference = normalizeReference(input.reference);
  const email = normalizeEmail(input.email);
  if (!reference || !email) return 'invalid';

  // Per IP and per booking reference (both stored only as salted hashes).
  const [byIp, byRef] = await Promise.all([hitRateLimit('manage-link-ip', clientIp, 5, 900), hitRateLimit('manage-link-ref', reference, 5, 3600)]);
  if (!byIp.allowed || !byRef.allowed) return 'rate_limited';

  const booking = await db.query.bookings.findFirst({ where: eq(bookings.booking_id, reference) });
  // The booking owner's email only; guests' addresses never match.
  if (!booking || booking.customer_email.trim().toLowerCase() !== email) return 'no_match';
  if (!(ELIGIBLE as readonly string[]).includes(booking.status) || booking.manage_token_revoked_at) {
    await writeAudit({ actor: { email: 'customer:link-request' }, operation: 'booking.manage_link_requested', entityType: 'booking', entityId: booking.id, outcome: 'denied', metadata: { status: booking.status, revoked: !!booking.manage_token_revoked_at } });
    return 'not_eligible';
  }

  // Cooldown: one link email per booking per 10 minutes.
  const since = new Date(now.getTime() - LINK_COOLDOWN_MINUTES * 60000);
  const recent = await db.query.emailLogs.findFirst({
    where: and(eq(emailLogs.booking_id, booking.id), eq(emailLogs.template, 'manage_link'), inArray(emailLogs.status, ['sent', 'pending']), gte(emailLogs.created_at, since)),
  });
  if (recent) return 'cooldown';

  // A booking that never had a link gets one; otherwise a new one replaces the old.
  const token = booking.manage_token_nonce ? await rotateManageToken(booking.id) : await ensureManageToken(booking.id);
  if (!token) return 'failed';
  const fresh = (await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) })) ?? booking;
  const window = Math.floor(now.getTime() / (LINK_COOLDOWN_MINUTES * 60000));
  const sent = await sendManageLinkEmail(fresh, `manage_link:${booking.id}:${window}`);
  await writeAudit({
    actor: { email: 'customer:link-request' },
    operation: 'booking.manage_link_requested',
    entityType: 'booking',
    entityId: booking.id,
    outcome: sent.sent ? 'success' : 'failed',
    metadata: { rotated: !!booking.manage_token_nonce, email: sent.status },
  });
  return sent.sent ? 'sent' : 'failed';
}
