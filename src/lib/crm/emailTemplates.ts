/**
 * Transactional email templates. Pure functions (data in, subject + HTML +
 * text out) so they can be unit tested and re-rendered for a retry. Every
 * interpolated value goes through `esc`.
 */
import { formatDateLabel, formatTimeLabel } from './time';
import { formatCents } from './money';
import { POLICY_COPY } from '../policies';

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
  /** The service includes professional editing (Full Podcast Package): mention the delivery time. */
  includesEditing?: boolean;
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
  /** One line shown right above the button. */
  ctaNote?: string | null;
  subtotalCents?: number | null;
  taxCents?: number | null;
  /** "Thu, Nov 12, 2026, 2:00 PM ET" — last moment to cancel or reschedule. */
  changeDeadlineLabel?: string | null;
}

const BRAND = '#3D7DFF';
const INK = '#0B1220';
const MUTED = '#5B6472';

function ctaButton(cta: { label: string; url: string } | null | undefined, note?: string | null): string {
  if (!cta) return '';
  const noteHtml = note ? `<p style="margin:20px 0 0;color:${MUTED};font-size:14px;line-height:1.6;text-align:center;">${esc(note)}</p>` : '';
  return `${noteHtml}<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:${note ? '12px' : '24px'} auto 8px;"><tr><td style="border-radius:999px;background:${BRAND};"><a href="${esc(cta.url)}" style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">${esc(cta.label)}</a></td></tr></table>`;
}

function layout(title: string, intro: string, rows: [string, string][], outro: string[] = [], cta?: { label: string; url: string; note?: string } | null): string {
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
${ctaButton(cta, cta?.note)}
${outroHtml}
</td></tr></table>
<p style="color:#8A93A3;font-size:12px;margin-top:16px;">ZAYRO Studios · 40 W 37th St, Suite 603, New York, NY 10018</p>
</td></tr></table></body></html>`;
}

function textVersion(title: string, intro: string, rows: [string, string][], outro: string[] = [], cta?: { label: string; url: string; note?: string } | null): string {
  const ctaLines = cta ? [...(cta.note ? [cta.note] : []), `${cta.label}: ${cta.url}`, ''] : [];
  return [title, '', intro, '', ...rows.map(([l, v]) => `${l}: ${v}`), '', ...ctaLines, ...outro].join('\n');
}

const PANEL = '#F4F8FC';
const LINE = '#E3E9F2';

function summaryRow(label: string, value: string, href?: string): string {
  // Phone numbers and emails are links, so they can be tapped from the inbox.
  const shown = href ? `<a href="${esc(href)}" style="color:${BRAND};text-decoration:none;">${esc(value)}</a>` : esc(value);
  return `<tr><td style="padding:11px 0;border-top:1px solid ${LINE};color:${MUTED};font-size:14px;vertical-align:top;">${esc(label)}</td><td style="padding:11px 0;border-top:1px solid ${LINE};text-align:right;color:${INK};font-size:14px;font-weight:600;vertical-align:top;">${shown}</td></tr>`;
}

/** tel: link for a phone number as typed by the customer (digits and a leading + only). */
function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return `tel:${digits.length === 10 ? `+1${digits}` : digits}`;
}

function summaryHeading(text: string): string {
  return `<tr><td colspan="2" style="padding:18px 0 8px;border-top:1px solid ${LINE};color:${INK};font-size:13px;font-weight:700;letter-spacing:0.02em;">${esc(text)}</td></tr>`;
}

type SummaryRow = [label: string, value: string, href?: string];

interface SummarySection {
  heading?: string;
  rows: SummaryRow[];
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
  ctaNote?: string | null;
  outro?: string[];
  address: string;
}): string {
  // Every row has a hairline above it except the very first one in the panel.
  const cells = args.sections
    .filter((section) => section.rows.length > 0)
    .flatMap((section) => [...(section.heading ? [summaryHeading(section.heading)] : []), ...section.rows.map(([l, v, href]) => summaryRow(l, v, href))]);
  const panel = cells.map((row, i) => (i === 0 ? row.split(`border-top:1px solid ${LINE};`).join('') : row)).join('');
  const image = args.headerImage
    ? `<tr><td style="padding:0;"><img src="${esc(args.headerImage)}" width="600" alt="ZAYRO Studios" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:18px 18px 0 0;"></td></tr>`
    : '';
  const button = ctaButton(args.cta, args.ctaNote);
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
  const top: SummaryRow[] = [['Name', name]];
  if (forOwner) {
    if (d.phone) top.push(['Phone', d.phone, telHref(d.phone)]);
    if (d.email) top.push(['Email', d.email, `mailto:${d.email}`]);
    if (d.company) top.push(['Company', d.company]);
  }
  if (typeof s.subtotalCents === 'number' && d.totalCents > 0) {
    top.push(['Subtotal', formatCents(s.subtotalCents)]);
    if (typeof s.taxCents === 'number' && s.taxCents > 0) top.push(['Sales tax', formatCents(s.taxCents)]);
  }
  top.push(['Total price', d.totalCents > 0 ? `USD ${formatCents(d.totalCents).replace('$', '')}` : 'Free']);
  if (s.durationLabel) top.push(['Session length', s.durationLabel]);

  const session: [string, string][] = [
    ['Date', formatDateLabel(d.date)],
    ['Time', `${formatTimeLabel(d.startTime)} – ${formatTimeLabel(d.endTime)} ET (New York time)`],
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
    sections.push({ heading: 'Guests', rows: s.guests.map((g, i): SummaryRow => [g.name || `Guest ${i + 1}`, g.email, forOwner ? `mailto:${g.email}` : undefined]) });
  }
  const ids: [string, string][] = [['Booking ID', d.bookingId]];
  if (s.orderNumber) ids.push(['Order ID', s.orderNumber]);
  sections.push({ heading: 'Reference', rows: ids });
  if (!forOwner && !d.isTour && s.changeDeadlineLabel) {
    sections.push({
      heading: 'Policies',
      rows: [
        ['Cancel for a full refund by', s.changeDeadlineLabel],
        ['Reschedule online by', s.changeDeadlineLabel],
      ],
    });
  }
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
    ...(d.summary?.ctaNote ? [d.summary.ctaNote] : []),
    ...(d.summary?.cta ? [`${d.summary.cta.label}: ${d.summary.cta.url}`, ''] : []),
    ...args.outro,
  ].join('\n');
  return {
    subject: args.subject,
    html: summaryLayout({ title: args.title, intro: args.intro, headerImage: d.summary?.headerImage, sections, cta: d.summary?.cta, ctaNote: d.summary?.ctaNote, outro: args.outro, address: d.address }),
    text,
  };
}

