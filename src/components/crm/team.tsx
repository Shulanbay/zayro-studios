'use client';

import { useState } from 'react';
import { Dialog, FormError, useJsonSubmit } from './client';

interface RoleOpt {
  id: number;
  name: string;
}

export function InviteForm({ roles }: { roles: RoleOpt[] }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleId, setRoleId] = useState(roles.find((r) => r.name === 'Operator')?.id ?? roles[0]?.id ?? 0);
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/team', successMessage: 'Invited — they can sign in at /admin/login', onSuccess: () => { setEmail(''); setFullName(''); } });
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
          Email
        </label>
        <input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="field-label" htmlFor="inv-name">
          Name
        </label>
        <input id="inv-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div>
        <label className="field-label" htmlFor="inv-role">
          Role
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
        {busy ? 'Adding…' : 'Add to team'}
      </button>
      <div className="sm:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function MemberControls({ id, roleId, status, roles, isSelf }: { id: string; roleId: number; status: string; roles: RoleOpt[]; isSelf: boolean }) {
  const [role, setRole] = useState(roleId);
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/team', method: 'PATCH', successMessage: 'Team member updated' });
  if (isSelf) return <span className="text-xs text-zayro-gray">You</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`role-${id}`}>
        Role
      </label>
      <select id={`role-${id}`} value={role} onChange={(e) => setRole(Number(e.target.value))} className="!w-auto !py-1">
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <button type="button" className="crm-btn crm-btn-sm" disabled={busy || role === roleId} onClick={() => submit({ id, roleId: role })}>
        Save role
      </button>
      <button
        type="button"
        className={status === 'disabled' ? 'crm-btn crm-btn-sm' : 'crm-btn crm-btn-sm crm-btn-danger'}
        disabled={busy}
        onClick={() => submit({ id, status: status === 'disabled' ? 'active' : 'disabled' })}
      >
        {status === 'disabled' ? 'Re-enable' : 'Disable access'}
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const { submit, busy, error } = useJsonSubmit({ url: '/api/admin/roles', successMessage: role ? 'Role saved' : 'Role created', onSuccess: () => setOpen(false) });
  return (
    <>
      <button type="button" className={role ? 'crm-btn crm-btn-sm' : 'crm-btn'} onClick={() => setOpen(true)}>
        {role ? 'Edit' : 'New custom role'}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={role ? `Edit ${role.name}` : 'New custom role'}
        footer={
          <>
            <button type="button" className="crm-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="crm-btn crm-btn-primary" disabled={busy || name.trim().length < 2} onClick={() => submit({ id: role?.id, name, description: description || null, permissions: perms })}>
              {busy ? 'Saving…' : 'Save role'}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <div>
            <label className="field-label" htmlFor="role-name">
              Name
            </label>
            <input id="role-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <div>
            <label className="field-label" htmlFor="role-desc">
              Description
            </label>
            <input id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>
          {groups.map((g) => (
            <fieldset key={g.label}>
              <legend className="field-label">{g.label}</legend>
              <div className="grid gap-1">
                {g.permissions.map((p) => (
                  <label key={p} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />
                    <span>
                      {labels[p]} <code className="text-[11px] text-zayro-gray">{p}</code>
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
