import Link from 'next/link';
import { BUSINESS_ADDRESS } from '@/lib/constants';
import HeroSection from '@/components/sections/HeroSection';
import StudioExperienceSection from '@/components/sections/StudioExperienceSection';
import HowBookingWorksSection from '@/components/sections/HowBookingWorksSection';
import PricingSection from '@/components/sections/PricingSection';
import EquipmentSection from '@/components/sections/EquipmentSection';
import FAQSection from '@/components/sections/FAQSection';
import CTASection from '@/components/sections/CTASection';
import Reveal from '@/components/ui/Reveal';

export default function Home() {
  return (
    <>
      <HeroSection />
      <StudioExperienceSection />
      <HowBookingWorksSection />

      {/* Why Choose ZAYRO */}
      <section className="section-padding surface-soft">
        <div className="container max-w-4xl">
          <Reveal>
            <h2 className="text-5xl md:text-7xl font-black mb-8 text-zayro-dark">
              BUILT FOR
              <br />
              CREATORS
            </h2>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Reveal>
              <div className="card h-full">
                <h3 className="text-2xl font-bold text-zayro-dark mb-4">Professional Setup</h3>
                <p className="text-zayro-gray leading-relaxed mb-4">
                  Show up and start recording. Audio, video, and lighting are all handled for you — no technical expertise required.
                </p>
                <p className="text-zayro-gray leading-relaxed">
                  4K multi-camera video with broadcast-quality audio that elevates your brand and content.
                </p>
              </div>
            </Reveal>

            <Reveal delayMs={80}>
              <div className="card h-full">
                <h3 className="text-2xl font-bold text-zayro-dark mb-4">Expert Support</h3>
                <p className="text-zayro-gray leading-relaxed mb-4">
                  Work directly with people who care about your results and your success.
                </p>
                <p className="text-zayro-gray leading-relaxed">
                  Your files are delivered quickly — fast turnaround, premium quality, for creators on tight schedules.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <EquipmentSection />
      <PricingSection />

      {/* Location */}
      <section className="section-padding bg-white">
        <div className="container max-w-4xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <Reveal>
              <div>
                <h2 className="text-6xl md:text-8xl font-black leading-none mb-8 text-zayro-dark">
                  NEW
                  <br />
                  YORK
                  <br />
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
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                  <Link href="/booking" className="button button-primary">
                    BOOK STUDIO
                  </Link>
                  <Link href="/studio" className="button button-secondary">
                    STUDIO TOUR
                  </Link>
                </div>
              </div>
            </Reveal>

            <Reveal delayMs={100}>
              <div className="aspect-square rounded-xl-plus overflow-hidden border border-zayro-border shadow-soft">
                <iframe
                  title="ZAYRO Studios location map"
                  src={`https://www.google.com/maps?q=${encodeURIComponent(BUSINESS_ADDRESS)}&output=embed`}
                  className="w-full h-full"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <FAQSection />
      <CTASection />
    </>
  );
}
