import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

/**
 * Signed tokens for the admin magic link and the admin session cookie.
 * This module only proves *who* a token was issued to and that it hasn't
 * expired; whether that person is (still) an active admin, and what they
 * may do, is decided from the database on every request (src/lib/crm/auth.ts).
 */

const SESSION_COOKIE = 'zayro_admin_session';
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // magic link valid for 15 minutes
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // admin session lasts 8 hours

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is not configured — admin auth is unavailable.');
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Bootstrap Owners: an address here gets an Owner profile on first sign-in. */
export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(normalizeEmail(email));
}

function encodeToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(body);
  return `${body}.${signature}`;
}

function decodeToken(token: string): Record<string, any> | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  if (!safeEqual(sign(body), signature)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export interface LoginTokenPayload {
  email: string;
  /** One-time id; consumed in admin_login_tokens when the link is used. */
  jti: string;
  exp: number;
}

export function createLoginToken(email: string, now = Date.now()): string {
  return encodeToken({
    email: normalizeEmail(email),
    jti: randomBytes(16).toString('hex'),
    exp: now + LOGIN_TOKEN_TTL_MS,
    purpose: 'login',
  });
}

export function verifyLoginToken(token: string, now = Date.now()): LoginTokenPayload | null {
  const payload = decodeToken(token);
  if (!payload || payload.purpose !== 'login') return null;
  if (typeof payload.exp !== 'number' || now > payload.exp) return null;
  if (typeof payload.email !== 'string' || !payload.email) return null;
  if (typeof payload.jti !== 'string' || !/^[0-9a-f]{32}$/.test(payload.jti)) return null;
  return { email: payload.email, jti: payload.jti, exp: payload.exp };
}

export function createSessionToken(email: string, now = Date.now()): string {
  return encodeToken({ email: normalizeEmail(email), exp: now + SESSION_TTL_MS, purpose: 'session' });
}

export function verifySessionToken(token: string, now = Date.now()): { email: string } | null {
  const payload = decodeToken(token);
  if (!payload || payload.purpose !== 'session') return null;
  if (typeof payload.exp !== 'number' || now > payload.exp) return null;
  if (typeof payload.email !== 'string' || !payload.email) return null;
  return { email: payload.email };
}

export const ADMIN_SESSION_COOKIE = SESSION_COOKIE;
export const ADMIN_SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

/**
 * The email in a valid session cookie, or null. Identity only — use
 * getAdminContext()/requirePermission() from src/lib/crm/auth.ts for
 * authorisation.
 */
export function getSessionEmail(): string | null {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token)?.email ?? null;
}
