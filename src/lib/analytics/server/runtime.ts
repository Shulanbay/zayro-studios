/**
 * Network transport for analytics destinations, replaceable in tests.
 *
 * Automated tests can never reach a vendor: under Vitest the default
 * transport refuses every request, so a test that forgets to install a
 * fake fails loudly instead of sending data to GA4, Meta, Reddit,
 * Pinterest or TikTok.
 */

export interface TransportRequest {
  destination: string;
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

export interface TransportResponse {
  ok: boolean;
  status: number;
  /** First characters of the response body (sanitised before storing). */
  text: string;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

const inTests = () => process.env.NODE_ENV === 'test' || !!process.env.VITEST;

const fetchTransport: Transport = async (req) => {
  if (inTests()) throw new Error('Network access to analytics vendors is disabled in tests');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: controller.signal, cache: 'no-store' });
    const text = (await res.text().catch(() => '')).slice(0, 500);
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
};

const state: { transport: Transport; vendorsAllowedOverride: boolean | null } = { transport: fetchTransport, vendorsAllowedOverride: null };

export function getTransport(): Transport {
  return state.transport;
}

/** Tests only: install a fake transport and allow vendor delivery in the test environment. */
export function __setAnalyticsTestRuntime(options: { transport?: Transport | null; vendorsAllowed?: boolean | null }) {
  if (!inTests()) throw new Error('__setAnalyticsTestRuntime is for tests only');
  if (options.transport !== undefined) state.transport = options.transport ?? fetchTransport;
  if (options.vendorsAllowed !== undefined) state.vendorsAllowedOverride = options.vendorsAllowed;
}

export function vendorsAllowedOverride(): boolean | null {
  return inTests() ? state.vendorsAllowedOverride : null;
}
