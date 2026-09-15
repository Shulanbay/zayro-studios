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

      {/* Add-ons */}
      <section className="py-16 md:py-24 bg-white">
        <div className="container">
          <h2 className="text-4xl font-bold mb-12 text-center">
            Additional Services
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl mx-auto">
            <div className="card">
              <h3 className="text-xl font-semibold mb-2">Extra Hours</h3>
              <p className="text-zayro-gray mb-4">Add additional studio time</p>
              <p className="text-2xl font-bold text-zayro-primary">$150/hour</p>
            </div>

            <div className="card">
              <h3 className="text-xl font-semibold mb-2">Rush Delivery</h3>
              <p className="text-zayro-gray mb-4">Same-day editing and export</p>
              <p className="text-2xl font-bold text-zayro-primary">+$100</p>
            </div>

            <div className="card">
              <h3 className="text-xl font-semibold mb-2">Professional Editing</h3>
              <p className="text-zayro-gray mb-4">Advanced color grading and effects</p>
              <p className="text-2xl font-bold text-zayro-primary">+$75/hour</p>
            </div>

            <div className="card">
              <h3 className="text-xl font-semibold mb-2">Graphics & Animation</h3>
              <p className="text-zayro-gray mb-4">Custom intros, titles, and overlays</p>
              <p className="text-2xl font-bold text-zayro-primary">Starting at $200</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 md:py-24 bg-zayro-dark text-white text-center">
        <div className="container">
          <h2 className="text-4xl font-bold mb-6">
            Ready to book?
          </h2>
          <Link href="/booking" className="button bg-zayro-primary hover:bg-zayro-dark hover:border-2 hover:border-zayro-primary text-white">
            Book Studio Now
          </Link>
        </div>
      </section>
    </main>
  );
}
