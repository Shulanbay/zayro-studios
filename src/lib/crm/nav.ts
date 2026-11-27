import type { Permission } from './permissions';

export interface NavItem {
  href: string;
  /** English label (fallback); the shown text comes from `common.nav.<labelKey>`. */
  label: string;
  labelKey: string;
  icon: string;
  permission: Permission;
  /** Sidebar section heading (common.nav.groups.<group>). */
  group: 'studio' | 'marketing' | 'admin';
}

/** CRM sections; each is shown only to roles with its permission (and each page re-checks it). */
export const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'Dashboard', labelKey: 'dashboard', icon: '◧', permission: 'bookings.read', group: 'studio' },
  { href: '/admin/calendar', label: 'Calendar', labelKey: 'calendar', icon: '▦', permission: 'bookings.read', group: 'studio' },
  { href: '/admin/sessions', label: 'Sessions', labelKey: 'sessions', icon: '◷', permission: 'bookings.read', group: 'studio' },
  { href: '/admin/customers', label: 'Customers', labelKey: 'customers', icon: '◉', permission: 'customers.read', group: 'studio' },
  { href: '/admin/purchases', label: 'Purchases', labelKey: 'purchases', icon: '$', permission: 'purchases.read', group: 'studio' },
  { href: '/admin/packages', label: 'Packages', labelKey: 'packages', icon: '▣', permission: 'packages.read', group: 'studio' },
  { href: '/admin/services', label: 'Services', labelKey: 'services', icon: '☰', permission: 'services.manage', group: 'studio' },
  { href: '/admin/availability', label: 'Availability', labelKey: 'availability', icon: '◔', permission: 'availability.manage', group: 'studio' },
  { href: '/admin/blocked-time', label: 'Blocked Time', labelKey: 'blockedTime', icon: '⊘', permission: 'bookings.read', group: 'studio' },
  { href: '/admin/marketing', label: 'Marketing hub', labelKey: 'marketing', icon: '◎', permission: 'analytics.read', group: 'marketing' },
  { href: '/admin/leads', label: 'Leads', labelKey: 'leads', icon: '✦', permission: 'leads.read', group: 'marketing' },
  { href: '/admin/pages', label: 'Landing pages', labelKey: 'pages', icon: '▤', permission: 'pages.manage', group: 'marketing' },
  { href: '/admin/analytics', label: 'Analytics', labelKey: 'analytics', icon: '↗', permission: 'analytics.read', group: 'marketing' },
  { href: '/admin/ad-spend', label: 'Ad spend', labelKey: 'adSpend', icon: '¤', permission: 'marketing.spend', group: 'marketing' },
  { href: '/admin/utm', label: 'Link builder', labelKey: 'utm', icon: '⛓', permission: 'analytics.read', group: 'marketing' },
  { href: '/admin/tracking', label: 'Tracking & pixels', labelKey: 'tracking', icon: '⌘', permission: 'marketing.scripts', group: 'marketing' },
  { href: '/admin/integrations', label: 'Integrations', labelKey: 'integrations', icon: '⇄', permission: 'integrations.read', group: 'admin' },
  { href: '/admin/reports', label: 'Reports', labelKey: 'reports', icon: '⤓', permission: 'reports.export', group: 'admin' },
  { href: '/admin/team', label: 'Team & Roles', labelKey: 'team', icon: '☺', permission: 'team.manage', group: 'admin' },
  { href: '/admin/audit', label: 'Audit Log', labelKey: 'audit', icon: '≣', permission: 'audit.read', group: 'admin' },
  { href: '/admin/settings', label: 'Settings', labelKey: 'settings', icon: '⚙', permission: 'settings.manage', group: 'admin' },
];
