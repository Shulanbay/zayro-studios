import { timingSafeEqual } from 'crypto';

/**
 * The analytics delivery-retry and retention job is authorised by exactly
 * one secret: CRON_SECRET.
 *
 * Why this name: Vercel Cron cannot send custom headers. When the project
 * has an environment variable named CRON_SECRET, Vercel automatically adds
 * `Authorization: Bearer <CRON_SECRET>` to every cron invocation — no other
 * variable name is supported. Using CRON_SECRET everywhere avoids a second
 * copy of the same secret. Values shorter than 16 characters are refused.
 * The secret is only compared (constant time), never logged or put in a URL.
 */
export const CRON_SECRET_NAME = 'CRON_SECRET';

export function cronSecretConfigured(): boolean {
  return (process.env[CRON_SECRET_NAME] ?? '').length >= 16;
}

export function authorisedCron(header: string | null): boolean {
  const secret = process.env[CRON_SECRET_NAME];
  if (!secret || secret.length < 16) return false;
  const presented = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
