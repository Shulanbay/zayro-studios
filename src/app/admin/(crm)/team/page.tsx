import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { adminProfiles, roles } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { getAdminEmails } from '@/lib/adminAuth';
import { hasPermission, normalizePermissions, PERMISSION_GROUPS, PERMISSIONS } from '@/lib/crm/permissions';
import { getAdminI18n } from '@/lib/i18n/server';
import { Badge, Card, Forbidden, Notice, PageHeader, StatusBadge } from '@/components/crm/ui';
import { InviteForm, MemberControls, RoleEditor } from '@/components/crm/team';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('team.manage')) return <Forbidden what="team settings" />;
  const { t, f } = getAdminI18n(admin);
  const roleName = (name: string) => t.dynamic(`common.roles.${name}`, name);
  const permissionLabel = (p: string, fallback: string) => t.dynamic(`team.permissions.${p.replace('.', '_')}`, fallback);

  const [members, roleRows] = await Promise.all([
    db.select({ p: adminProfiles, role: roles.name }).from(adminProfiles).innerJoin(roles, eq(roles.id, adminProfiles.role_id)).orderBy(asc(adminProfiles.created_at)),
    db.query.roles.findMany({ orderBy: [asc(roles.id)] }),
  ]);
  const bootstrap = new Set(getAdminEmails());
  const roleOpts = roleRows.map((r) => ({ id: r.id, name: roleName(r.name) }));
  const groups = PERMISSION_GROUPS.map((g) => ({ label: g.label, permissions: [...g.permissions] }));

  return (
    <>
      <PageHeader title={t('team.title')} description={t('team.description')} />
      <div className="grid gap-4">
        <Card title={t('team.add')}>
          <InviteForm roles={roleOpts} />
        </Card>

        <Card title={t('team.team', { count: members.length })}>
          <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
            <table className="crm-table min-w-[760px]">
              <caption className="sr-only">{t('team.caption')}</caption>
              <thead>
                <tr>
                  {(['member', 'role', 'status', 'lastSignIn', 'change'] as const).map((c) => (
                    <th key={c} scope="col">
                      {t(`team.cols.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map(({ p, role }) => (
                  <tr key={p.id}>
                    <td>
                      {p.full_name || p.email}
                      <div className="text-xs text-zayro-gray break-all">{p.email}</div>
                      {bootstrap.has(p.normalized_email) && (
                        <Badge tone="blue" title={t('team.adminEmailsBadge')}>
                          ADMIN_EMAILS
                        </Badge>
                      )}
                    </td>
                    <td>{roleName(role)}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="text-xs whitespace-nowrap">{p.last_login_at ? f.instant(p.last_login_at) : t('team.never')}</td>
                    <td>
                      <MemberControls id={p.id} roleId={p.role_id} status={p.status} roles={roleOpts} isSelf={p.id === admin.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={t('team.matrix')} actions={<RoleEditor role={null} groups={groups} labels={PERMISSIONS} />}>
          <div className="crm-table-wrap -mx-5 md:-mx-6 -mb-5 md:-mb-6">
            <table className="crm-table min-w-[720px]">
              <caption className="sr-only">{t('team.matrixCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('team.permission')}</th>
                  {roleRows.map((r) => (
                    <th key={r.id} scope="col" className="text-center">
                      {roleName(r.name)}
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
                        {i === 0 && <div className="text-[11px] uppercase tracking-wide text-zayro-gray">{t.dynamic(`team.groups.${g.label}`, g.label)}</div>}
                        {permissionLabel(p, PERMISSIONS[p])}
                      </td>
                      {roleRows.map((r) => {
                        const ok = hasPermission(normalizePermissions(r.permissions), p);
                        return (
                          <td key={r.id} className="text-center" aria-label={ok ? t('team.allowed') : t('team.notAllowed')}>
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
        <Notice tone="blue">{t('team.bootstrapNote')}</Notice>
      </div>
    </>
  );
}
