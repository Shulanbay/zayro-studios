import type { Permission } from './permissions';

export interface NavItem {
  href: string;
  /** English label (fallback); the shown text comes from `common.nav.<labelKey>`. */
  label: string;
  labelKey: string;
  icon: string;
  permission: Permission;
}

/** CRM sections; each is shown only to roles with its permission (and each page re-checks it). */
export const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'Dashboard', labelKey: 'dashboard', icon: '◧', permission: 'bookings.read' },
  { href: '/admin/calendar', label: 'Calendar', labelKey: 'calendar', icon: '▦', permission: 'bookings.read' },
  { href: '/admin/sessions', label: 'Sessions', labelKey: 'sessions', icon: '◷', permission: 'bookings.read' },
  { href: '/admin/customers', label: 'Customers', labelKey: 'customers', icon: '◉', permission: 'customers.read' },
  { href: '/admin/purchases', label: 'Purchases', labelKey: 'purchases', icon: '$', permission: 'purchases.read' },
  { href: '/admin/packages', label: 'Packages', labelKey: 'packages', icon: '▣', permission: 'packages.read' },
  { href: '/admin/services', label: 'Services', labelKey: 'services', icon: '☰', permission: 'services.manage' },
  { href: '/admin/availability', label: 'Availability', labelKey: 'availability', icon: '◔', permission: 'availability.manage' },
  { href: '/admin/blocked-time', label: 'Blocked Time', labelKey: 'blockedTime', icon: '⊘', permission: 'bookings.read' },
  { href: '/admin/integrations', label: 'Integrations', labelKey: 'integrations', icon: '⇄', permission: 'integrations.read' },
  { href: '/admin/reports', label: 'Reports', labelKey: 'reports', icon: '⤓', permission: 'reports.export' },
  { href: '/admin/analytics', label: 'Analytics', labelKey: 'analytics', icon: '↗', permission: 'analytics.read' },
  { href: '/admin/team', label: 'Team & Roles', labelKey: 'team', icon: '☺', permission: 'team.manage' },
  { href: '/admin/audit', label: 'Audit Log', labelKey: 'audit', icon: '≣', permission: 'audit.read' },
  { href: '/admin/settings', label: 'Settings', labelKey: 'settings', icon: '⚙', permission: 'settings.manage' },
];
