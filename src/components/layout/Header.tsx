'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-zayro-bg">
      <div className="container">
        <div className="flex items-center justify-between py-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-1">
            <span className="text-2xl font-bold text-zayro-dark">
              ZAYRO
            </span>
            <span className="text-sm font-semibold text-zayro-primary">
              STUDIOS
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <Link
              href="/studio"
              className="text-zayro-dark hover:text-zayro-primary transition-colors"
            >
              Studio
            </Link>
            <Link
              href="/pricing"
              className="text-zayro-dark hover:text-zayro-primary transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/about"
              className="text-zayro-dark hover:text-zayro-primary transition-colors"
            >
              About
            </Link>
            <Link
              href="/contact"
              className="text-zayro-dark hover:text-zayro-primary transition-colors"
            >
              Contact
            </Link>
          </nav>

          {/* CTA Button */}
          <div className="hidden md:flex items-center gap-4">
            <Link
              href="/booking"
              className="button button-primary"
            >
              Book Studio
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
          <nav className="md:hidden pb-4 border-t border-zayro-bg">
            <div className="flex flex-col gap-4 pt-4">
              <Link
                href="/studio"
                className="text-zayro-dark hover:text-zayro-primary transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                Studio
              </Link>
              <Link
                href="/pricing"
                className="text-zayro-dark hover:text-zayro-primary transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                Pricing
              </Link>
              <Link
                href="/about"
                className="text-zayro-dark hover:text-zayro-primary transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                About
              </Link>
              <Link
                href="/contact"
                className="text-zayro-dark hover:text-zayro-primary transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                Contact
              </Link>
              <Link
                href="/booking"
                className="button button-primary w-full justify-center"
                onClick={() => setIsMenuOpen(false)}
              >
                Book Studio
              </Link>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}
