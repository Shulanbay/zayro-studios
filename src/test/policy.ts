/**
 * The booking flow sends `policyAccepted: true` once the customer ticks the
 * policy checkbox. Existing route tests model a customer who did; tests of
 * the checkbox itself post without this helper.
 */
const POLICY_ROUTES = ['/api/payment/create-checkout-session', '/api/booking/confirm-free', '/api/packages/book'];

export function withPolicy(url: string, body: unknown): unknown {
  if (!POLICY_ROUTES.some((r) => url.startsWith(r)) || !body || typeof body !== 'object' || Array.isArray(body)) return body;
  return 'policyAccepted' in (body as Record<string, unknown>) ? body : { ...(body as Record<string, unknown>), policyAccepted: true };
}
