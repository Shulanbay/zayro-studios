/**
 * Cookie consent: three categories, a versioned choice and the Google
 * Consent Mode v2 signals derived from it. Pure — used by the banner, the
 * inline consent-default script, the collect endpoint and server recorders.
 *
 *   necessary   — always on: booking state, security, Stripe checkout,
 *                 admin sign-in, Manage Booking, rate limiting / CSRF.
 *   analytics   — first-party visitor/session analytics and GA4.
 *   advertising — Google Ads, Meta, Reddit, Pinterest, TikTok pixels and
 *                 their server-side (Conversions API) counterparts, and the
 *                 ad click identifiers they rely on.
 *
 * Until the visitor chooses, everything except necessary is denied.
 * Bumping CONSENT_VERSION asks everyone again.
 */

export const CONSENT_VERSION = '2026-11';
export const CONSENT_COOKIE = 'zayro_consent';
/** Consent choices are kept for 12 months, then the banner asks again. */
export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export interface ConsentState {
  version: string;
  /** Random consent identifier (proof of choice); not linked to any person. */
  consentId: string;
  analytics: boolean;
  advertising: boolean;
  /** Unix seconds when the choice was made. */
  decidedAt: number;
}

export type ConsentAction = 'accept_all' | 'reject_all' | 'custom' | 'withdraw';

export const DENIED: Pick<ConsentState, 'analytics' | 'advertising'> = { analytics: false, advertising: false };

export interface ConsentModeSignals {
  analytics_storage: 'granted' | 'denied';
  ad_storage: 'granted' | 'denied';
  ad_user_data: 'granted' | 'denied';
  ad_personalization: 'granted' | 'denied';
}

export const DEFAULT_CONSENT_MODE: ConsentModeSignals = {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
};

export function consentModeSignals(state: Pick<ConsentState, 'analytics' | 'advertising'> | null | undefined): ConsentModeSignals {
  if (!state) return { ...DEFAULT_CONSENT_MODE };
  const ad = state.advertising ? 'granted' : 'denied';
  return { analytics_storage: state.analytics ? 'granted' : 'denied', ad_storage: ad, ad_user_data: ad, ad_personalization: ad };
}

const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const VERSION_RE = /^[0-9A-Za-z.-]{1,20}$/;

/** Cookie value: v1.<version>.<consentId>.<a0|a1>.<d0|d1>.<decidedAt> */
export function serializeConsent(state: ConsentState): string {
  return ['v1', state.version, state.consentId, state.analytics ? 'a1' : 'a0', state.advertising ? 'd1' : 'd0', String(Math.floor(state.decidedAt))].join('~');
}

export function parseConsent(value: string | null | undefined): ConsentState | null {
  if (!value || typeof value !== 'string' || value.length > 200) return null;
  let raw = value;
  try {
    raw = decodeURIComponent(value);
  } catch {
    return null;
  }
  const parts = raw.split('~');
  if (parts.length !== 6 || parts[0] !== 'v1') return null;
  const [, version, consentId, a, d, at] = parts;
  if (!VERSION_RE.test(version) || !ID_RE.test(consentId)) return null;
  if (!['a0', 'a1'].includes(a) || !['d0', 'd1'].includes(d)) return null;
  const decidedAt = Number(at);
  if (!Number.isInteger(decidedAt) || decidedAt <= 0) return null;
  return { version, consentId, analytics: a === 'a1', advertising: d === 'd1', decidedAt };
}

/** A stored choice counts only for the current policy version. */
export function currentConsent(value: string | null | undefined): ConsentState | null {
  const parsed = parseConsent(value);
  return parsed && parsed.version === CONSENT_VERSION ? parsed : null;
}

export function readConsentFromCookieHeader(cookieHeader: string | null | undefined): ConsentState | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === CONSENT_COOKIE) return currentConsent(rest.join('='));
  }
  return null;
}

export function choiceFor(action: ConsentAction, custom?: { analytics: boolean; advertising: boolean }) {
  switch (action) {
    case 'accept_all':
      return { analytics: true, advertising: true };
    case 'reject_all':
    case 'withdraw':
      return { analytics: false, advertising: false };
    case 'custom':
      return { analytics: !!custom?.analytics, advertising: !!custom?.advertising };
  }
}

/** Whether a stored consent (possibly null = never chosen) allows a category. */
export function allows(state: Pick<ConsentState, 'analytics' | 'advertising'> | null | undefined, category: 'analytics' | 'advertising'): boolean {
  return !!state && state[category] === true;
}

/**
 * Global Privacy Control (navigator.globalPrivacyControl / `Sec-GPC: 1`) is an
 * opt-out of sale/sharing: advertising stays denied whatever the banner says.
 * Analytics remains the visitor's own choice.
 */
export function applyGpc<T extends Pick<ConsentState, 'advertising'>>(state: T | null, gpc: boolean): T | null {
  return state && gpc && state.advertising ? { ...state, advertising: false } : state;
}

export function gpcFromHeaders(headers: { get(name: string): string | null }): boolean {
  return headers.get('sec-gpc')?.trim() === '1';
}
