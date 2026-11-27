/** Global marketing settings (single row): custom tracking code, messengers, verification tags. */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { marketingSettings, type MarketingSettings } from '@/lib/db/schema';
import { cleanVerificationTags, type VerificationTag } from './scripts';

export type PublicMarketingSettings = Pick<MarketingSettings, 'whatsapp_number' | 'telegram_username'>;

const EMPTY: MarketingSettings = {
  id: 1,
  scripts_enabled: false,
  global_head_scripts: null,
  global_body_scripts: null,
  global_scripts_consent: 'analytics',
  site_verification: [],
  whatsapp_number: null,
  telegram_username: null,
  use_landing_home: false,
  notify_new_leads: true,
  updated_by: null,
  updated_at: new Date(0),
};

/** Never throws: the public site keeps working without the marketing tables. */
export async function getMarketingSettings(): Promise<MarketingSettings> {
  try {
    const row = await db.query.marketingSettings.findFirst({ where: eq(marketingSettings.id, 1) });
    return row ?? EMPTY;
  } catch (error) {
    console.error('[marketing] settings unavailable:', (error as Error)?.message || error);
    return EMPTY;
  }
}

export function verificationTags(settings: MarketingSettings): VerificationTag[] {
  return cleanVerificationTags(settings.site_verification);
}

/** "+1 (212) 555-0100" → "12125550100" for wa.me links. */
export function whatsappDigits(number: string | null | undefined): string | null {
  const digits = (number ?? '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function telegramHandle(username: string | null | undefined): string | null {
  const u = (username ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
  return /^[A-Za-z0-9_]{5,32}$/.test(u) ? u : null;
}

export function messengerLinks(settings: Pick<MarketingSettings, 'whatsapp_number' | 'telegram_username'>, text?: string) {
  const wa = whatsappDigits(settings.whatsapp_number);
  const tg = telegramHandle(settings.telegram_username);
  return {
    whatsapp: wa ? `https://wa.me/${wa}${text ? `?text=${encodeURIComponent(text)}` : ''}` : null,
    telegram: tg ? `https://t.me/${tg}` : null,
  };
}

/**
 * Custom tracking code runs only on the production site (preview deployments
 * would pollute real pixels), unless ANALYTICS_ALLOW_NON_PRODUCTION=1 or
 * MARKETING_CODE_ALLOW_NON_PRODUCTION=1 is set for testing.
 */
export function customCodeEnvironmentAllowed(): boolean {
  const flag = (n: string) => ['1', 'true'].includes((process.env[n] ?? '').trim().toLowerCase());
  return (process.env.VERCEL_ENV ?? '') === 'production' || flag('ANALYTICS_ALLOW_NON_PRODUCTION') || flag('MARKETING_CODE_ALLOW_NON_PRODUCTION');
}

/**
 * Tags the site already loads from environment variables (Admin → Analytics),
 * named like the snippet inspector so the editor can warn about duplicates.
 * Booleans only — never the IDs themselves.
 */
export function builtInTags(): { vendor: string; configured: boolean }[] {
  const set = (...names: string[]) => names.some((n) => (process.env[n] ?? '').trim().length > 0);
  return [
    { vendor: 'Google Tag Manager', configured: set('NEXT_PUBLIC_GTM_CONTAINER_ID') },
    { vendor: 'Google Analytics 4', configured: set('NEXT_PUBLIC_GA4_MEASUREMENT_ID', 'NEXT_PUBLIC_GOOGLE_ANALYTICS_ID') },
    { vendor: 'Google Ads', configured: set('GOOGLE_ADS_CONVERSION_ID', 'NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID') },
    { vendor: 'Meta Pixel', configured: set('NEXT_PUBLIC_META_PIXEL_ID') },
    { vendor: 'TikTok Pixel', configured: set('NEXT_PUBLIC_TIKTOK_PIXEL_ID') },
    { vendor: 'Reddit Pixel', configured: set('NEXT_PUBLIC_REDDIT_PIXEL_ID') },
    { vendor: 'Pinterest Tag', configured: set('NEXT_PUBLIC_PINTEREST_TAG_ID') },
    { vendor: 'X (Twitter) Pixel', configured: set('NEXT_PUBLIC_X_PIXEL_ID') },
  ];
}
