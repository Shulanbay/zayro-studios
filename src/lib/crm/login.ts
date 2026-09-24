import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { adminLoginTokens, adminProfiles } from '@/lib/db/schema';
import { verifyLoginToken } from '@/lib/adminAuth';
import { resolveAdminProfile } from './auth';
import { writeAudit } from './audit';

export type ConsumeResult = { ok: true; email: string } | { ok: false; reason: 'invalid_or_expired' | 'already_used' | 'not_admin' };

/**
 * Exchanges a magic-link token for a session: checks the signature and
 * expiry, that the address is (still) an admin, and consumes the token's
 * one-time id so the link can never be used again.
 */
export async function consumeLoginToken(token: string): Promise<ConsumeResult> {
  const payload = verifyLoginToken(token);
  if (!payload) {
    await writeAudit({ actor: null, operation: 'auth.login_failed', entityType: 'admin', outcome: 'denied', metadata: { reason: 'invalid_or_expired' } });
    return { ok: false, reason: 'invalid_or_expired' };
  }

  const admin = await resolveAdminProfile(payload.email);
  if (!admin) {
    await writeAudit({ actor: { email: payload.email }, operation: 'auth.login_failed', entityType: 'admin', outcome: 'denied', metadata: { reason: 'not_admin' } });
    return { ok: false, reason: 'not_admin' };
  }

  const consumed = await db
    .insert(adminLoginTokens)
    .values({ jti: payload.jti, normalized_email: payload.email, expires_at: new Date(payload.exp) })
    .onConflictDoNothing()
    .returning({ jti: adminLoginTokens.jti });
  if (consumed.length === 0) {
    await writeAudit({ actor: { id: admin.profile.id, email: admin.profile.email }, operation: 'auth.login_failed', entityType: 'admin', entityId: admin.profile.id, outcome: 'denied', metadata: { reason: 'already_used' } });
    return { ok: false, reason: 'already_used' };
  }

  await db
    .update(adminProfiles)
    .set({ last_login_at: new Date(), status: admin.profile.status === 'invited' ? 'active' : admin.profile.status, updated_at: new Date() })
    .where(eq(adminProfiles.id, admin.profile.id));
  await writeAudit({
    actor: { id: admin.profile.id, email: admin.profile.email },
    operation: 'auth.login',
    entityType: 'admin',
    entityId: admin.profile.id,
    metadata: { role: admin.role.name },
  });
  return { ok: true, email: admin.profile.normalized_email };
}
