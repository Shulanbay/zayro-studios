import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit, isHoneypotTripped } from '@/lib/crm/rateLimit';
import { isValidEmail, getBaseUrl } from '@/lib/utils';
import { createLead, leadAttribution } from '@/lib/marketing/leads';
import { getMarketingSettings } from '@/lib/marketing/settings';
import { notifyNewLead } from '@/lib/marketing/notify';
import { getPublishedLanding } from '@/lib/marketing/pages';
import { analyticsContactSubmitted } from '@/lib/analytics/server/hooks';

export const dynamic = 'force-dynamic';

const PHONE = /^\+?[\d\s().-]{7,25}$/;

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).refine((v) => PHONE.test(v), 'phone'),
  email: z.string().trim().max(255).optional().default(''),
  message: z.string().trim().max(3000).optional().default(''),
  consent: z.boolean().optional(),
  touch: z
    .object({
      landingSlug: z.string().max(80).nullable().optional(),
      pagePath: z.string().max(300).nullable().optional(),
      referrer: z.string().max(1000).nullable().optional(),
      utm: z.record(z.unknown()).optional(),
      clickIds: z.record(z.unknown()).optional(),
    })
    .optional()
    .default({}),
});

/** Lead form on landing pages. Rate-limited, honeypot-protected; nothing is sent to ad platforms except the server-verified "lead" conversion. */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'lead', 8, 600);
  if (limited) return limited;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || isHoneypotTripped(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? 'input');
    return NextResponse.json({ error: field === 'phone' ? 'Please enter a valid phone number' : field === 'name' ? 'Please enter your name' : 'Invalid request', field }, { status: 400 });
  }
  const v = parsed.data;
  if (v.email && !isValidEmail(v.email)) return NextResponse.json({ error: 'Please enter a valid email', field: 'email' }, { status: 400 });

  // Only real, published pages count as a landing page source.
  const slug = typeof v.touch.landingSlug === 'string' ? v.touch.landingSlug : null;
  const page = slug ? await getPublishedLanding(slug) : null;
  try {
    const attribution = await leadAttribution(request, { ...v.touch, landingSlug: page ? slug : null }, request.nextUrl.host);
    const lead = await createLead({ name: v.name, phone: v.phone, email: v.email || null, message: v.message || null, contact_method: 'form' }, attribution);
    const settings = await getMarketingSettings();
    if (settings.notify_new_leads) await notifyNewLead(lead, getBaseUrl(request));
    const conversion = await analyticsContactSubmitted(request, `lead-${lead.id}`, page ? `landing:${slug}` : null, page ? `/${slug}` : attribution.landing_path ?? '/');
    return NextResponse.json({ success: true, conversion });
  } catch (error) {
    console.error('[marketing] lead capture failed:', (error as Error)?.message || error);
    return NextResponse.json({ error: 'Could not send right now. Please call or message us.' }, { status: 500 });
  }
}
