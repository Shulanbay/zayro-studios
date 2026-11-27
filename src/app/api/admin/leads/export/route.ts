import { NextRequest, NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { leads, type Lead } from '@/lib/db/schema';
import { actorOf, requirePermission } from '@/lib/crm/auth';
import { writeAudit } from '@/lib/crm/audit';
import { csvFilename, toCsv, type CsvColumn } from '@/lib/crm/csv';
import { clickIdTypes, clickIdValues, leadWhere, type LeadFilters } from '@/lib/marketing/leads';

export const dynamic = 'force-dynamic';

const money = (cents: number) => (cents / 100).toFixed(2);
const etTime = (d: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

const LEAD_COLUMNS: CsvColumn<Lead>[] = [
  { header: 'Lead #', value: (r) => r.id },
  { header: 'Created (ET)', value: (r) => etTime(r.created_at) },
  { header: 'Name', value: (r) => r.name },
  { header: 'Phone', value: (r) => r.phone },
  { header: 'Email', value: (r) => r.email },
  { header: 'Contact method', value: (r) => r.contact_method },
  { header: 'Status', value: (r) => r.status },
  { header: 'Revenue (USD)', value: (r) => money(r.revenue_cents) },
  { header: 'Landing page', value: (r) => r.landing_page_slug },
  { header: 'Platform', value: (r) => r.platform },
  { header: 'utm_source', value: (r) => r.utm_source },
  { header: 'utm_medium', value: (r) => r.utm_medium },
  { header: 'utm_campaign', value: (r) => r.utm_campaign },
  { header: 'utm_content', value: (r) => r.utm_content },
  { header: 'utm_term', value: (r) => r.utm_term },
  { header: 'Click IDs present', value: (r) => clickIdTypes(r).join(' ') },
  { header: 'Referrer', value: (r) => r.referrer },
  { header: 'Notes', value: (r) => r.notes },
];

/**
 * Lead exports.
 *  - format=leads: the CRM table (contact details; leads.read).
 *  - format=google_offline: Google Ads offline-conversion import (gclid, time, value) for leads that
 *    became paid deals — no names, emails or phones (marketing.spend or leads.manage).
 */
export async function GET(request: NextRequest) {
  const sp = Object.fromEntries(request.nextUrl.searchParams.entries()) as LeadFilters & { format?: string; conversion?: string };
  const offline = sp.format === 'google_offline';
  const guard = await requirePermission(request, offline ? 'leads.manage' : 'leads.read');
  if (!guard.ok) return guard.response;
  const rows = await db.query.leads.findMany({ where: leadWhere(sp), orderBy: [desc(leads.created_at)], limit: 10_000 });

  let csv: string;
  if (offline) {
    const conversion = (sp.conversion || 'Lead won').replace(/[\r\n,]/g, ' ').slice(0, 100);
    const won = rows
      .filter((r) => r.status === 'paid' || r.status === 'booked')
      .map((r) => ({ r, gclid: clickIdValues(r).gclid }))
      .filter((x) => !!x.gclid);
    csv = `Parameters:TimeZone=America/New_York\r\n${toCsv(
      [
        { header: 'Google Click ID', value: (x: (typeof won)[number]) => x.gclid },
        { header: 'Conversion Name', value: () => conversion },
        { header: 'Conversion Time', value: (x) => etTime(x.r.status_changed_at) },
        { header: 'Conversion Value', value: (x) => money(x.r.revenue_cents) },
        { header: 'Conversion Currency', value: () => 'USD' },
      ],
      won
    ).replace(/^﻿/, '')}`;
  } else {
    csv = toCsv(LEAD_COLUMNS, rows);
  }
  await writeAudit({ actor: actorOf(guard.admin), operation: offline ? 'lead.export_offline_conversions' : 'lead.export', entityType: 'lead', metadata: { rows: rows.length, filters: Object.keys(sp) } });
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename(offline ? 'google-ads-offline-conversions' : 'leads')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
