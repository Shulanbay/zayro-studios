import type { Permission } from './permissions';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission: Permission;
}

/** CRM sections; each is shown only to roles with its permission (and each page re-checks it). */
export const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: '◧', permission: 'bookings.read' },
  { href: '/admin/calendar', label: 'Calendar', icon: '▦', permission: 'bookings.read' },
  { href: '/admin/sessions', label: 'Sessions', icon: '◷', permission: 'bookings.read' },
  { href: '/admin/customers', label: 'Customers', icon: '◉', permission: 'customers.read' },
  { href: '/admin/purchases', label: 'Purchases', icon: '$', permission: 'purchases.read' },
  { href: '/admin/packages', label: 'Packages', icon: '▣', permission: 'packages.read' },
  { href: '/admin/services', label: 'Services', icon: '☰', permission: 'services.manage' },
  { href: '/admin/availability', label: 'Availability', icon: '◔', permission: 'availability.manage' },
  { href: '/admin/blocked-time', label: 'Blocked Time', icon: '⊘', permission: 'bookings.read' },
  { href: '/admin/integrations', label: 'Integrations', icon: '⇄', permission: 'integrations.read' },
  { href: '/admin/reports', label: 'Reports', icon: '⤓', permission: 'reports.export' },
  { href: '/admin/team', label: 'Team & Roles', icon: '☺', permission: 'team.manage' },
  { href: '/admin/audit', label: 'Audit Log', icon: '≣', permission: 'audit.read' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙', permission: 'settings.manage' },
];
