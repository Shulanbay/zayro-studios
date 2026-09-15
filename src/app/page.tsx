import Link from 'next/link';
import { BUSINESS_ADDRESS } from '@/lib/constants';
import HeroSection from '@/components/sections/HeroSection';
import StudioExperienceSection from '@/components/sections/StudioExperienceSection';
import PricingSection from '@/components/sections/PricingSection';
import EquipmentSection from '@/components/sections/EquipmentSection';
import FAQSection from '@/components/sections/FAQSection';
import CTASection from '@/components/sections/CTASection';

export default function Home() {
  return (
    <>
      {/* Hero Section */}
      <HeroSection />

      {/* Studio Experience - Editorial rows */}
      <StudioExperienceSection />

      {/* Why Choose ZAYRO - Editorial Statement */}
      <section className="section-padding bg-zayro-bg">
        <div className="container max-w-4xl">
          <h2 className="text-5xl md:text-7xl font-black mb-8 text-zayro-dark">
            BUILT FOR<br/>
            CREATORS
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div>
              <h3 className="text-2xl font-bold text-zayro-dark mb-4">
                Professional Setup
              </h3>
              <p className="text-zayro-gray leading-relaxed mb-6">
                Show up and start recording. Audio, video, and lighting are all handled for you. No technical expertise required.
              </p>
              <p className="text-zayro-gray leading-relaxed">
                4K multi-camera video with broadcast-quality audio that elevates your brand and content.
              </p>
            </div>

            <div>
              <h3 className="text-2xl font-bold text-zayro-dark mb-4">
                Expert Support
              </h3>
              <p className="text-zayro-gray leading-relaxed mb-6">
                Work directly with professionals who care about your results and your success.
              </p>
              <p className="text-zayro-gray leading-relaxed">
                Your files are delivered quickly, perfect for creators on tight schedules. Fast turnaround. Premium quality.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Equipment */}
      <EquipmentSection />

      {/* Pricing */}
      <PricingSection />

      {/* Location Section - Editorial */}
      <section className="section-padding bg-white">
        <div className="container max-w-4xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-6xl md:text-8xl font-black leading-none mb-8 text-zayro-dark">
                NEW<br/>
                YORK<br/>
                CITY
              </h2>

              <p className="text-lg text-zayro-gray font-light mb-8 max-w-xl leading-relaxed">
                Located in the heart of Midtown Manhattan. Minutes from Herald Square, Bryant Park, and Times Square.
              </p>

              <div className="space-y-6 mb-8">
                <div>
                  <p className="text-sm font-semibold text-zayro-primary mb-2">ADDRESS</p>
                  <p className="text-zayro-gray">{BUSINESS_ADDRESS}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-zayro-primary mb-2">HOURS</p>
                  <p className="text-zayro-gray">Monday - Friday: 9:00 AM - 6:00 PM</p>
                  <p className="text-zayro-gray">Saturday: 10:00 AM - 4:00 PM</p>
                  <p className="text-zayro-gray">Sunday: Closed</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/booking" className="button button-primary">
                  BOOK STUDIO
                </Link>
                <Link href="/studio-tour" className="button button-secondary">
                  STUDIO TOUR
                </Link>
              </div>
            </div>

            <div className="aspect-square bg-gradient-to-br from-zayro-primary to-zayro-dark rounded-sm flex items-center justify-center">
              <div className="text-center text-white">
                <p className="text-lg font-semibold">NYC Map</p>
                <p className="text-sm text-blue-200 mt-2">(Coming soon)</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <FAQSection />

      {/* Final CTA */}
      <CTASection />
    </>
  );
}
