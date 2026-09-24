/**
 * Permission catalogue and the system role matrix. Pure — used by the
 * server (enforcement) and by the admin UI (hiding controls, the matrix on
 * Team & Roles). Keep SYSTEM_ROLE_PERMISSIONS in sync with the seed in
 * drizzle/0007_crm_backfill.sql.
 */

export const PERMISSIONS = {
  'bookings.read': 'View sessions and the calendar',
  'bookings.create': 'Create bookings and block time',
  'bookings.update': 'Reschedule, complete, mark no-show, edit notes',
  'bookings.cancel': 'Cancel bookings',
  'bookings.refund': 'Issue refunds',
  'customers.read': 'View customers',
  'customers.update': 'Edit customer details',
  'customers.merge': 'Merge duplicate customers',
  'notes.write': 'Write internal notes',
  'purchases.read': 'View purchases, payments and prices',
  'purchases.create': 'Record manual payments and paid bookings',
  'packages.read': 'View packages and credits',
  'packages.manage': 'Assign packages, adjust credits, edit plans',
  'services.manage': 'Edit services and prices',
  'availability.manage': 'Edit hours, booking rules and overrides',
  'reports.read': 'View dashboard revenue and reports',
  'reports.export': 'Export CSV files',
  'integrations.read': 'View integration status and logs',
  'integrations.retry': 'Retry Calendar, Sheets, email and webhooks',
  'team.manage': 'Invite admins and change roles',
  'audit.read': 'View the audit log',
  'settings.manage': 'Change business settings',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: 'Sessions', permissions: ['bookings.read', 'bookings.create', 'bookings.update', 'bookings.cancel', 'bookings.refund'] },
  { label: 'Customers', permissions: ['customers.read', 'customers.update', 'customers.merge', 'notes.write'] },
  { label: 'Money', permissions: ['purchases.read', 'purchases.create', 'packages.read', 'packages.manage'] },
  { label: 'Studio', permissions: ['services.manage', 'availability.manage'] },
  { label: 'Reports', permissions: ['reports.read', 'reports.export'] },
  { label: 'Operations', permissions: ['integrations.read', 'integrations.retry'] },
  { label: 'Security', permissions: ['team.manage', 'audit.read', 'settings.manage'] },
];

export const SYSTEM_ROLE_NAMES = ['Owner', 'Studio Manager', 'Producer', 'Operator'] as const;
export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleName, ('*' | Permission)[]> = {
  Owner: ['*'],
  'Studio Manager': [
    'bookings.read',
    'bookings.create',
    'bookings.update',
    'bookings.cancel',
    'bookings.refund',
    'customers.read',
    'customers.update',
    'customers.merge',
    'notes.write',
    'purchases.read',
    'purchases.create',
    'packages.read',
    'packages.manage',
    'services.manage',
    'availability.manage',
    'reports.read',
    'reports.export',
    'integrations.read',
    'integrations.retry',
  ],
  Producer: ['bookings.read', 'bookings.create', 'bookings.update', 'customers.read', 'notes.write', 'packages.read'],
  Operator: ['bookings.read', 'customers.read'],
};

export const OWNER_ROLE = 'Owner';

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/** Normalises whatever is stored in roles.permissions to known values. */
export function normalizePermissions(value: unknown): ('*' | Permission)[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<'*' | Permission>();
  for (const v of value) {
    if (v === '*') out.add('*');
    else if (isPermission(v)) out.add(v);
  }
  return Array.from(out);
}

export function hasPermission(granted: readonly string[], permission: Permission): boolean {
  return granted.includes('*') || granted.includes(permission);
}
