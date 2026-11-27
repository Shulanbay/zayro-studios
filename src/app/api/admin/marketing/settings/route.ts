import { createHash } from 'crypto';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { marketingSettings, SCRIPT_CONSENT_CATEGORIES } from '@/lib/db/schema';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { hasPermission } from '@/lib/crm/permissions';
import { writeAudit } from '@/lib/crm/audit';
import { checkSnippet, cleanVerificationTags, MAX_SNIPPET_CHARS } from '@/lib/marketing/scripts';
import { getMarketingSettings, telegramHandle, whatsappDigits } from '@/lib/marketing/settings';

export const dynamic = 'force-dynamic';

const schema = z.object({
  scripts_enabled: z.boolean().optional(),
  global_head_scripts: z.string().max(MAX_SNIPPET_CHARS).nullable().optional(),
  global_body_scripts: z.string().max(MAX_SNIPPET_CHARS).nullable().optional(),
  global_scripts_consent: z.enum(SCRIPT_CONSENT_CATEGORIES).optional(),
  site_verification: z.array(z.object({ name: z.string(), content: z.string() })).max(10).optional(),
  whatsapp_number: z.string().trim().max(30).nullable().optional(),
  telegram_username: z.string().trim().max(64).nullable().optional(),
  use_landing_home: z.boolean().optional(),
  notify_new_leads: z.boolean().optional(),
});

const fp = (code: string | null | undefined) => (code ? `${code.length} chars · ${createHash('sha256').update(code).digest('hex').slice(0, 12)}` : null);

/** Global tracking code, verification tags, messenger links and the builder home switch. */
export async function PATCH(request: NextRequest) {
  const guard = await requirePermission(request, 'marketing.scripts');
  if (!guard.ok) return guard.response;
  const parsed = schema.safeParse(await readJsonObject(request));
  if (!parsed.success) return NextResponse.json({ error: `Invalid ${String(parsed.error.issues[0]?.path[0] ?? 'input')}` }, { status: 400 });
  const v = parsed.data;
  if (v.use_landing_home !== undefined && !hasPermission(guard.admin.permissions, 'pages.manage')) return NextResponse.json({ error: 'Your role cannot change the home page' }, { status: 403 });
  for (const code of [v.global_head_scripts, v.global_body_scripts]) {
    const err = checkSnippet(code).find((p) => p.level === 'error');
    if (err) return NextResponse.json({ error: `Tracking code: ${err.code}`, code: err.code }, { status: 400 });
  }
  if (v.whatsapp_number && !whatsappDigits(v.whatsapp_number)) return NextResponse.json({ error: 'WhatsApp number: use international format, e.g. +1 212 555 0100', field: 'whatsapp_number' }, { status: 400 });
  if (v.telegram_username && !telegramHandle(v.telegram_username)) return NextResponse.json({ error: 'Telegram: 5–32 letters, digits or _', field: 'telegram_username' }, { status: 400 });

  const before = await getMarketingSettings();
  const set: Partial<typeof marketingSettings.$inferInsert> = { updated_at: new Date(), updated_by: guard.admin.email };
  for (const [k, val] of Object.entries(v)) if (val !== undefined) (set as Record<string, unknown>)[k] = val;
  if (v.site_verification) set.site_verification = cleanVerificationTags(v.site_verification);
  if (v.telegram_username !== undefined) set.telegram_username = telegramHandle(v.telegram_username);
  if (set.global_head_scripts === '') set.global_head_scripts = null;
  if (set.global_body_scripts === '') set.global_body_scripts = null;
  await db.insert(marketingSettings).values({ id: 1, ...set }).onConflictDoUpdate({ target: marketingSettings.id, set });
  const after = await db.query.marketingSettings.findFirst({ where: eq(marketingSettings.id, 1) });
  try {
    revalidatePath('/', 'layout');
  } catch {
    // tests
  }
  await writeAudit({
    actor: actorOf(guard.admin),
    operation: v.scripts_enabled !== undefined && v.scripts_enabled !== before.scripts_enabled ? (v.scripts_enabled ? 'tracking.enable' : 'tracking.disable') : 'tracking.update',
    entityType: 'marketing_settings',
    entityId: 1,
    before: { enabled: before.scripts_enabled, head: fp(before.global_head_scripts), body: fp(before.global_body_scripts), consent: before.global_scripts_consent, verification: (before.site_verification as unknown[]).length, homeFromBuilder: before.use_landing_home },
    after: { enabled: after?.scripts_enabled, head: fp(after?.global_head_scripts), body: fp(after?.global_body_scripts), consent: after?.global_scripts_consent, verification: (after?.site_verification as unknown[] | undefined)?.length ?? 0, homeFromBuilder: after?.use_landing_home },
  });
  return NextResponse.json({ message: 'Settings saved' });
}
