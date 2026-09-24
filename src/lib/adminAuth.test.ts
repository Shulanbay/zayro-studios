import { describe, it, expect, beforeAll } from 'vitest';
import { isAdminEmail, createLoginToken, verifyLoginToken, createSessionToken } from './adminAuth';

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-do-not-use-in-prod';
  process.env.ADMIN_EMAILS = 'owner@zayro.studio, Admin@Example.com';
});

describe('isAdminEmail', () => {
  it('matches case-insensitively and trims whitespace', () => {
    expect(isAdminEmail('owner@zayro.studio')).toBe(true);
    expect(isAdminEmail('OWNER@ZAYRO.STUDIO')).toBe(true);
    expect(isAdminEmail('admin@example.com')).toBe(true);
    expect(isAdminEmail('random@gmail.com')).toBe(false);
  });
});

describe('login token', () => {
  it('accepts a freshly created token', () => {
    const token = createLoginToken('owner@zayro.studio');
    const result = verifyLoginToken(token);
    expect(result?.email).toBe('owner@zayro.studio');
  });

  it('carries a one-time id and expires after 15 minutes', () => {
    const now = Date.now();
    const token = createLoginToken('Owner@Zayro.Studio ', now);
    const ok = verifyLoginToken(token, now + 14 * 60 * 1000);
    expect(ok?.email).toBe('owner@zayro.studio');
    expect(ok?.jti).toMatch(/^[0-9a-f]{32}$/);
    expect(verifyLoginToken(token, now + 16 * 60 * 1000)).toBeNull();
    // Two links for the same address are distinct (each can be consumed once).
    expect(verifyLoginToken(createLoginToken('owner@zayro.studio', now), now)?.jti).not.toBe(ok?.jti);
  });

  it('rejects a tampered token', () => {
    const token = createLoginToken('owner@zayro.studio');
    const tampered = token.slice(0, -1) + (token.slice(-1) === 'A' ? 'B' : 'A');
    expect(verifyLoginToken(tampered)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(verifyLoginToken('not-a-token')).toBeNull();
    expect(verifyLoginToken('')).toBeNull();
  });

  it('rejects a session token presented as a login token (purpose mismatch)', () => {
    const sessionToken = createSessionToken('owner@zayro.studio');
    expect(verifyLoginToken(sessionToken)).toBeNull();
  });
});
