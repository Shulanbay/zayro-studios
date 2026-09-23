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
  it('accepts a freshly created token for an admin email', () => {
    const token = createLoginToken('owner@zayro.studio');
    const result = verifyLoginToken(token);
    expect(result?.email).toBe('owner@zayro.studio');
  });

  it('rejects a token for a non-admin email even if well-formed', () => {
    // Simulate forging a token payload for a non-admin — verify still
    // rejects it because isAdminEmail is re-checked at verification time,
    // not just baked into the signed payload's trustworthiness.
    process.env.ADMIN_EMAILS = 'owner@zayro.studio';
    const token = createLoginToken('owner@zayro.studio');
    process.env.ADMIN_EMAILS = 'someone-else@zayro.studio'; // admin list changed
    expect(verifyLoginToken(token)).toBeNull();
    process.env.ADMIN_EMAILS = 'owner@zayro.studio, Admin@Example.com';
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
