import { createHmac, timingSafeEqual } from 'node:crypto';

export const PACKAGE_COOKIE = 'zayro_package_access';

/** A resource-scoped capability: knowing an email or order id grants no access. */
export function packageAccessToken(purchaseId: string): string {
  const key = process.env.NEXTAUTH_SECRET || process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Package access signing is not configured');
  const signature = createHmac('sha256', key).update(`zayro:package:v1:${purchaseId}`).digest('hex');
  return `${purchaseId}.${signature}`;
}

export function purchaseIdFromToken(token: unknown): string | null {
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}\.[0-9a-f]{64}$/i.test(token)) return null;
  const id = token.split('.')[0];
  const expected = Buffer.from(packageAccessToken(id));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? id : null;
}
