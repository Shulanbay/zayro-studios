'use client';

import { useState } from 'react';
import { Dialog, FormError, useJsonSubmit } from './client';
import { useI18n } from './i18n';

interface RoleOpt {
  id: number;
  name: string;
}

export function InviteForm({ roles }: { roles: RoleOpt[] }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleId, setRoleId] = useState(roles.find((r) => r.name === 'Operator')?.id ?? roles[0]?.id ?? 0);
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/team', successMessage: t('team.invite.done'), onSuccess: () => { setEmail(''); setFullName(''); } });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit({ email, fullName: fullName || null, roleId });
      }}
      className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_180px_auto] gap-2 items-end"
    >
      <div>
        <label className="field-label" htmlFor="inv-email">
          {t('team.invite.email')}
        </label>
        <input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="field-label" htmlFor="inv-name">
          {t('team.invite.name')}
        </label>
        <input id="inv-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div>
        <label className="field-label" htmlFor="inv-role">
          {t('team.invite.role')}
        </label>
        <select id="inv-role" value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="crm-btn crm-btn-primary" disabled={busy}>
        {busy ? t('team.invite.adding') : t('team.invite.submit')}
      </button>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function MemberControls({ id, roleId, status, roles, isSelf }: { id: string; roleId: number; status: string; roles: RoleOpt[]; isSelf: boolean }) {
  const { t } = useI18n();
  const [role, setRole] = useState(roleId);
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/team', method: 'PATCH', successMessage: t('team.member.updated') });
  if (isSelf) return <span className="text-xs text-zayro-gray">{t('team.member.you')}</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`role-${id}`}>
        {t('team.member.role')}
      </label>
      <select id={`role-${id}`} value={role} onChange={(e) => setRole(Number(e.target.value))} className="!w-auto !py-1">
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <button type="button" className="crm-btn crm-btn-sm" disabled={busy || role === roleId} onClick={() => submit({ id, roleId: role })}>
        {t('team.member.saveRole')}
      </button>
      <button
        type="button"
        className={status === 'disabled' ? 'crm-btn crm-btn-sm' : 'crm-btn crm-btn-sm crm-btn-danger'}
        disabled={busy}
        onClick={() => submit({ id, status: status === 'disabled' ? 'active' : 'disabled' })}
      >
        {status === 'disabled' ? t('team.member.reenable') : t('team.member.disable')}
      </button>
      {error && <span className="text-xs text-red-700 w-full">{error}</span>}
    </div>
  );
}

export function RoleEditor({
  role,
  groups,
  labels,
}: {
  role: { id?: number; name: string; description: string; permissions: string[] } | null;
  groups: { label: string; permissions: string[] }[];
  labels: Record<string, string>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/roles', successMessage: role ? t('team.role.saved') : t('team.role.created'), onSuccess: () => setOpen(false) });
  return (
    <>
      <button type="button" className={role ? 'crm-btn crm-btn-sm' : 'crm-btn'} onClick={() => setOpen(true)}>
        {role ? t('team.role.edit') : t('team.role.new')}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={role ? t('team.role.editTitle', { name: role.name }) : t('team.role.new')}
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
              {t('common.actions.cancel')}
            </button>
            <button type="button" className="crm-btn crm-btn-primary" disabled={busy || name.trim().length < 2} onClick={() => submit({ id: role?.id, name, description: description || null, permissions: perms })}>
              {busy ? t('team.role.saving') : t('team.role.save')}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <div>
            <label className="field-label" htmlFor="role-name">
              {t('team.role.name')}
            </label>
            <input id="role-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <div>
            <label className="field-label" htmlFor="role-desc">
              {t('team.role.description')}
            </label>
            <input id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>
          {groups.map((g) => (
            <fieldset key={g.label}>
              <legend className="field-label">{t.dynamic(`team.groups.${g.label}`, g.label)}</legend>
              <div className="grid gap-1">
                {g.permissions.map((p) => (
                  <label key={p} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />
                    <span>
                      {t.dynamic(`team.permissions.${p.replace('.', '_')}`, labels[p])} <code className="text-[11px] text-zayro-gray">{p}</code>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <FormError error={error} />
        </div>
      </Dialog>
    </>
  );
}
