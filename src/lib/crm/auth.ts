import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { adminProfiles, roles } from '@/lib/db/schema';
import type { AdminProfile, Role } from '@/lib/db/schema';
import { getSessionEmail, isAdminEmail, normalizeEmail } from '@/lib/adminAuth';
import { hasPermission, normalizePermissions, OWNER_ROLE, type Permission } from './permissions';
import { writeAudit } from './audit';

/**
 * Server-side authorisation for the CRM. Every admin route handler and page
 * resolves the signed-in admin from the database on every request, so a
 * disabled admin or a changed role takes effect immediately.
 */

export interface AdminContext {
  id: string;
  email: string;
  fullName: string | null;
  roleId: number;
  roleName: string;
  permissions: string[];
  can(permission: Permission): boolean;
}

function toContext(profile: AdminProfile, role: Role): AdminContext {
  const permissions = normalizePermissions(role.permissions);
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    roleId: role.id,
    roleName: role.name,
    permissions,
    can: (permission) => hasPermission(permissions, permission),
  };
}

async function loadProfile(normalized: string) {
  const rows = await db
    .select({ profile: adminProfiles, role: roles })
    .from(adminProfiles)
    .innerJoin(roles, eq(roles.id, adminProfiles.role_id))
    .where(eq(adminProfiles.normalized_email, normalized))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The admin profile for an email, creating an Owner profile the first time
 * an ADMIN_EMAILS address signs in (idempotent: unique normalized_email +
 * ON CONFLICT DO NOTHING). Returns null for anyone else, and for disabled
 * profiles — once a profile exists, the database decides, not the env var.
 */
export async function resolveAdminProfile(email: string): Promise<{ profile: AdminProfile; role: Role } | null> {
  const normalized = normalizeEmail(email);
  let row = await loadProfile(normalized);

  if (!row && isAdminEmail(normalized)) {
    const owner = await db.query.roles.findFirst({ where: eq(roles.name, OWNER_ROLE) });
    if (!owner) return null;
    await db
      .insert(adminProfiles)
      .values({ email: normalized, normalized_email: normalized, role_id: owner.id, status: 'active', created_by: 'ADMIN_EMAILS' })
      .onConflictDoNothing();
    row = await loadProfile(normalized);
  }

  if (!row || row.profile.status === 'disabled') return null;
  return row;
}

/** May this address request a magic link? (active/invited profile, or a bootstrap Owner). */
export async function canRequestLogin(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (isAdminEmail(normalized)) return true;
  const row = await loadProfile(normalized);
  return !!row && row.profile.status !== 'disabled';
}

/** The signed-in admin for server components, or null. */
export async function getAdminContext(): Promise<AdminContext | null> {
  const email = getSessionEmail();
  if (!email) return null;
  const row = await resolveAdminProfile(email);
  if (!row || row.profile.status !== 'active') return null;
  return toContext(row.profile, row.role);
}

/**
 * CSRF defence in depth on top of the SameSite=Lax cookie: a state-changing
 * request must come from our own origin. Requests without an Origin header
 * (not sent by browsers for same-origin GET, sometimes omitted by non-browser
 * clients) are allowed — they can't carry a victim's cookie cross-site.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type Guard = { ok: true; admin: AdminContext } | { ok: false; response: NextResponse };

/**
 * Route-handler guard. `permission` is required for every mutation; reads
 * pass the permission of the data they return. Failures are audited.
 */
export async function requirePermission(request: NextRequest, permission: Permission | null): Promise<Guard> {
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  if (mutating && !isSameOrigin(request)) {
    await writeAudit({
      actor: null,
      operation: 'auth.csrf_rejected',
      entityType: 'route',
      entityId: request.nextUrl.pathname,
      outcome: 'denied',
    });
    return { ok: false, response: NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 }) };
  }

  const admin = await getAdminContext();
  if (!admin) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (permission && !admin.can(permission)) {
    await writeAudit({
      actor: { id: admin.id, email: admin.email },
      operation: 'auth.permission_denied',
      entityType: 'route',
      entityId: `${request.method} ${request.nextUrl.pathname}`,
      outcome: 'denied',
      metadata: { permission, role: admin.roleName },
    });
    return {
      ok: false,
      response: NextResponse.json({ error: `Your role (${admin.roleName}) does not allow this action` }, { status: 403 }),
    };
  }

  return { ok: true, admin };
}

export function actorOf(admin: AdminContext) {
  return { id: admin.id, email: admin.email };
}

/** Reads a JSON object body; null for invalid JSON or a non-object. */
export async function readJsonObject(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
