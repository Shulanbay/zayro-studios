import { createHash } from 'crypto';
import { google } from 'googleapis';

/**
 * Single place that knows how to authenticate to Google as the ZAYRO
 * Studios service account. Calendar and Sheets share one JWT client (one
 * key, both scopes) — the service account only has access to the specific
 * calendar and spreadsheet that were explicitly shared with it, nothing
 * else in the Google Cloud project.
 *
 * Server-only: this module reads the private key from process.env and must
 * never be imported from a client component. None of these functions ever
 * log or return the key itself.
 */

if (typeof window !== 'undefined') {
  throw new Error('googleAuth must only be used on the server');
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
];

export class GoogleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleConfigError';
  }
}

// GOOGLE_CALENDAR_* were the original names and stay primary; the
// GOOGLE_SERVICE_ACCOUNT_* aliases are accepted since the same account now
// also serves Sheets.
function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value;
  }
  return '';
}

function rawServiceAccountEmail(): string {
  return readEnv('GOOGLE_CALENDAR_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_EMAIL').trim();
}

function rawPrivateKey(): string {
  return readEnv('GOOGLE_CALENDAR_PRIVATE_KEY', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
}

export function getCalendarId(): string {
  return (process.env.GOOGLE_CALENDAR_ID || '').trim();
}

export function getSheetsId(): string {
  return (process.env.GOOGLE_SHEETS_ID || '').trim();
}

/**
 * Turns whatever ended up in the env var into a real PEM string:
 * - surrounding whitespace and wrapping quotes (from copy-pasting the JSON
 *   value) are dropped;
 * - literal "\n" two-character sequences (how the JSON file and most env
 *   UIs store it) become real newlines;
 * - CRLF becomes LF.
 * Returns '' when the result doesn't look like a PEM private key.
 */
export function normalizePrivateKey(raw: string | undefined | null): string {
  if (!raw) return '';
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key) || !/-----END [A-Z ]*PRIVATE KEY-----/.test(key)) {
    return '';
  }
  return `${key}\n`;
}

export interface GoogleConfigStatus {
  serviceAccountEmailPresent: boolean;
  privateKeyPresent: boolean;
  privateKeyValid: boolean;
  calendarIdPresent: boolean;
  sheetsIdPresent: boolean;
  calendarConfigured: boolean;
  sheetsConfigured: boolean;
}

/** Yes/no view of the configuration — safe to show in the admin panel. */
export function getGoogleConfigStatus(): GoogleConfigStatus {
  const serviceAccountEmailPresent = /@.+\.iam\.gserviceaccount\.com$/.test(rawServiceAccountEmail());
  const privateKeyPresent = rawPrivateKey().trim().length > 0;
  const privateKeyValid = normalizePrivateKey(rawPrivateKey()) !== '';
  const credentialsOk = serviceAccountEmailPresent && privateKeyValid;
  const calendarIdPresent = getCalendarId() !== '';
  const sheetsIdPresent = getSheetsId() !== '';
  return {
    serviceAccountEmailPresent,
    privateKeyPresent,
    privateKeyValid,
    calendarIdPresent,
    sheetsIdPresent,
    calendarConfigured: credentialsOk && calendarIdPresent,
    sheetsConfigured: credentialsOk && sheetsIdPresent,
  };
}

/** Human-readable reason why an integration is not usable, or null if it is. */
export function describeMissingConfig(target: 'calendar' | 'sheets'): string | null {
  const s = getGoogleConfigStatus();
  const missing: string[] = [];
  if (!s.serviceAccountEmailPresent) missing.push('GOOGLE_CALENDAR_EMAIL (service account client_email)');
  if (!s.privateKeyPresent) missing.push('GOOGLE_CALENDAR_PRIVATE_KEY');
  else if (!s.privateKeyValid) missing.push('GOOGLE_CALENDAR_PRIVATE_KEY (not a valid PEM private key)');
  if (target === 'calendar' && !s.calendarIdPresent) missing.push('GOOGLE_CALENDAR_ID');
  if (target === 'sheets' && !s.sheetsIdPresent) missing.push('GOOGLE_SHEETS_ID');
  return missing.length ? `Google ${target === 'calendar' ? 'Calendar' : 'Sheets'} not configured: ${missing.join(', ')}` : null;
}

let cached: { fingerprint: string; client: InstanceType<typeof google.auth.JWT> } | null = null;

/**
 * Returns the shared JWT client, reusing it (and its cached access token)
 * across calls in the same server instance. Throws GoogleConfigError with a
 * safe message when credentials are missing or malformed.
 */
export function getGoogleAuth(): InstanceType<typeof google.auth.JWT> {
  const email = rawServiceAccountEmail();
  const key = normalizePrivateKey(rawPrivateKey());
  if (!email) {
    throw new GoogleConfigError('Google service account email is not configured (GOOGLE_CALENDAR_EMAIL)');
  }
  if (!key) {
    throw new GoogleConfigError(
      rawPrivateKey().trim()
        ? 'GOOGLE_CALENDAR_PRIVATE_KEY is set but is not a valid PEM private key'
        : 'Google service account private key is not configured (GOOGLE_CALENDAR_PRIVATE_KEY)'
    );
  }

  const fingerprint = createHash('sha256').update(email).update('\0').update(key).digest('hex');
  if (cached?.fingerprint === fingerprint) return cached.client;

  const client = new google.auth.JWT({ email, key, scopes: GOOGLE_SCOPES });
  cached = { fingerprint, client };
  return client;
}

/** For tests: forget the cached client so env changes take effect. */
export function resetGoogleAuthCache() {
  cached = null;
}

/**
 * Extracts a short, loggable message from a googleapis/gaxios error. Never
 * includes request config, headers, tokens or key material.
 */
export function safeGoogleErrorMessage(error: unknown): string {
  const err = error as any;
  const apiMessage = err?.response?.data?.error?.message || err?.errors?.[0]?.message;
  const status = err?.response?.status || err?.code;
  let message = String(apiMessage || err?.message || error || 'Unknown error');
  message = message
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[redacted key]')
    .replace(/ya29\.[\w.-]+/g, '[redacted token]')
    .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [redacted]');
  if (message.length > 300) message = `${message.slice(0, 300)}…`;
  return status && typeof status === 'number' ? `${message} (HTTP ${status})` : message;
}

export function googleErrorStatus(error: unknown): number | undefined {
  const err = error as any;
  const status = err?.response?.status ?? err?.code;
  return typeof status === 'number' ? status : undefined;
}
