'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ToastProvider } from './client';
import { I18nProvider, LocaleSwitcher, useI18n } from './i18n';
import type { AdminLocale } from '@/lib/i18n/config';

export interface ShellNavItem {
  href: string;
  label: string;
  labelKey: string;
  icon: string;
  group: string;
}

function isActive(pathname: string, href: string) {
  return href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);
}

function Nav({ items, pathname, onNavigate }: { items: ShellNavItem[]; pathname: string; onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t('common.nav.label')}>
      <ul className="flex flex-col gap-0.5">
        {items.map((item, i) => (
          <li key={item.href}>
            {/* Section heading when the group changes (only if the role sees more than one group). */}
            {new Set(items.map((x) => x.group)).size > 1 && item.group !== items[i - 1]?.group && (
              <p className={`px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zayro-gray ${i === 0 ? '' : 'pt-4'}`}>{t.dynamic(`common.nav.groups.${item.group}`, item.group)}</p>
            )}
            <Link href={item.href} className="crm-nav-link" aria-current={isActive(pathname, item.href) ? 'page' : undefined} onClick={onNavigate}>
              <span aria-hidden="true" className="w-4 text-center opacity-70">
                {item.icon}
              </span>
              <span className="min-w-0 break-words">{t.dynamic(`common.nav.${item.labelKey}`, item.label)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function CrmShell({
  items,
  admin,
  locale,
  children,
}: {
  items: ShellNavItem[];
  admin: { email: string; name: string | null; role: string };
  locale: AdminLocale;
  children: React.ReactNode;
}) {
  return (
    <I18nProvider locale={locale}>
      <Shell items={items} admin={admin}>
        {children}
      </Shell>
    </I18nProvider>
  );
}

function Shell({ items, admin, children }: { items: ShellNavItem[]; admin: { email: string; name: string | null; role: string }; children: React.ReactNode }) {
  const { t, switching } = useI18n();
  const pathname = usePathname() || '/admin';
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = menuButton.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    drawer.current?.querySelector<HTMLElement>('a, button')?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      trigger?.focus();
    };
  }, [open]);

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
  };

  const account = (
    <div className="border-t border-zayro-border pt-3 mt-3 text-xs">
      <p className="font-semibold text-zayro-dark truncate" title={admin.email}>
        {admin.name || admin.email}
      </p>
      <p className="text-zayro-gray">{t.dynamic(`common.roles.${admin.role}`, admin.role)}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        <Link href="/" className="text-zayro-gray hover:text-zayro-dark">
          {t('common.shell.viewSite')}
        </Link>
        <button type="button" className="crm-link" onClick={logout}>
          {t('common.shell.signOut')}
        </button>
      </div>
    </div>
  );

  return (
    <ToastProvider>
      <div className="crm min-h-screen bg-zayro-bg">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between gap-3 px-4 h-14 bg-white/90 backdrop-blur border-b border-zayro-border">
          <Link href="/admin" className="font-bold tracking-wide text-zayro-dark text-sm shrink-0">
            ZAYRO <span className="text-zayro-primary">CRM</span>
          </Link>
          <LocaleSwitcher className="ml-auto" />
          <button
            ref={menuButton}
            type="button"
            className="crm-btn crm-btn-sm"
            aria-expanded={open}
            aria-controls="crm-drawer"
            onClick={() => setOpen(true)}
          >
            {t('common.shell.menu')}
          </button>
        </header>

        {open && (
          <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t('common.shell.menuLabel')}>
            <div className="absolute inset-0 bg-zayro-dark/30" onClick={() => setOpen(false)} />
            <div id="crm-drawer" ref={drawer} className="absolute inset-y-0 left-0 w-[82%] max-w-[300px] bg-white p-4 overflow-y-auto shadow-lift">
              <div className="flex items-center justify-between mb-4">
                <span className="font-bold tracking-wide text-zayro-dark text-sm">
                  ZAYRO <span className="text-zayro-primary">CRM</span>
                </span>
                <button type="button" className="crm-btn crm-btn-sm" onClick={() => setOpen(false)}>
                  {t('common.shell.close')}
                </button>
              </div>
              <Nav items={items} pathname={pathname} onNavigate={() => setOpen(false)} />
              {account}
            </div>
          </div>
        )}

        <div className="lg:flex">
          <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 h-screen sticky top-0 border-r border-zayro-border bg-white/70 px-3 py-5 overflow-y-auto">
            <Link href="/admin" className="px-3 mb-5 font-bold tracking-wide text-zayro-dark">
              ZAYRO <span className="text-zayro-primary">CRM</span>
            </Link>
            <Nav items={items} pathname={pathname} />
            <div className="mt-auto px-3">{account}</div>
          </aside>
          <div
            id="crm-main"
            className={`flex-1 min-w-0 px-4 py-6 md:px-8 md:py-8 max-w-[1400px] transition-opacity ${switching ? 'opacity-50 pointer-events-none' : ''}`}
            aria-busy={switching}
          >
            <div className="hidden lg:flex justify-end -mt-3 mb-3">
              <LocaleSwitcher />
            </div>
            {children}
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
