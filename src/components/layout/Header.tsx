'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const NAV = [
  { href: '/studio', label: 'Studio' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Navigating closes the menu.
  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  // While the menu is open: focus its first link, keep Tab inside the
  // toggle + menu, close on Escape (focus back on the toggle) or on a tap
  // outside the header.
  useEffect(() => {
    if (!isMenuOpen) return;
    const menu = menuRef.current;
    const focusables = () => [toggleRef.current, ...Array.from(menu?.querySelectorAll<HTMLElement>('a[href]') ?? [])].filter(Boolean) as HTMLElement[];
    focusables()[1]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const header = toggleRef.current?.closest('header');
      if (header && !header.contains(e.target as Node)) setIsMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [isMenuOpen]);

  const isCurrent = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled || isMenuOpen ? 'bg-white/90 backdrop-blur-md shadow-sm' : 'bg-white/60 backdrop-blur-sm'
      } border-b border-zayro-border`}
    >
      <div className="container">
        <div className="flex items-center justify-between gap-4 py-4">
          <Link href="/" className="flex items-center gap-0 py-1" aria-label="ZAYRO Studios home">
            <span className="text-xl font-black text-zayro-dark tracking-tight">ZAYRO</span>
            <span className="text-[0.65rem] font-bold text-zayro-primary ml-2 tracking-[0.2em]" aria-hidden="true">
              STUDIOS
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-10" aria-label="Primary">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent(item.href) ? 'page' : undefined}
                className={`text-sm font-medium uppercase tracking-wide transition-colors hover:text-zayro-primary ${
                  isCurrent(item.href) ? 'text-zayro-primary' : 'text-zayro-dark'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden md:block">
            <Link href="/booking" className="button button-primary text-sm px-6 py-2.5 uppercase tracking-wide">
              Book a Session
            </Link>
          </div>

          <button
            ref={toggleRef}
            type="button"
            className="md:hidden flex items-center justify-center w-11 h-11 p-0 -mr-2 rounded-full text-zayro-dark hover:bg-zayro-bg"
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-nav"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              {isMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        <nav
          id="mobile-nav"
          ref={menuRef}
          className={`md:hidden border-t border-zayro-border ${isMenuOpen ? 'block pb-6' : 'hidden'}`}
          aria-label="Mobile"
        >
          <div className="flex flex-col gap-1 pt-3">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent(item.href) ? 'page' : undefined}
                className={`py-3 text-base font-medium uppercase tracking-wide ${isCurrent(item.href) ? 'text-zayro-primary' : 'text-zayro-dark'}`}
                onClick={() => setIsMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/booking"
              className="button button-primary w-full justify-center text-sm mt-4 uppercase tracking-wide"
              onClick={() => setIsMenuOpen(false)}
            >
              Book a Session
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
