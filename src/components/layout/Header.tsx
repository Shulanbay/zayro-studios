'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-zayro-bg">
      <div className="container">
        <div className="flex items-center justify-between py-6 md:py-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-0">
            <span className="text-2xl font-black text-zayro-dark">
              ZAYRO
            </span>
            <span className="text-xs font-bold text-zayro-primary ml-2">
              STUDIOS
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-12">
            <Link
              href="/studio"
              className="text-sm font-medium text-zayro-dark hover:text-zayro-primary transition-colors"
            >
              STUDIO
            </Link>
            <Link
              href="/pricing"
              className="text-sm font-medium text-zayro-dark hover:text-zayro-primary transition-colors"
            >
              PRICING
            </Link>
            <Link
              href="/about"
              className="text-sm font-medium text-zayro-dark hover:text-zayro-primary transition-colors"
            >
              ABOUT
            </Link>
            <Link
              href="/contact"
              className="text-sm font-medium text-zayro-dark hover:text-zayro-primary transition-colors"
            >
              CONTACT
            </Link>
          </nav>

          {/* CTA Button */}
          <div className="hidden md:block">
            <Link
              href="/booking"
              className="button button-primary text-sm px-6 py-2"
            >
              BOOK STUDIO
            </Link>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden p-2"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle menu"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <nav className="md:hidden pb-6 border-t border-zayro-bg">
            <div className="flex flex-col gap-4 pt-4">
              <Link
                href="/studio"
                className="text-sm font-medium text-zayro-dark hover:text-zayro-primary transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                STUDIO
              </Link>
              <Link
                href="/pricing"
                className="text-sm font-medium text-zayro-dark hover:text-zayro-primary transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                PRICING
              </Link>
              <Link
                href="/about"
                className="text-sm font-medium text-zayro-dark hover:text-zayro-primary transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                ABOUT
              </Link>
              <Link
                href="/contact"
                className="text-sm font-medium text-zayro-dark hover:text-zayro-primary transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                CONTACT
              </Link>
              <Link
                href="/booking"
                className="button button-primary w-full justify-center text-sm"
                onClick={() => setIsMenuOpen(false)}
              >
                BOOK STUDIO
              </Link>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}
