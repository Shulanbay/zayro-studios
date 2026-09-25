import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { adminProfiles, roles } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { getAdminEmails } from '@/lib/adminAuth';
import { hasPermission, normalizePermissions, PERMISSION_GROUPS, PERMISSIONS } from '@/lib/crm/permissions';
import { formatInstantEt } from '@/lib/crm/time';
import { Badge, Card, Forbidden, Notice, PageHeader, StatusBadge } from '@/components/crm/ui';
import { InviteForm, MemberControls, RoleEditor } from '@/components/crm/team';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('team.manage')) return <Forbidden what="team settings" />;

  const [members, roleRows] = await Promise.all([
    db.select({ p: adminProfiles, role: roles.name }).from(adminProfiles).innerJoin(roles, eq(roles.id, adminProfiles.role_id)).orderBy(asc(adminProfiles.created_at)),
    db.query.roles.findMany({ orderBy: [asc(roles.id)] }),
  ]);
  const bootstrap = new Set(getAdminEmails());
  const roleOpts = roleRows.map((r) => ({ id: r.id, name: r.name }));
  const groups = PERMISSION_GROUPS.map((g) => ({ label: g.label, permissions: [...g.permissions] }));

  return (
    <>
      <PageHeader title="Team & roles" description="Everyone signs in with a one-time email link. Access is checked on the server for every page and action." />
      <div className="grid gap-4">
        <Card title="Add a team member">
          <InviteForm roles={roleOpts} />
        </Card>

        <Card title={`Team (${members.length})`}>
          <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
            <table className="crm-table min-w-[760px]">
              <caption className="sr-only">Team members</caption>
              <thead>
                <tr>
                  <th scope="col">Member</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {members.map(({ p, role }) => (
                  <tr key={p.id}>
                    <td>
                      {p.full_name || p.email}
                      <div className="text-xs text-zayro-gray break-all">{p.email}</div>
                      {bootstrap.has(p.normalized_email) && <Badge tone="blue" title="Listed in the ADMIN_EMAILS environment variable">ADMIN_EMAILS</Badge>}
                    </td>
                    <td>{role}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="text-xs whitespace-nowrap">{p.last_login_at ? formatInstantEt(p.last_login_at) : 'Never'}</td>
                    <td>
                      <MemberControls id={p.id} roleId={p.role_id} status={p.status} roles={roleOpts} isSelf={p.id === admin.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Permissions by role" actions={<RoleEditor role={null} groups={groups} labels={PERMISSIONS} />}>
          <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
            <table className="crm-table min-w-[720px]">
              <caption className="sr-only">Permission matrix</caption>
              <thead>
                <tr>
                  <th scope="col">Permission</th>
                  {roleRows.map((r) => (
                    <th key={r.id} scope="col" className="text-center">
                      {r.name}
                      {!r.is_system && (
                        <div className="normal-case font-normal mt-1">
                          <RoleEditor role={{ id: r.id, name: r.name, description: r.description ?? '', permissions: normalizePermissions(r.permissions) as string[] }} groups={groups} labels={PERMISSIONS} />
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_GROUPS.flatMap((g) =>
                  g.permissions.map((p, i) => (
                    <tr key={p}>
                      <td>
                        {i === 0 && <div className="text-[11px] uppercase tracking-wide text-zayro-gray">{g.label}</div>}
                        {PERMISSIONS[p]}
                      </td>
                      {roleRows.map((r) => {
                        const ok = hasPermission(normalizePermissions(r.permissions), p);
                        return (
                          <td key={r.id} className="text-center" aria-label={ok ? 'Allowed' : 'Not allowed'}>
                            {ok ? <span className="text-emerald-700">✓</span> : <span className="text-slate-300">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Notice tone="blue">
          Addresses in the ADMIN_EMAILS environment variable get an Owner profile the first time they sign in. After that, this page decides: disabling a member takes effect on their next request. The last active owner can’t be removed.
        </Notice>
      </div>
    </>
  );
}
