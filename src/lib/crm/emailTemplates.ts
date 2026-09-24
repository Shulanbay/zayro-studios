/**
 * Transactional email templates. Pure functions (data in, subject + HTML +
 * text out) so they can be unit tested and re-rendered for a retry. Every
 * interpolated value goes through `esc`.
 */
import { formatDateLabel, formatTimeLabel } from './time';
import { formatCents } from './money';

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface BookingEmailData {
  bookingId: string;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string | null;
  serviceName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string;
  totalCents: number;
  isTour: boolean;
  notes?: string | null;
  address: string;
  contactEmail: string;
}

const BRAND = '#3D7DFF';
const INK = '#0B1220';
const MUTED = '#5B6472';

function layout(title: string, intro: string, rows: [string, string][], outro: string[] = []): string {
  const rowHtml = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 0;color:${MUTED};font-size:14px;">${esc(label)}</td><td style="padding:8px 0;text-align:right;color:${INK};font-size:14px;font-weight:600;">${esc(value)}</td></tr>`
    )
    .join('');
  const outroHtml = outro.map((p) => `<p style="margin:0 0 12px;color:${MUTED};font-size:14px;line-height:1.6;">${esc(p)}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#F4F8FC;font-family:-apple-system,system-ui,'Segoe UI',sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F8FC;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E3E9F2;border-radius:18px;padding:32px;">
<tr><td>
<div style="font-size:12px;letter-spacing:0.12em;font-weight:700;color:${BRAND};margin-bottom:16px;">ZAYRO STUDIOS</div>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${INK};">${esc(title)}</h1>
<p style="margin:0 0 20px;color:${MUTED};font-size:15px;line-height:1.6;">${esc(intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E3E9F2;border-bottom:1px solid #E3E9F2;margin:0 0 20px;">${rowHtml}</table>
${outroHtml}
</td></tr></table>
<p style="color:#8A93A3;font-size:12px;margin-top:16px;">ZAYRO Studios · 40 W 37th St, Suite 603, New York, NY 10018</p>
</td></tr></table></body></html>`;
}

function textVersion(title: string, intro: string, rows: [string, string][], outro: string[] = []): string {
  return [title, '', intro, '', ...rows.map(([l, v]) => `${l}: ${v}`), '', ...outro].join('\n');
}

function build(title: string, intro: string, rows: [string, string][], outro: string[] = [], subject = title): RenderedEmail {
  return { subject, html: layout(title, intro, rows, outro), text: textVersion(title, intro, rows, outro) };
}

function when(d: Pick<BookingEmailData, 'date' | 'startTime' | 'endTime'>): [string, string][] {
  return [
    ['Date', formatDateLabel(d.date)],
    ['Time', `${formatTimeLabel(d.startTime)} – ${formatTimeLabel(d.endTime)} ET`],
  ];
}

export function bookingConfirmation(d: BookingEmailData): RenderedEmail {
  if (d.isTour) {
    return build(
      'Your studio tour is booked',
      `Hi ${d.firstName}, we look forward to showing you around ZAYRO Studios.`,
      [['Booking ID', d.bookingId], ['Visit', d.serviceName], ...when(d), ['Address', d.address]],
      [
        'The tour takes about 30 minutes and is free — no payment needed.',
        `Need to change the time? Reply to this email or write to ${d.contactEmail}.`,
      ],
      'Your ZAYRO Studios tour is booked'
    );
  }
  return build(
    'Your booking is confirmed',
    `Hi ${d.firstName}, your session at ZAYRO Studios is confirmed.`,
    [['Booking ID', d.bookingId], ['Service', d.serviceName], ...when(d), ['Total', formatCents(d.totalCents)], ['Address', d.address]],
    ['Please arrive 10 minutes early so we can start on time.', `Questions? Reply to this email or write to ${d.contactEmail}.`],
    'Your ZAYRO Studios booking is confirmed'
  );
}

export function rescheduleConfirmation(d: BookingEmailData & { previousDate: string; previousStart: string }): RenderedEmail {
  return build(
    'Your booking has a new time',
    `Hi ${d.firstName}, your ${d.isTour ? 'studio tour' : 'session'} has been moved.`,
    [
      ['Booking ID', d.bookingId],
      ['Service', d.serviceName],
      ['Previously', `${formatDateLabel(d.previousDate)}, ${formatTimeLabel(d.previousStart)} ET`],
      ...when(d),
      ['Address', d.address],
    ],
    [`If the new time doesn't work for you, reply to this email or write to ${d.contactEmail}.`],
    'Your ZAYRO Studios booking was rescheduled'
  );
}

