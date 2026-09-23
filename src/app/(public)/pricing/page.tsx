import Link from 'next/link';
import type { Metadata } from 'next';
import PricingSection from '@/components/sections/PricingSection';

export const metadata: Metadata = {
  title: 'Pricing | ZAYRO Studios',
  description: 'Simple and transparent pricing for podcast and video studio bookings in NYC.',
};

export default function PricingPage() {
  return (
    <main>
      {/* Hero */}
      <section className="py-16 md:py-24 bg-zayro-bg">
        <div className="container">
          <h1 className="text-5xl md:text-6xl font-bold mb-4">
            Transparent Pricing
          </h1>
          <p className="text-xl text-zayro-gray">
            All-inclusive packages with professional editing and delivery
          </p>
        </div>
      </section>

      {/* Pricing */}
      <PricingSection />

      {/* CTA */}
      <section className="section-padding surface-dark text-center">
        <div className="container">
          <h2 className="text-4xl font-bold mb-6">Ready to book?</h2>
          <p className="mb-8 max-w-xl mx-auto">
            Need something custom, like a multi-session package or a longer shoot? Reach out and we'll put a plan together.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/booking" className="button button-primary">
              Book Studio Now
            </Link>
            <Link href="/contact" className="button button-secondary bg-transparent text-white border-white/30 hover:border-white hover:text-white">
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