function build(title: string, intro: string, rows: [string, string][], outro: string[] = [], subject = title, cta?: { label: string; url: string; note?: string } | null): RenderedEmail {
  return { subject, html: layout(title, intro, rows, outro, cta), text: textVersion(title, intro, rows, outro, cta) };
}

/** The Manage Booking button: only ever in emails to the booking's owner. */
export const MANAGE_CTA_LABEL = 'Manage Your Booking';
export const MANAGE_CTA_NOTE = 'Use this secure link to review, reschedule, extend or cancel your booking.';
function manageCta(url?: string | null): { label: string; url: string; note: string } | null {
  return url ? { label: MANAGE_CTA_LABEL, url, note: MANAGE_CTA_NOTE } : null;
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
    outro: [
      ...(d.includesEditing ? [POLICY_COPY.editedDelivery] : []),
      POLICY_COPY.studioTime,
      POLICY_COPY.earlyArrival,
      POLICY_COPY.changes,
      POLICY_COPY.refund,
      `Questions? Reply to this email or write to ${d.contactEmail}.`,
    ],
    forOwner: false,
  });
}

export function rescheduleConfirmation(d: BookingEmailData & { previousDate: string; previousStart: string; manageUrl?: string | null; setupName?: string | null }): RenderedEmail {
  const rows: [string, string][] = [
    ['Booking ID', d.bookingId],
    ['Service', d.serviceName],
  ];
  if (d.setupName) rows.push(['Setup', d.setupName]);
  rows.push(['Previously', `${formatDateLabel(d.previousDate)}, ${formatTimeLabel(d.previousStart)} ET`], ...when(d), ['Address', d.address]);
  return build(
    'Your session has been rescheduled',
    `Hi ${d.firstName}, your ${d.isTour ? 'studio tour' : 'session'} has a new time. Everything else about your booking stays the same.`,
    rows,
    [
      ...(d.isTour ? [] : [POLICY_COPY.studioTime, POLICY_COPY.changes]),
      `If the new time doesn't work for you, reply to this email or write to ${d.contactEmail}.`,
    ],
    'Your ZAYRO Studios session has been rescheduled',
    manageCta(d.manageUrl)
  );
}

/** The session got paid extra time right after it. */
export function extensionConfirmation(
  d: BookingEmailData & { previousEnd: string; addedLabel: string; amountCents: number; taxCents: number; orderNumber: string; manageUrl?: string | null }
): RenderedEmail {
  const rows: [string, string][] = [
    ['Booking ID', d.bookingId],
    ['Service', d.serviceName],
    ['Date', formatDateLabel(d.date)],
    ['Previous end', `${formatTimeLabel(d.previousEnd)} ET`],
    ['New time', `${formatTimeLabel(d.startTime)} – ${formatTimeLabel(d.endTime)} ET`],
    ['Added time', d.addedLabel],
  ];
  if (d.taxCents > 0) rows.push(['Sales tax', formatCents(d.taxCents)]);
  rows.push(['Paid', formatCents(d.amountCents)], ['Order', d.orderNumber], ['Address', d.address]);
  return build(
    'Your session has been extended',
    `Hi ${d.firstName}, your extra time is confirmed. Your session now ends at ${formatTimeLabel(d.endTime)} ET.`,
    rows,
    [POLICY_COPY.studioTime, `Questions? Reply to this email or write to ${d.contactEmail}.`],
    'Your ZAYRO Studios session has been extended',
    manageCta(d.manageUrl)
  );
}