export function cancellationNotice(d: BookingEmailData & { refundNote?: string | null }): RenderedEmail {
  const outro = [
    d.refundNote || (d.totalCents > 0 ? 'If a refund applies, we will send a separate confirmation once it has been issued.' : ''),
    `Want to book another time? Reply to this email or write to ${d.contactEmail}.`,
  ].filter(Boolean);
  return build(
    'Your booking was cancelled',
    `Hi ${d.firstName}, your ${d.isTour ? 'studio tour' : 'session'} at ZAYRO Studios has been cancelled.`,
    [['Booking ID', d.bookingId], ['Service', d.serviceName], ...when(d)],
    outro,
    'Your ZAYRO Studios booking was cancelled'
  );
}

export function refundNotice(d: {
  firstName: string;
  orderNumber: string;
  bookingId?: string | null;
  amountCents: number;
  totalRefundedCents: number;
  originalCents: number;
  contactEmail: string;
}): RenderedEmail {
  const rows: [string, string][] = [['Order', d.orderNumber]];
  if (d.bookingId) rows.push(['Booking ID', d.bookingId]);
  rows.push(['Refund', formatCents(d.amountCents)], ['Refunded in total', `${formatCents(d.totalRefundedCents)} of ${formatCents(d.originalCents)}`]);
  return build(
    'Your refund is on its way',
    `Hi ${d.firstName}, we've issued a refund to your original payment method.`,
    rows,
    ['Refunds usually appear on your statement within 5–10 business days.', `Questions? Write to ${d.contactEmail}.`],
    'Your ZAYRO Studios refund'
  );
}

export function packageAssigned(d: {
  firstName: string;
  planName: string;
  credits: number;
  expiresOn: string; // YYYY-MM-DD
  eligible: string;
  contactEmail: string;
}): RenderedEmail {
  return build(
    'Your package is ready',
    `Hi ${d.firstName}, your ${d.planName} is active.`,
    [['Package', d.planName], ['Sessions', String(d.credits)], ['Valid for', d.eligible], ['Use by', formatDateLabel(d.expiresOn)]],
    [`To book a session with your package, reply to this email or write to ${d.contactEmail} and we'll schedule it for you.`],
    'Your ZAYRO Studios package is ready'
  );
}

export function packageCreditUsed(d: BookingEmailData & { planName: string; remaining: number; expiresOn: string }): RenderedEmail {
  return build(
    'A package session was booked',
    `Hi ${d.firstName}, we booked a session using your ${d.planName}.`,
    [
      ['Booking ID', d.bookingId],
      ['Service', d.serviceName],
      ...when(d),
      ['Sessions left', String(d.remaining)],
      ['Use by', formatDateLabel(d.expiresOn)],
    ],
    [`See you at ${d.address}.`],
    'Your ZAYRO Studios package session is booked'
  );
}

export function packageExpiring(d: { firstName: string; planName: string; remaining: number; expiresOn: string; contactEmail: string }): RenderedEmail {
  return build(
    'Your package sessions expire soon',
    `Hi ${d.firstName}, you still have ${d.remaining} session${d.remaining === 1 ? '' : 's'} on your ${d.planName}.`,
    [['Package', d.planName], ['Sessions left', String(d.remaining)], ['Use by', formatDateLabel(d.expiresOn)]],
    [`Reply to this email or write to ${d.contactEmail} to schedule them.`],
    'Your ZAYRO Studios package expires soon'
  );
}

export function ownerNewBooking(d: BookingEmailData & { source: string }): RenderedEmail {
  const rows: [string, string][] = [
    ['Booking ID', d.bookingId],
    ['Service', d.serviceName],
    ...when(d),
    ['Customer', `${d.firstName} ${d.lastName ?? ''}`.trim()],
    ['Email', d.email ?? ''],
    ['Phone', d.phone ?? ''],
  ];
  if (d.company) rows.push(['Company', d.company]);
  rows.push(['Total', formatCents(d.totalCents)], ['Source', d.source]);
  return build(
    d.isTour ? 'New studio tour' : 'New booking',
    'A booking was just confirmed.',
    rows,
    d.notes ? [`Customer notes: ${d.notes}`] : [],
    `New ${d.isTour ? 'tour' : 'booking'}: ${d.serviceName} on ${formatDateLabel(d.date)}`
  );
}

export function ownerPaymentReview(d: { bookingId: string; orderNumber: string; amountCents: number; reason: string }): RenderedEmail {
  return build(
    'A payment needs your review',
    'Stripe collected a payment that could not confirm its booking. The customer has been charged; decide whether to refund or re-book.',
    [['Booking ID', d.bookingId], ['Order', d.orderNumber], ['Amount', formatCents(d.amountCents)], ['Reason', d.reason]],
    ['Open the booking in the admin CRM to refund or rebook.'],
    `Action needed: payment for ${d.bookingId}`
  );
}
