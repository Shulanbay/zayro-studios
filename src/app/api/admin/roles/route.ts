import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { actorOf, readJsonObject, requirePermission } from '@/lib/crm/auth';
import { errorResponse } from '@/lib/crm/errors';
import { saveCustomRole } from '@/lib/crm/team';
import { ALL_PERMISSIONS, type Permission } from '@/lib/crm/permissions';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(500).optional().nullable(),
    permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(ALL_PERMISSIONS.length),
  })
  .strict();

/** Creates or edits a custom role. System roles are read-only. */
export async function POST(request: NextRequest) {
  const guard = await requirePermission(request, 'team.manage');
  if (!guard.ok) return guard.response;
  try {
    const v = schema.parse(await readJsonObject(request));
    const role = await saveCustomRole(v, actorOf(guard.admin));
    return NextResponse.json({ id: role.id, message: v.id ? 'Role saved' : 'Role created' });
  } catch (error) {
    return errorResponse(error, 'save role');
  }
}
