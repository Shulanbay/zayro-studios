/**
 * Lead CRM: capture with attribution, the pipeline, the activity timeline
 * and the numbers the marketing cockpit shows.
 *
 * Attribution comes from the visitor's consented analytics session when
 * there is one (server-verified), otherwise from the UTM parameters of the
 * page the form was sent from. Ad click IDs are kept only with advertising
 * consent and are stored encrypted (same key as analytics click IDs).
 */
import type { NextRequest } from 'next/server';
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rowsOf } from '@/lib/db/types';
import { customers, leadActivities, leads, LEAD_STATUSES, type Lead, type LeadContactMethod, type LeadStatus } from '@/lib/db/schema';
import { CLICK_ID_KEYS, classifyTouch, cleanClickId, cleanUtm, looksLikePii, referrerHost, sanitizePath, type ClickIdKey, type Platform } from '@/lib/analytics/attribution';
import { applyGpc, CONSENT_COOKIE, currentConsent, gpcFromHeaders } from '@/lib/analytics/consent';
import { visitFromCookies } from '@/lib/analytics/server/store';
import { decryptJson, encryptJson } from '@/lib/analytics/server/crypto';
import { addDays, wallTimeToUtc } from '@/lib/crm/time';

export const LEAD_PAGE_SIZE = 50;

/** What the browser sends with a form (all optional, all re-validated). */
export interface ClientTouch {
  landingSlug?: string | null;
  pagePath?: string | null;
  referrer?: string | null;
  utm?: Partial<Record<'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term' | 'utm_id', unknown>>;
  clickIds?: Partial<Record<ClickIdKey | 'custom', unknown>>;
}

