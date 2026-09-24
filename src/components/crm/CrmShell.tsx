'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ToastProvider } from './client';

export interface ShellNavItem {
  href: string;
  label: string;
  icon: string;
}

function isActive(pathname: string, href: string) {
  return href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`);
}

function Nav({ items, pathname, onNavigate }: { items: ShellNavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Admin sections">
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="crm-nav-link" aria-current={isActive(pathname, item.href) ? 'page' : undefined} onClick={onNavigate}>
              <span aria-hidden="true" className="w-4 text-center opacity-70">
                {item.icon}
              </span>
              {item.label}
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
  children,
}: {
  items: ShellNavItem[];
  admin: { email: string; name: string | null; role: string };
  children: React.ReactNode;
}) {
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
      <p className="text-zayro-gray">{admin.role}</p>
      <div className="flex gap-3 mt-2">
        <Link href="/" className="text-zayro-gray hover:text-zayro-dark">
          View site
        </Link>
        <button type="button" className="crm-link" onClick={logout}>
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <ToastProvider>
      <div className="crm min-h-screen bg-zayro-bg">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between gap-3 px-4 h-14 bg-white/90 backdrop-blur border-b border-zayro-border">
          <Link href="/admin" className="font-bold tracking-wide text-zayro-dark text-sm">
            ZAYRO <span className="text-zayro-primary">CRM</span>
          </Link>
          <button
            ref={menuButton}
            type="button"
            className="crm-btn crm-btn-sm"
            aria-expanded={open}
            aria-controls="crm-drawer"
            onClick={() => setOpen(true)}
          >
            Menu
          </button>
        </header>

        {open && (
          <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Admin menu">
            <div className="absolute inset-0 bg-zayro-dark/30" onClick={() => setOpen(false)} />
            <div id="crm-drawer" ref={drawer} className="absolute inset-y-0 left-0 w-[82%] max-w-[300px] bg-white p-4 overflow-y-auto shadow-lift">
              <div className="flex items-center justify-between mb-4">
                <span className="font-bold tracking-wide text-zayro-dark text-sm">
                  ZAYRO <span className="text-zayro-primary">CRM</span>
                </span>
                <button type="button" className="crm-btn crm-btn-sm" onClick={() => setOpen(false)}>
                  Close
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
          <main id="crm-main" className="flex-1 min-w-0 px-4 py-6 md:px-8 md:py-8 max-w-[1400px]">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
