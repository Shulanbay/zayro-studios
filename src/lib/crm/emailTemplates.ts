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
  /** Staff-facing answers to the booking questions and extras: [label, value]. */
  details?: [string, string][];
  /** Full booking details for the summary emails (see bookingSummary). */
  summary?: BookingSummaryData;
}

/** Everything the "booking summary" emails show beyond the basics. */
export interface BookingSummaryData {
  orderNumber?: string | null;
  /** Absolute URL of the header photo (the booked setup). */
  headerImage?: string | null;
  setupName?: string | null;
  durationLabel?: string | null;
  /** Extras bought with the booking, e.g. "Additional Camera × 2". */
  extras?: string[];
  people?: number | null;
  /** Booking questions and answers. */
  answers?: [string, string][];
  guests?: { name: string; email: string }[];
  /** Button under the summary. */
  cta?: { label: string; url: string } | null;
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

const PANEL = '#F4F8FC';
const LINE = '#E3E9F2';

function summaryRow(label: string, value: string): string {
  return `<tr><td style="padding:11px 0;border-top:1px solid ${LINE};color:${MUTED};font-size:14px;vertical-align:top;">${esc(label)}</td><td style="padding:11px 0;border-top:1px solid ${LINE};text-align:right;color:${INK};font-size:14px;font-weight:600;vertical-align:top;">${esc(value)}</td></tr>`;
}

function summaryHeading(text: string): string {
  return `<tr><td colspan="2" style="padding:18px 0 8px;border-top:1px solid ${LINE};color:${INK};font-size:13px;font-weight:700;letter-spacing:0.02em;">${esc(text)}</td></tr>`;
}

interface SummarySection {
  heading?: string;
  rows: [string, string][];
}

/**
 * The booking summary email: studio photo on top, a panel with the booking
 * details in sections, an optional button. Table-based and inline-styled so
 * it renders the same in Gmail, Apple Mail and Outlook; one column, so it
 * reads well on phones.
 */
function summaryLayout(args: {
  title: string;
  intro: string;
  headerImage?: string | null;
  sections: SummarySection[];
  cta?: { label: string; url: string } | null;
  outro?: string[];
  address: string;
}): string {
  // Every row has a hairline above it except the very first one in the panel.
  const cells = args.sections
    .filter((section) => section.rows.length > 0)
    .flatMap((section) => [...(section.heading ? [summaryHeading(section.heading)] : []), ...section.rows.map(([l, v]) => summaryRow(l, v))]);
  const panel = cells.map((row, i) => (i === 0 ? row.split(`border-top:1px solid ${LINE};`).join('') : row)).join('');
  const image = args.headerImage
    ? `<tr><td style="padding:0;"><img src="${esc(args.headerImage)}" width="600" alt="ZAYRO Studios" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:18px 18px 0 0;"></td></tr>`
    : '';
  const button = args.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:24px auto 8px;"><tr><td style="border-radius:999px;background:${BRAND};"><a href="${esc(args.cta.url)}" style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">${esc(args.cta.label)}</a></td></tr></table>`
    : '';
  const outro = (args.outro ?? []).map((p) => `<p style="margin:0 0 10px;color:${MUTED};font-size:14px;line-height:1.6;">${esc(p)}</p>`).join('');
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;background:${PANEL};font-family:-apple-system,system-ui,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid ${LINE};border-radius:18px;">
${image}
<tr><td style="padding:28px 28px 8px;">
<div style="font-size:12px;letter-spacing:0.14em;font-weight:800;color:${INK};margin-bottom:14px;">ZAYRO <span style="color:${BRAND};">STUDIOS</span></div>
<h1 style="margin:0 0 10px;font-size:24px;line-height:1.25;color:${INK};">${esc(args.title)}</h1>
<p style="margin:0 0 20px;color:${MUTED};font-size:15px;line-height:1.6;">${esc(args.intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};border-radius:14px;"><tr><td style="padding:6px 18px 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${panel}</table>
</td></tr></table>
${button}
</td></tr>
<tr><td style="padding:12px 28px 24px;">${outro}</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid ${LINE};background:#FAFCFE;border-radius:0 0 18px 18px;text-align:center;">
<div style="font-size:13px;font-weight:700;color:${INK};margin-bottom:4px;">ZAYRO Studios</div>
<div style="font-size:13px;color:${MUTED};">${esc(args.address)}</div>
<div style="font-size:13px;margin-top:6px;"><a href="https://zayro.studio" style="color:${BRAND};text-decoration:none;">zayro.studio</a></div>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

function summarySections(d: BookingEmailData, forOwner: boolean): SummarySection[] {
  const s = d.summary ?? {};
  const name = `${d.firstName} ${d.lastName ?? ''}`.trim();
  const top: [string, string][] = [['Name', name]];
  if (forOwner) {
    if (d.email) top.push(['Email', d.email]);
    if (d.phone) top.push(['Phone', d.phone]);
    if (d.company) top.push(['Company', d.company]);
  }
  top.push(['Total price', d.totalCents > 0 ? `USD ${formatCents(d.totalCents).replace('$', '')}` : 'Free']);
  if (s.durationLabel) top.push(['Session length', s.durationLabel]);

  const session: [string, string][] = [
    ['Date', formatDateLabel(d.date)],
    ['Time', `${formatTimeLabel(d.startTime)} – ${formatTimeLabel(d.endTime)} ET`],
    ['Location', d.address],
  ];
  if (s.setupName) session.push(['Setup', s.setupName]);
  session.push([d.isTour ? 'Visit' : 'Service', d.serviceName]);
  if (!d.isTour) session.push(['Additional services', s.extras && s.extras.length ? s.extras.join(', ') : 'None']);
  if (typeof s.people === 'number') session.push([d.isTour ? 'Visitors' : 'People', String(s.people)]);

  const sections: SummarySection[] = [{ rows: top }, { heading: 'Session', rows: session }];
  const answers = [...(s.answers ?? [])];
  if (d.notes) answers.push(['Notes', d.notes]);
  if (answers.length) sections.push({ heading: forOwner ? 'Booking answers' : 'Your answers', rows: answers });
  if (s.guests && s.guests.length) {
    sections.push({ heading: 'Guests', rows: s.guests.map((g, i) => [g.name || `Guest ${i + 1}`, g.email] as [string, string]) });
  }
  const ids: [string, string][] = [['Booking ID', d.bookingId]];
  if (s.orderNumber) ids.push(['Order ID', s.orderNumber]);
  sections.push({ heading: 'Reference', rows: ids });
  return sections;
}

function summaryEmail(d: BookingEmailData, args: { title: string; intro: string; subject: string; outro: string[]; forOwner: boolean }): RenderedEmail {
  const sections = summarySections(d, args.forOwner);
  const text = [
    args.title,
    '',
    args.intro,
    '',
    ...sections.flatMap((sec) => [...(sec.heading ? ['', `${sec.heading}:`] : []), ...sec.rows.map(([l, v]) => `${l}: ${v}`)]),
    '',
    ...(d.summary?.cta ? [`${d.summary.cta.label}: ${d.summary.cta.url}`, ''] : []),
    ...args.outro,
  ].join('\n');
  return {
    subject: args.subject,
    html: summaryLayout({ title: args.title, intro: args.intro, headerImage: d.summary?.headerImage, sections, cta: d.summary?.cta, outro: args.outro, address: d.address }),
    text,
  };
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

/** Length of the booked slot in minutes (from the booking's own times). */
function tourMinutes(d: Pick<BookingEmailData, 'startTime' | 'endTime'>): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const diff = toMin(d.endTime) - toMin(d.startTime);
  return diff > 0 ? diff : diff + 1440;
}

export function bookingConfirmation(d: BookingEmailData): RenderedEmail {
  if (d.isTour) {
    return summaryEmail(d, {
      title: 'Your studio tour is booked',
      intro: `Hi ${d.firstName}, we look forward to showing you around ZAYRO Studios.`,
      subject: 'Your ZAYRO Studios tour is booked',
      outro: [
        `The tour takes about ${tourMinutes(d)} minutes and is free — no payment needed.`,
        `Need to change the time? Reply to this email or write to ${d.contactEmail}.`,
      ],
      forOwner: false,
    });
  }
  return summaryEmail(d, {
    title: 'Your booking is confirmed',
    intro: `Hi ${d.firstName}, your session at ZAYRO Studios is confirmed. Here are the details:`,
    subject: 'Your ZAYRO Studios booking is confirmed',
    outro: ['Please arrive 10 minutes early so we can start on time.', `Questions? Reply to this email or write to ${d.contactEmail}.`],
    forOwner: false,
  });
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

/** Sent to each guest the customer added: when, where, and a calendar file. */
export function guestInvite(d: { hostName: string; serviceName: string; date: string; startTime: string; endTime: string; address: string; contactEmail: string; isTour: boolean }): RenderedEmail {
  return build(
    `You're invited to a ${d.isTour ? 'studio tour' : 'session'} at ZAYRO Studios`,
    `${d.hostName} added you as a guest for their ${d.isTour ? 'tour' : 'session'} at ZAYRO Studios.`,
    [['Session', d.serviceName], ...when(d), ['Address', d.address]],
    [
      'The attached calendar file adds the session to your calendar.',
      `Questions about the session? Please contact ${d.hostName} directly, or write to ${d.contactEmail}.`,
    ],
    `${d.hostName} invited you to ZAYRO Studios on ${formatDateLabel(d.date)}`
  );
}

export function ownerNewBooking(d: BookingEmailData & { source: string }): RenderedEmail {
  return summaryEmail(d, {
    title: d.isTour ? 'New studio tour at ZAYRO Studios' : 'New booking at ZAYRO Studios',
    intro: `${`${d.firstName} ${d.lastName ?? ''}`.trim()} just booked the following ${d.isTour ? 'tour' : 'session'}.`,
    subject: `New ${d.isTour ? 'tour' : 'booking'}: ${d.serviceName} on ${formatDateLabel(d.date)}`,
    outro: [`Source: ${d.source}`],
    forOwner: true,
  });
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
