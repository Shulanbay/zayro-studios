import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rowsOf } from '@/lib/db/types';

/**
 * Fixed-window rate limiting for public endpoints, stored in Postgres so it
 * holds across serverless instances. Keys are salted SHA-256 hashes of the
 * client IP — raw IPs are never stored. Fails open: a rate-limit error must
 * never block a real customer's booking.
 */

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return (forwarded?.split(',')[0] || request.headers.get('x-real-ip') || 'unknown').trim();
}

export function rateLimitKey(bucket: string, ip: string): string {
  const salt = process.env.NEXTAUTH_SECRET || 'zayro';
  return `${bucket}:${createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32)}`;
}

export async function hitRateLimit(bucket: string, ip: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; count: number }> {
  try {
    const key = rateLimitKey(bucket, ip);
    const window = `${Math.max(1, Math.floor(windowSeconds))} seconds`;
    const result = await db.execute(sql`
      INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limits.window_start < now() - ${window}::interval THEN 1 ELSE rate_limits.count + 1 END,
        window_start = CASE WHEN rate_limits.window_start < now() - ${window}::interval THEN now() ELSE rate_limits.window_start END
      RETURNING count
    `);
    const count = Number(rowsOf<{ count: number }>(result)[0]?.count ?? 0);
    return { allowed: count <= limit, count };
  } catch (error) {
    console.error('[rate-limit] check failed, allowing request:', (error as Error)?.message || error);
    return { allowed: true, count: 0 };
  }
}

/** Returns a 429 response when the caller is over the limit, otherwise null. */
export async function enforceRateLimit(request: NextRequest, bucket: string, limit: number, windowSeconds: number): Promise<NextResponse | null> {
  const { allowed } = await hitRateLimit(bucket, clientIp(request), limit, windowSeconds);
  if (allowed) return null;
  return NextResponse.json(
    { error: 'Too many requests. Please wait a few minutes and try again.' },
    { status: 429, headers: { 'Retry-After': String(windowSeconds) } }
  );
}

/** Honeypot: a hidden form field real people never fill in. */
export function isHoneypotTripped(body: Record<string, unknown> | null | undefined): boolean {
  const value = body?.website ?? body?.company_website;
  return typeof value === 'string' && value.trim().length > 0;
}
