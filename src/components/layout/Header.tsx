'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-white/80 backdrop-blur-md shadow-sm' : 'bg-white/60 backdrop-blur-sm'
      } border-b border-zayro-border`}
    >
      <div className="container">
        <div className="flex items-center justify-between py-5 md:py-4">
          <Link href="/" className="flex items-center gap-0" aria-label="ZAYRO Studios home">
            <span className="text-xl font-black text-zayro-dark tracking-tight">ZAYRO</span>
            <span className="text-[0.65rem] font-bold text-zayro-primary ml-2 tracking-[0.2em]">STUDIOS</span>
          </Link>

          <nav className="hidden md:flex items-center gap-10" aria-label="Primary">
            <Link href="/studio" className="text-sm font-medium text-zayro-dark hover:text-zayro-primary transition-colors">
              STUDIO
            </Link>
            <Link href="/pricing" className="text-sm font-medium text-zayro-dark hover:text-zayro-primary transition-colors">
              PRICING
            </Link>
            <Link href="/about" className="text-sm font-medium text-zayro-dark hover:text-zayro-primary transition-colors">
              ABOUT
            </Link>
            <Link href="/contact" className="text-sm font-medium text-zayro-dark hover:text-zayro-primary transition-colors">
              CONTACT
            </Link>
          </nav>

          <div className="hidden md:block">
            <Link href="/booking" className="button button-primary text-sm px-6 py-2.5">
              BOOK A SESSION
            </Link>
          </div>

          <button
            className="md:hidden p-2 -mr-2"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
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

        {isMenuOpen && (
          <nav id="mobile-nav" className="md:hidden pb-6 border-t border-zayro-border" aria-label="Mobile">
            <div className="flex flex-col gap-1 pt-4">
              <Link href="/studio" className="py-3 text-base font-medium text-zayro-dark" onClick={() => setIsMenuOpen(false)}>
                STUDIO
              </Link>
              <Link href="/pricing" className="py-3 text-base font-medium text-zayro-dark" onClick={() => setIsMenuOpen(false)}>
                PRICING
              </Link>
              <Link href="/about" className="py-3 text-base font-medium text-zayro-dark" onClick={() => setIsMenuOpen(false)}>
                ABOUT
              </Link>
              <Link href="/contact" className="py-3 text-base font-medium text-zayro-dark" onClick={() => setIsMenuOpen(false)}>
                CONTACT
              </Link>
              <Link href="/booking" className="button button-primary w-full justify-center text-sm mt-4" onClick={() => setIsMenuOpen(false)}>
                BOOK A SESSION
              </Link>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}
