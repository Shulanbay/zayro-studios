import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

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

export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(email.trim().toLowerCase());
}

function encodeToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(body);
  return `${body}.${signature}`;
}

function decodeToken(token: string): Record<string, any> | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  if (!safeEqual(sign(body), signature)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function createLoginToken(email: string): string {
  return encodeToken({ email: email.toLowerCase(), exp: Date.now() + LOGIN_TOKEN_TTL_MS, purpose: 'login' });
}

export function verifyLoginToken(token: string): { email: string } | null {
  const payload = decodeToken(token);
  if (!payload || payload.purpose !== 'login') return null;
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  if (typeof payload.email !== 'string' || !isAdminEmail(payload.email)) return null;
  return { email: payload.email };
}

export function createSessionToken(email: string): string {
  return encodeToken({ email: email.toLowerCase(), exp: Date.now() + SESSION_TTL_MS, purpose: 'session' });
}

function verifySessionToken(token: string): { email: string } | null {
  const payload = decodeToken(token);
  if (!payload || payload.purpose !== 'session') return null;
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  if (typeof payload.email !== 'string' || !isAdminEmail(payload.email)) return null;
  return { email: payload.email };
}

export const ADMIN_SESSION_COOKIE = SESSION_COOKIE;
export const ADMIN_SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

/** Reads and verifies the admin session cookie for the current request (server components / route handlers). */
export function getAdminSession(): { email: string } | null {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
