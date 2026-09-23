import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizePrivateKey,
  getGoogleConfigStatus,
  describeMissingConfig,
  getGoogleAuth,
  resetGoogleAuthCache,
  GoogleConfigError,
  GOOGLE_SCOPES,
  safeGoogleErrorMessage,
} from './googleAuth';
import { FAKE_PEM, clearGoogleEnv, setGoogleEnv } from '@/test/fakeGoogle';

describe('normalizePrivateKey', () => {
  it('keeps a key that already has real newlines', () => {
    expect(normalizePrivateKey(FAKE_PEM)).toBe(FAKE_PEM);
  });

  it('converts literal \\n sequences (Vercel / JSON style) into newlines', () => {
    const escaped = FAKE_PEM.replace(/\n/g, '\\n');
    expect(escaped).not.toContain('\n');
    expect(normalizePrivateKey(escaped)).toBe(FAKE_PEM);
  });

  it('trims surrounding whitespace and wrapping quotes', () => {
    expect(normalizePrivateKey(`  \n"${FAKE_PEM.replace(/\n/g, '\\n')}"  \n`)).toBe(FAKE_PEM);
  });

  it('handles CRLF line endings', () => {
    expect(normalizePrivateKey(FAKE_PEM.replace(/\n/g, '\r\n'))).toBe(FAKE_PEM);
  });

  it('rejects values that are not a PEM private key', () => {
    expect(normalizePrivateKey('')).toBe('');
    expect(normalizePrivateKey(undefined)).toBe('');
    expect(normalizePrivateKey('not-a-key')).toBe('');
    expect(normalizePrivateKey('-----BEGIN PRIVATE KEY-----\n...')).toBe('');
  });
});

describe('Google configuration', () => {
  beforeEach(() => {
    clearGoogleEnv();
    resetGoogleAuthCache();
  });
  afterEach(() => clearGoogleEnv());

  it('reports everything missing when no variables are set', () => {
    const s = getGoogleConfigStatus();
    expect(s).toMatchObject({
      serviceAccountEmailPresent: false,
      privateKeyPresent: false,
      privateKeyValid: false,
      calendarIdPresent: false,
      sheetsIdPresent: false,
      calendarConfigured: false,
      sheetsConfigured: false,
    });
    expect(describeMissingConfig('calendar')).toMatch(/GOOGLE_CALENDAR_EMAIL.*GOOGLE_CALENDAR_PRIVATE_KEY.*GOOGLE_CALENDAR_ID/);
    expect(describeMissingConfig('sheets')).toMatch(/GOOGLE_SHEETS_ID/);
  });

  it('throws a GoogleConfigError (without the key) when credentials are missing', () => {
    expect(() => getGoogleAuth()).toThrow(GoogleConfigError);
    process.env.GOOGLE_CALENDAR_EMAIL = 'x@p.iam.gserviceaccount.com';
    process.env.GOOGLE_CALENDAR_PRIVATE_KEY = 'garbage-secret-value';
    try {
      getGoogleAuth();
      throw new Error('expected throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(GoogleConfigError);
      expect(e.message).toMatch(/not a valid PEM/);
      expect(e.message).not.toContain('garbage-secret-value');
    }
  });

  it('is fully configured with the four documented variables', () => {
    setGoogleEnv();
    const s = getGoogleConfigStatus();
    expect(s.calendarConfigured).toBe(true);
    expect(s.sheetsConfigured).toBe(true);
    expect(describeMissingConfig('calendar')).toBeNull();
    expect(describeMissingConfig('sheets')).toBeNull();
  });

  it('flags a malformed key as present but invalid', () => {
    setGoogleEnv();
    process.env.GOOGLE_CALENDAR_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\n...';
    const s = getGoogleConfigStatus();
    expect(s.privateKeyPresent).toBe(true);
    expect(s.privateKeyValid).toBe(false);
    expect(s.calendarConfigured).toBe(false);
  });

  it('accepts GOOGLE_SERVICE_ACCOUNT_* aliases', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'alias@p.iam.gserviceaccount.com';
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = FAKE_PEM;
    process.env.GOOGLE_SHEETS_ID = 'sheet';
    expect(getGoogleConfigStatus().sheetsConfigured).toBe(true);
  });

  it('builds one shared JWT client with Calendar and Sheets scopes', () => {
    setGoogleEnv();
    const a = getGoogleAuth();
    const b = getGoogleAuth();
    expect(a).toBe(b);
    expect(a.scopes).toEqual(GOOGLE_SCOPES);
    expect(GOOGLE_SCOPES).toEqual([
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/spreadsheets',
    ]);
  });
});

describe('safeGoogleErrorMessage', () => {
  it('uses the API message and status', () => {
    const err: any = new Error('Request failed');
    err.response = { status: 403, data: { error: { message: 'The caller does not have permission' } } };
    expect(safeGoogleErrorMessage(err)).toBe('The caller does not have permission (HTTP 403)');
  });

  it('redacts key material and tokens', () => {
    const msg = safeGoogleErrorMessage(new Error(`bad ${FAKE_PEM} Bearer ya29.abc-def token ya29.xyz`));
    expect(msg).not.toContain('MIIE');
    expect(msg).not.toContain('ya29.abc');
    expect(msg).not.toContain('ya29.xyz');
  });
});
