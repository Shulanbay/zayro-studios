/** New-lead email to the studio owner (best effort: a lead is never lost because email failed). */
import { Resend } from 'resend';
import type { Lead } from '@/lib/db/schema';

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function notifyNewLead(lead: Lead, baseUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const to = process.env.OWNER_EMAIL;
  if (!apiKey || !from || !to) return;
  const rows: [string, string | null][] = [
    ['Name', lead.name],
    ['Phone', lead.phone],
    ['Email', lead.email],
    ['Page', lead.landing_page_slug ? `/${lead.landing_page_slug}` : lead.landing_path],
    ['Source', [lead.utm_source, lead.utm_medium].filter(Boolean).join(' / ') || null],
    ['Campaign', lead.utm_campaign],
  ];
  const tel = lead.phone ? lead.phone.replace(/[^\d+]/g, '') : '';
  try {
    await new Resend(apiKey).emails.send({
      from: `ZAYRO Studios Leads <${from}>`,
      to,
      ...(lead.email ? { reply_to: lead.email } : {}),
      subject: `New lead #${lead.id}${lead.name ? ` — ${lead.name.replace(/[\r\n]+/g, ' ')}` : ''}`,
      html: `<div style="font-family:sans-serif">
        <p style="font-size:16px"><strong>New lead #${lead.id}</strong></p>
        <table cellpadding="4">${rows
          .filter(([, v]) => v)
          .map(([k, v]) => `<tr><td style="color:#666">${k}</td><td>${k === 'Phone' && tel ? `<a href="tel:${esc(tel)}">${esc(v!)}</a>` : k === 'Email' ? `<a href="mailto:${esc(v!)}">${esc(v!)}</a>` : esc(v!)}</td></tr>`)
          .join('')}</table>
        ${lead.message ? `<p style="white-space:pre-wrap">${esc(lead.message)}</p>` : ''}
        <p><a href="${baseUrl}/admin/leads/${lead.id}">Open in the CRM</a></p>
      </div>`,
    });
  } catch (error) {
    console.error('[marketing] lead email failed:', (error as Error)?.message || error);
  }
}
