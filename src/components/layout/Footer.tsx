import Link from 'next/link';
import { BUSINESS_ADDRESS, BUSINESS_PHONE, BUSINESS_EMAIL } from '@/lib/constants';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-zayro-dark text-white">
      <div className="container py-16 md:py-24">
        {/* Main Footer Content */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16 md:mb-24">
          {/* Brand */}
          <div>
            <div className="mb-6">
              <span className="text-2xl font-black">ZAYRO</span>
              <span className="text-xs font-bold text-zayro-primary ml-2">STUDIOS</span>
            </div>
            <p className="text-sm text-gray-400 leading-relaxed">
              Professional podcast and video studio in Midtown Manhattan, New York.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-bold text-sm mb-6 text-white">STUDIO</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/studio" className="text-gray-400 hover:text-white transition-colors">
                  Tour
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="text-gray-400 hover:text-white transition-colors">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/booking" className="text-gray-400 hover:text-white transition-colors">
                  Book
                </Link>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="font-bold text-sm mb-6 text-white">INFO</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/faq" className="text-gray-400 hover:text-white transition-colors">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/about" className="text-gray-400 hover:text-white transition-colors">
                  About
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-gray-400 hover:text-white transition-colors">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-bold text-sm mb-6 text-white">CONTACT</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <a href={`mailto:${BUSINESS_EMAIL}`} className="text-gray-400 hover:text-white transition-colors">
                  {BUSINESS_EMAIL}
                </a>
              </li>
              <li>
                <a href={`tel:${BUSINESS_PHONE}`} className="text-gray-400 hover:text-white transition-colors">
                  {BUSINESS_PHONE}
                </a>
              </li>
              <li className="text-gray-400 text-xs leading-relaxed pt-2">
                {BUSINESS_ADDRESS}
              </li>
            </ul>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-700 pt-8"></div>

        {/* Bottom Section */}
        <div className="flex flex-col md:flex-row justify-between items-center text-xs text-gray-500 gap-8">
          <p>&copy; {currentYear} ZAYRO Studios. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-white transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
