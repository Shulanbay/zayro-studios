import Link from 'next/link';
import { BUSINESS_ADDRESS, BUSINESS_PHONE, BUSINESS_EMAIL } from '@/lib/constants';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-zayro-dark text-white">
      <div className="container py-12 md:py-16">
        {/* Footer Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12 md:mb-16">
          {/* Brand */}
          <div>
            <div className="mb-4">
              <span className="text-xl font-bold">ZAYRO</span>
              <span className="text-sm font-semibold text-zayro-primary ml-2">STUDIOS</span>
            </div>
            <p className="text-sm text-gray-400">
              Premium podcast and video studio in Midtown Manhattan.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold mb-4">Studio</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/studio" className="text-gray-400 hover:text-white">
                  Tour
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="text-gray-400 hover:text-white">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/equipment" className="text-gray-400 hover:text-white">
                  Equipment
                </Link>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="font-semibold mb-4">Resources</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/faq" className="text-gray-400 hover:text-white">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/about" className="text-gray-400 hover:text-white">
                  About
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-gray-400 hover:text-white">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact Info */}
          <div>
            <h4 className="font-semibold mb-4">Contact</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <a href={`mailto:${BUSINESS_EMAIL}`} className="text-gray-400 hover:text-white">
                  {BUSINESS_EMAIL}
                </a>
              </li>
              <li>
                <a href={`tel:${BUSINESS_PHONE}`} className="text-gray-400 hover:text-white">
                  {BUSINESS_PHONE}
                </a>
              </li>
              <li className="text-gray-400">{BUSINESS_ADDRESS}</li>
            </ul>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-700"></div>

        {/* Bottom Section */}
        <div className="pt-8 flex flex-col md:flex-row justify-between items-center text-sm text-gray-400">
          <p>&copy; {currentYear} ZAYRO Studios. All rights reserved.</p>
          <div className="flex gap-6 mt-4 md:mt-0">
            <Link href="/privacy" className="hover:text-white">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-white">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