export interface LeadAttribution {
  landing_page_slug: string | null;
  landing_path: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  utm_id: string | null;
  platform: Platform;
  click_id_types: string | null;
  click_ids_encrypted: string | null;
  analytics_session_id: string | null;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Resolves a lead's attribution from the request (cookies, consent) and the form's touch data. */
export async function leadAttribution(request: NextRequest, touch: ClientTouch, ownHost: string | null): Promise<LeadAttribution> {
  const consent = applyGpc(currentConsent(request.cookies.get(CONSENT_COOKIE)?.value), gpcFromHeaders(request.headers));
  const advertising = !!consent?.advertising;

  const clientUtm = {
    utm_source: cleanUtm(touch.utm?.utm_source),
    utm_medium: cleanUtm(touch.utm?.utm_medium),
    utm_campaign: cleanUtm(touch.utm?.utm_campaign),
    utm_content: cleanUtm(touch.utm?.utm_content),
    utm_term: cleanUtm(touch.utm?.utm_term),
  };
  const clickIds: Record<string, string> = {};
  if (advertising) {
    for (const k of CLICK_ID_KEYS) {
      const v = cleanClickId(k, touch.clickIds?.[k]);
      if (v) clickIds[k] = v;
    }
    const custom = touch.clickIds?.custom;
    if (typeof custom === 'string' && /^[\w.~-]{4,200}$/.test(custom) && !looksLikePii(custom)) clickIds.custom = custom;
  }

  type SessionRow = {
    id: string;
    landing_path: string | null;
    referrer_host: string | null;
    session_source: string | null;
    session_medium: string | null;
    session_campaign: string | null;
    session_content: string | null;
    session_term: string | null;
    platform: string;
    click_ids_encrypted: string | null;
    consent_advertising: boolean;
  };
  let session = null as SessionRow | null;
  try {
    const visit = await visitFromCookies(request.cookies, consent);
    if (visit.sessionId) {
      session =
        rowsOf<SessionRow>(
          await db.execute(sql`SELECT id, landing_path, referrer_host, session_source, session_medium, session_campaign, session_content, session_term, platform, click_ids_encrypted, consent_advertising
                                 FROM analytics_sessions WHERE id = ${visit.sessionId} LIMIT 1`)
        )[0] ?? null;
    }
  } catch {
    session = null;
  }
  if (session && advertising && session.consent_advertising) Object.assign(clickIds, { ...decryptJson(session.click_ids_encrypted), ...clickIds });

  const sessionTagged = !!session && (!!session.session_source || session.platform !== 'direct');
  const utm = sessionTagged
    ? {
        utm_source: session!.session_source,
        utm_medium: session!.session_medium,
        utm_campaign: session!.session_campaign,
        utm_content: session!.session_content,
        utm_term: session!.session_term,
      }
    : clientUtm;
  const refHost = referrerHost(typeof touch.referrer === 'string' ? touch.referrer : null, ownHost) ?? session?.referrer_host ?? null;
  const types = Object.keys(clickIds).filter((k): k is ClickIdKey => (CLICK_ID_KEYS as readonly string[]).includes(k));
  const classified = classifyTouch({
    utm: { utm_source: utm.utm_source ?? undefined, utm_medium: utm.utm_medium ?? undefined, utm_campaign: utm.utm_campaign ?? undefined, utm_content: utm.utm_content ?? undefined, utm_term: utm.utm_term ?? undefined },
    clickIdTypes: types,
    referrerHost: refHost,
  });
  const slug = typeof touch.landingSlug === 'string' && SLUG.test(touch.landingSlug) ? touch.landingSlug : null;
  const referrerText = typeof touch.referrer === 'string' ? touch.referrer : null;
  return {
    landing_page_slug: slug,
    landing_path: sanitizePath(typeof touch.pagePath === 'string' ? touch.pagePath : null) ?? session?.landing_path ?? null,
    referrer: refHost && referrerText ? (sanitizeReferrer(referrerText) ?? refHost) : refHost,
    utm_source: classified.source === '(direct)' ? null : classified.source,
    utm_medium: classified.medium === '(none)' ? null : classified.medium,
    utm_campaign: classified.campaign,
    utm_content: classified.content,
    utm_term: classified.term,
    utm_id: cleanUtm(touch.utm?.utm_id),
    platform: classified.platform,
    click_id_types: Object.keys(clickIds).length ? Object.keys(clickIds).sort().join(',') : null,
    click_ids_encrypted: Object.keys(clickIds).length ? encryptJson(clickIds) : null,
    analytics_session_id: session?.id ?? null,
  };
}

/** Origin + path only (no query string: it can hold personal data or click IDs). */
function sanitizeReferrer(referrer: string): string | null {
  try {
    const u = new URL(referrer);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.origin}${u.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

export interface NewLead {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  message?: string | null;
  contact_method?: LeadContactMethod;
  status?: LeadStatus;
  revenue_cents?: number;
  notes?: string | null;
  created_by?: string | null;
}

export async function createLead(input: NewLead, attribution: Partial<LeadAttribution> = {}): Promise<Lead> {
  const email = input.email?.trim().toLowerCase() || null;
  const customer = email ? await db.query.customers.findFirst({ where: eq(customers.normalized_email, email) }).catch(() => undefined) : undefined;
  const [lead] = await db
    .insert(leads)
    .values({
      name: input.name?.trim() || null,
      phone: input.phone?.trim() || null,
      email,
      message: input.message?.trim() || null,
      contact_method: input.contact_method ?? 'form',
      status: input.status ?? 'new',
      revenue_cents: input.revenue_cents ?? 0,
      notes: input.notes?.trim() || null,
      created_by: input.created_by ?? null,
      customer_id: customer?.id ?? null,
      ...attribution,
    })
    .returning();
  await db.insert(leadActivities).values({ lead_id: lead.id, type: 'created', to_value: lead.status, body: input.created_by ? 'Added manually' : null, actor_email: input.created_by ?? null });
  return lead;
}

export interface LeadPatch {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: LeadStatus;
  revenue_cents?: number;
  ad_spend_attributed_cents?: number;
  notes?: string | null;
  lost_reason?: string | null;
  assigned_to?: string | null;
  contact_method?: LeadContactMethod;
}

/** Applies a change and writes the timeline entries (status, revenue, assignee, other edits). */
export async function updateLead(id: number, patch: LeadPatch, actorEmail: string): Promise<{ before: Lead; after: Lead } | null> {
  const before = await db.query.leads.findFirst({ where: eq(leads.id, id) });
  if (!before) return null;
  const set: Partial<typeof leads.$inferInsert> = { updated_at: new Date() };
  for (const [k, v] of Object.entries(patch) as [keyof LeadPatch, unknown][]) {
    if (v === undefined) continue;
    (set as Record<string, unknown>)[k] = typeof v === 'string' ? v.trim() || null : v;
  }
  if (set.email) set.email = String(set.email).toLowerCase();
  if (patch.status && patch.status !== before.status) set.status_changed_at = new Date();
  const [after] = await db.update(leads).set(set).where(eq(leads.id, id)).returning();
  const acts: (typeof leadActivities.$inferInsert)[] = [];
  if (patch.status && patch.status !== before.status) acts.push({ lead_id: id, type: 'status', from_value: before.status, to_value: patch.status, body: patch.status === 'rejected' ? patch.lost_reason ?? null : null, actor_email: actorEmail });
  if (patch.revenue_cents !== undefined && patch.revenue_cents !== before.revenue_cents) acts.push({ lead_id: id, type: 'revenue', from_value: String(before.revenue_cents), to_value: String(patch.revenue_cents), actor_email: actorEmail });
  if (patch.assigned_to !== undefined && (patch.assigned_to || null) !== before.assigned_to) acts.push({ lead_id: id, type: 'assigned', from_value: before.assigned_to, to_value: patch.assigned_to || null, actor_email: actorEmail });
  const edited = (['name', 'phone', 'email', 'contact_method', 'ad_spend_attributed_cents'] as const).filter((k) => patch[k] !== undefined && (set as Record<string, unknown>)[k] !== before[k]);
  if (edited.length) acts.push({ lead_id: id, type: 'edit', body: edited.join(', '), actor_email: actorEmail });
  if (acts.length) await db.insert(leadActivities).values(acts);
  return { before, after };
}

export async function addLeadNote(id: number, body: string, actorEmail: string) {
  await db.insert(leadActivities).values({ lead_id: id, type: 'note', body: body.trim().slice(0, 5000), actor_email: actorEmail });
  await db.update(leads).set({ updated_at: new Date() }).where(eq(leads.id, id));
}

export async function leadTimeline(id: number) {
  return db.query.leadActivities.findMany({ where: eq(leadActivities.lead_id, id), orderBy: [desc(leadActivities.created_at)], limit: 200 });
}

/** Click-ID types only (never the values) for the UI; values go only to the offline-conversion export. */
export function clickIdTypes(lead: Pick<Lead, 'click_id_types'>): string[] {
  return (lead.click_id_types ?? '').split(',').filter(Boolean);
}

export function clickIdValues(lead: Pick<Lead, 'click_ids_encrypted'>): Record<string, string> {
  return decryptJson(lead.click_ids_encrypted);
}

export interface LeadFilters {
  q?: string;
  status?: string;
  platform?: string;
  source?: string;
  campaign?: string;
  page?: string;
  method?: string;
  from?: string;
  to?: string;
}

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function leadWhere(f: LeadFilters): SQL | undefined {
  const c: SQL[] = [];
  const q = f.q?.trim().replace(/[\\%_]/g, '');
  if (q) {
    const n = Number(q.replace(/^#/, ''));
    c.push(or(ilike(leads.name, `%${q}%`), ilike(leads.email, `%${q}%`), ilike(leads.phone, `%${q}%`), ...(Number.isInteger(n) && n > 0 && n < 2 ** 31 ? [eq(leads.id, n)] : []))!);
  }
  if (f.status && (LEAD_STATUSES as readonly string[]).includes(f.status)) c.push(eq(leads.status, f.status as LeadStatus));
  if (f.platform) c.push(eq(leads.platform, f.platform.slice(0, 30)));
  if (f.source) c.push(eq(leads.utm_source, f.source.slice(0, 150)));
  if (f.campaign) c.push(eq(leads.utm_campaign, f.campaign.slice(0, 150)));
  if (f.page) c.push(eq(leads.landing_page_slug, f.page.slice(0, 80)));
  if (f.method) c.push(eq(leads.contact_method, f.method as LeadContactMethod));
  if (isDate(f.from)) c.push(gte(leads.created_at, wallTimeToUtc(f.from!, '00:00')));
  if (isDate(f.to)) c.push(lt(leads.created_at, wallTimeToUtc(addDays(f.to!, 1), '00:00')));
  return c.length ? and(...c) : undefined;
}

export async function listLeads(f: LeadFilters, opts: { page?: number; pageSize?: number } = {}) {
  const where = leadWhere(f);
  const size = opts.pageSize ?? LEAD_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const [rows, [{ total }]] = await Promise.all([
    db.query.leads.findMany({ where, orderBy: [desc(leads.created_at)], limit: size, offset: (page - 1) * size }),
    db.select({ total: sql<number>`count(*)::int` }).from(leads).where(where),
  ]);
  return { rows, total: Number(total) };
}

/** Counts per status (the pipeline header) and money, for the current filters. */
export async function leadSummary(f: LeadFilters) {
  const where = leadWhere(f);
  const rows = await db
    .select({ status: leads.status, n: sql<number>`count(*)::int`, revenue: sql<number>`coalesce(sum(${leads.revenue_cents}), 0)::int` })
    .from(leads)
    .where(where)
    .groupBy(leads.status);
  const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
  let revenue = 0;
  for (const r of rows) {
    byStatus[r.status as LeadStatus] = Number(r.n);
    revenue += Number(r.revenue);
  }
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return { byStatus, total, revenueCents: revenue, won: byStatus.booked + byStatus.paid };
}

/** Distinct values for the filter dropdowns. */
export async function leadFilterOptions() {
  const r = await db.execute(sql`
    SELECT 'source' AS k, utm_source AS v FROM leads WHERE utm_source IS NOT NULL GROUP BY 2
    UNION ALL SELECT 'campaign', utm_campaign FROM leads WHERE utm_campaign IS NOT NULL GROUP BY 2
    UNION ALL SELECT 'page', landing_page_slug FROM leads WHERE landing_page_slug IS NOT NULL GROUP BY 2
    UNION ALL SELECT 'platform', platform FROM leads GROUP BY 2`);
  const out: Record<'source' | 'campaign' | 'page' | 'platform', string[]> = { source: [], campaign: [], page: [], platform: [] };
  for (const row of rowsOf<{ k: keyof typeof out; v: string }>(r)) out[row.k].push(row.v);
  for (const k of Object.keys(out) as (keyof typeof out)[]) out[k].sort().splice(200);
  return out;
}
