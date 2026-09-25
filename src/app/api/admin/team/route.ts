import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { errorResponse } from '@/lib/crm/errors';
import { inviteAdmin, updateAdmin } from '@/lib/crm/team';
import { uuid } from '@/lib/crm/validation';

export const dynamic = 'force-dynamic';

const inviteSchema = z.object({ email: z.string().trim().email().max(255), fullName: z.string().trim().max(255).optional().nullable(), roleId: z.number().int().positive() }).strict();
const updateSchema = z
  .object({ id: uuid, roleId: z.number().int().positive().optional(), status: z.enum(['active', 'disabled']).optional(), fullName: z.string().trim().max(255).optional().nullable() })
  .strict();

/** Adds a team member. They sign in with a magic link at /admin/login (their profile becomes active on first sign-in). */
export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'team.manage');
  if (!guard.ok) return guard.response;
  try {
    const v = inviteSchema.parse(await readJsonObject(request));
    const profile = await inviteAdmin(v, actorOf(guard.admin));
    return NextResponse.json({ id: profile.id, message: `Invited ${profile.email}. They can now sign in at /admin/login.` });
  } catch (error) {
    return errorResponse(error, 'invite admin');
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await requirePermission(request, 'team.manage');
  if (!guard.ok) return guard.response;
  try {
    const { id, ...changes } = updateSchema.parse(await readJsonObject(request));
    await updateAdmin(id, changes, actorOf(guard.admin));
    return NextResponse.json({ message: 'Team member updated' });
  } catch (error) {
    return errorResponse(error, 'update admin');
  }
}
