import { Resend } from 'resend';
import { and, eq, inArray, or, sql, lt, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { emailLogs } from '@/lib/db/schema';
import type { EmailLog } from '@/lib/db/schema';
import type { RenderedEmail } from './emailTemplates';

/**
 * Every transactional email goes through here. One email_logs row per
 * logical email (dedupe_key), so:
 *  - an email that was sent is never sent again, however often the caller
 *    (or a retry) runs;
 *  - a failed or not-configured send is visible in Integrations and can be
 *    retried on its own, without touching Calendar or Sheets;
 *  - two concurrent attempts can't both send (claimed with a conditional
 *    update).
 * Never throws: an email problem must not undo a booking or a payment.
 */

export type EmailStatus = 'sent' | 'failed' | 'skipped' | 'duplicate' | 'in_progress';

export interface EmailOutcome {
  /** True when the email has been delivered to Resend (now or earlier). */
  sent: boolean;
  status: EmailStatus;
  error?: string;
  logId?: string;
}

export interface EmailRefs {
  bookingId?: string | null;
  purchaseId?: string | null;
  customerPackageId?: string | null;
  refundId?: string | null;
}

export interface SendArgs {
  template: string;
  recipientType: EmailLog['recipient_type'];
  to: string | null | undefined;
  dedupeKey: string;
  refs?: EmailRefs;
  context?: Record<string, unknown>;
  replyTo?: string;
  render: () => RenderedEmail;
}

/** An attempt that hasn't finished within this window is considered abandoned. */
const STALE_ATTEMPT = sql`now() - interval '2 minutes'`;

let resendClient: Resend | null = null;
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resendClient ??= new Resend(key);
  return resendClient;
}

function shortError(error: unknown): string {
  const message = (error as Error)?.message || String(error);
  return message.replace(/re_[A-Za-z0-9_]+/g, 're_***').slice(0, 500);
}

export async function sendLoggedEmail(args: SendArgs): Promise<EmailOutcome> {
  try {
    const refs = args.refs ?? {};
    const inserted = await db
      .insert(emailLogs)
      .values({
        template: args.template,
        recipient_type: args.recipientType,
        recipient: args.to ?? null,
        booking_id: refs.bookingId ?? null,
        purchase_id: refs.purchaseId ?? null,
        customer_package_id: refs.customerPackageId ?? null,
        refund_id: refs.refundId ?? null,
        dedupe_key: args.dedupeKey.slice(0, 200),
        context: args.context ?? {},
        status: 'pending',
      })
      .onConflictDoNothing({ target: emailLogs.dedupe_key })
      .returning({ id: emailLogs.id });

    let logId = inserted[0]?.id;
    if (!logId) {
      const existing = await db.query.emailLogs.findFirst({ where: eq(emailLogs.dedupe_key, args.dedupeKey.slice(0, 200)) });
      if (!existing) return { sent: false, status: 'failed', error: 'Email log row vanished' };
      if (existing.status === 'sent') return { sent: true, status: 'duplicate', logId: existing.id };
      logId = existing.id;
    }

    // Claim the attempt: only one caller at a time, and never a sent email.
    const claimed = await db
      .update(emailLogs)
      .set({
        status: 'pending',
        attempts: sql`${emailLogs.attempts} + 1`,
        last_attempt_at: new Date(),
        recipient: args.to ?? null,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(emailLogs.id, logId),
          or(
            inArray(emailLogs.status, ['failed', 'skipped']),
            and(eq(emailLogs.status, 'pending'), or(isNull(emailLogs.last_attempt_at), lt(emailLogs.last_attempt_at, STALE_ATTEMPT)))
          )
        )
      )
      .returning({ id: emailLogs.id });
    if (claimed.length === 0) return { sent: false, status: 'in_progress', logId };

    const finish = async (status: 'sent' | 'failed' | 'skipped', error: string | null, messageId: string | null = null) => {
      await db
        .update(emailLogs)
        .set({ status, error, provider_message_id: messageId, sent_at: status === 'sent' ? new Date() : null, updated_at: new Date() })
        .where(eq(emailLogs.id, logId!));
    };

    const resend = getResend();
    const from = process.env.EMAIL_FROM;
    if (!resend || !from) {
      const error = 'Email not configured (RESEND_API_KEY / EMAIL_FROM missing)';
      await finish('skipped', error);
      return { sent: false, status: 'skipped', error, logId };
    }
    if (!args.to) {
      const error = 'No recipient address';
      await finish('skipped', error);
      return { sent: false, status: 'skipped', error, logId };
    }

    let rendered: RenderedEmail;
    try {
      rendered = args.render();
    } catch (error) {
      const message = `Could not render email: ${shortError(error)}`;
      await finish('failed', message);
      return { sent: false, status: 'failed', error: message, logId };
    }

    try {
      const { data, error } = await resend.emails.send({
        from: `ZAYRO Studios <${from}>`,
        to: args.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      });
      if (error) {
        const message = shortError(error);
        await finish('failed', message);
        return { sent: false, status: 'failed', error: message, logId };
      }
      await finish('sent', null, data?.id ?? null);
      return { sent: true, status: 'sent', logId };
    } catch (error) {
      const message = shortError(error);
      await finish('failed', message);
      return { sent: false, status: 'failed', error: message, logId };
    }
  } catch (error) {
    console.error('[email] logging/sending failed:', shortError(error));
    return { sent: false, status: 'failed', error: shortError(error) };
  }
}