/** Sent to each guest when the host's session moves or gets longer, with an updated calendar file. */
export function guestScheduleUpdate(d: {
  hostName: string;
  serviceName: string;
  date: string;
  startTime: string;
  endTime: string;
  address: string;
  contactEmail: string;
  change: 'rescheduled' | 'extended';
}): RenderedEmail {
  const what = d.change === 'extended' ? 'now runs longer' : 'has a new time';
  return build(
    `Updated: session at ZAYRO Studios`,
    `${d.hostName}'s session at ZAYRO Studios ${what}. Here are the current details.`,
    [['Session', d.serviceName], ...when(d), ['Address', d.address]],
    [
      'The attached calendar file updates the session in your calendar.',
      `Questions about the session? Please contact ${d.hostName} directly, or write to ${d.contactEmail}.`,
    ],
    `Updated time: ${d.hostName}'s session at ZAYRO Studios on ${formatDateLabel(d.date)}`
  );
}

export function cancellationNotice(d: BookingEmailData & { refundNote?: string | null }): RenderedEmail {
  const outro = [
    d.refundNote || (d.totalCents > 0 ? 'If a refund applies, we will send a separate confirmation once it has been issued.' : ''),
    `Want to book another time? Reply to this email or write to ${d.contactEmail}.`,
  ].filter(Boolean);
  return build(
    'Your booking has been canceled',
    `Hi ${d.firstName}, your ${d.isTour ? 'studio tour' : 'session'} at ZAYRO Studios has been canceled.`,
    [['Booking ID', d.bookingId], ['Service', d.serviceName], ...when(d)],
    outro,
    'Your ZAYRO Studios booking has been canceled'
  );
}

/** Refund state as the customer should read it. Never says "completed" while Stripe is still processing. */
export type RefundEmailStatus = 'pending' | 'succeeded' | 'failed';

export function refundNotice(d: {
  firstName: string;
  orderNumber: string;
  bookingId?: string | null;
  amountCents: number;
  totalRefundedCents: number;
  originalCents: number;
  contactEmail: string;
  status?: RefundEmailStatus;
}): RenderedEmail {
  const status = d.status ?? 'succeeded';
  const rows: [string, string][] = [['Order', d.orderNumber]];
  if (d.bookingId) rows.push(['Booking ID', d.bookingId]);
  rows.push(['Refund', formatCents(d.amountCents)], ['Status', status === 'pending' ? 'Requested — processing' : status === 'failed' ? 'Not completed' : 'Issued']);
  if (status === 'succeeded') rows.push(['Refunded in total', `${formatCents(d.totalRefundedCents)} of ${formatCents(d.originalCents)}`]);
  if (status === 'failed') {
    return build(
      'We could not complete your refund',
      `Hi ${d.firstName}, your refund of ${formatCents(d.amountCents)} could not be completed automatically. Our team has been notified and will contact you.`,
      rows,
      [`Questions? Write to ${d.contactEmail}.`],
      'Your ZAYRO Studios refund needs attention'
    );
  }
  return build(
    status === 'pending' ? 'Your refund has been requested' : 'Your refund has been issued',
    status === 'pending'
      ? `Hi ${d.firstName}, we've requested a refund of ${formatCents(d.amountCents)} to your original payment method. It is being processed.`
      : `Hi ${d.firstName}, we've issued a refund of ${formatCents(d.amountCents)} to your original payment method.`,
    rows,
    [POLICY_COPY.refund, `Questions? Write to ${d.contactEmail}.`],
    status === 'pending' ? 'Your ZAYRO Studios refund has been requested' : 'Your ZAYRO Studios refund has been issued'
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

/** A fresh Manage Booking link the customer asked for (only ever sent to the booking's own email). */
export function manageLinkEmail(d: { firstName: string; bookingId: string; serviceName: string; date: string; startTime: string; endTime: string; manageUrl: string; contactEmail: string }): RenderedEmail {
  return build(
    'Your booking link',
    `Hi ${d.firstName}, here is a new secure link to your booking. Earlier links no longer work.`,
    [['Booking ID', d.bookingId], ['Service', d.serviceName], ...when(d)],
    ['If you did not ask for this link, you can ignore this email — nobody else can see your booking without it.', `Questions? Write to ${d.contactEmail}.`],
    'Your ZAYRO Studios booking link',
    manageCta(d.manageUrl)
  );
}
