import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { adminProfiles, roles } from '@/lib/db/schema';
import { normalizeEmail } from '@/lib/adminAuth';
import { writeAudit, type AuditActor } from './audit';
import { CrmError, notFound } from './errors';
import { normalizePermissions, OWNER_ROLE, type Permission } from './permissions';

async function activeOwnerCount(tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], excludeProfileId?: string) {
  const owner = await tx.query.roles.findFirst({ where: eq(roles.name, OWNER_ROLE) });
  if (!owner) return 0;
  const conditions = [eq(adminProfiles.role_id, owner.id), eq(adminProfiles.status, 'active')];
  if (excludeProfileId) conditions.push(ne(adminProfiles.id, excludeProfileId));
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(adminProfiles).where(and(...conditions));
  return Number(n);
}

export async function inviteAdmin(input: { email: string; fullName?: string | null; roleId: number }, actor: AuditActor) {
  const normalized = normalizeEmail(input.email);
  const role = await db.query.roles.findFirst({ where: eq(roles.id, input.roleId) });
  if (!role) throw notFound('Role');
  const existing = await db.query.adminProfiles.findFirst({ where: eq(adminProfiles.normalized_email, normalized) });
  if (existing) throw new CrmError('That email is already on the team', 409);
  const [profile] = await db
    .insert(adminProfiles)
    .values({ email: input.email.trim(), normalized_email: normalized, full_name: input.fullName?.trim() || null, role_id: role.id, status: 'invited', created_by: actor.email ?? null })
    .returning();
  await writeAudit({ actor, operation: 'team.invite', entityType: 'admin', entityId: profile.id, after: { email: normalized, role: role.name } });
  return profile;
}

export async function updateAdmin(
  profileId: string,
  changes: { roleId?: number; status?: 'active' | 'disabled'; fullName?: string | null },
  actor: AuditActor & { id?: string | null }
) {
  return db.transaction(async (tx) => {
    // Serialise team changes so two owners can't demote each other at once.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('zayro:team'))`);
    const before = await tx.query.adminProfiles.findFirst({ where: eq(adminProfiles.id, profileId) });
    if (!before) throw notFound('Team member');
    const isSelf = actor.id === before.id;
    if (isSelf && (changes.roleId !== undefined || changes.status !== undefined)) {
      throw new CrmError('You can’t change your own role or access — ask another owner');
    }
    const ownerRole = await tx.query.roles.findFirst({ where: eq(roles.name, OWNER_ROLE) });
    const wasActiveOwner = before.role_id === ownerRole?.id && before.status === 'active';
    const staysActiveOwner = (changes.roleId ?? before.role_id) === ownerRole?.id && (changes.status ?? before.status) === 'active';
    if (wasActiveOwner && !staysActiveOwner && (await activeOwnerCount(tx, before.id)) === 0) {
      throw new CrmError('This is the last active owner. Make someone else an owner first.');
    }
    if (changes.roleId !== undefined && !(await tx.query.roles.findFirst({ where: eq(roles.id, changes.roleId) }))) throw notFound('Role');

    const [after] = await tx
      .update(adminProfiles)
      .set({
        ...(changes.roleId !== undefined ? { role_id: changes.roleId } : {}),
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        ...(changes.fullName !== undefined ? { full_name: changes.fullName?.trim() || null } : {}),
        updated_at: new Date(),
      })
      .where(eq(adminProfiles.id, profileId))
      .returning();
    await writeAudit(
      {
        actor,
        operation: changes.roleId !== undefined && changes.roleId !== before.role_id ? 'team.change_role' : changes.status ? `team.${changes.status === 'disabled' ? 'disable' : 'enable'}` : 'team.update',
        entityType: 'admin',
        entityId: profileId,
        before: { roleId: before.role_id, status: before.status, fullName: before.full_name },
        after: { roleId: after.role_id, status: after.status, fullName: after.full_name },
      },
      tx
    );
    return after;
  });
}

export async function saveCustomRole(
  input: { id?: number; name: string; description?: string | null; permissions: Permission[] },
  actor: AuditActor
) {
  const permissions = normalizePermissions(input.permissions).filter((p) => p !== '*');
  if (input.id) {
    const role = await db.query.roles.findFirst({ where: eq(roles.id, input.id) });
    if (!role) throw notFound('Role');
    if (role.is_system) throw new CrmError('System roles can’t be edited — create a custom role instead');
    const [updated] = await db
      .update(roles)
      .set({ name: input.name.trim(), description: input.description ?? null, permissions, updated_at: new Date() })
      .where(eq(roles.id, role.id))
      .returning();
    await writeAudit({ actor, operation: 'role.update', entityType: 'role', entityId: role.id, before: { name: role.name, permissions: role.permissions }, after: { name: updated.name, permissions } });
    return updated;
  }
  const clash = await db.query.roles.findFirst({ where: eq(roles.name, input.name.trim()) });
  if (clash) throw new CrmError('A role with that name exists', 409);
  const [created] = await db.insert(roles).values({ name: input.name.trim(), description: input.description ?? null, permissions, is_system: false }).returning();
  await writeAudit({ actor, operation: 'role.create', entityType: 'role', entityId: created.id, after: { name: created.name, permissions } });
  return created;
}
