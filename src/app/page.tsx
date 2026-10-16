import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import Link from 'next/link';
import { BUSINESS_ADDRESS } from '@/lib/constants';
import HeroSection from '@/components/sections/HeroSection';
import AvailableSetupsSection from '@/components/sections/AvailableSetupsSection';
import StudioExperienceSection from '@/components/sections/StudioExperienceSection';
import HowBookingWorksSection from '@/components/sections/HowBookingWorksSection';
import PricingSection from '@/components/sections/PricingSection';
import EquipmentSection from '@/components/sections/EquipmentSection';
import FAQSection from '@/components/sections/FAQSection';
import { getBookingFacts } from '@/lib/bookingFacts';
import { getActiveServices } from '@/lib/catalogData';
import CTASection from '@/components/sections/CTASection';
import Reveal from '@/components/ui/Reveal';

export const metadata: Metadata = {
  ...pageMetadata({
    title: 'Podcast & Video Studio NYC | ZAYRO Studios Manhattan',
    description:
      'Book a Midtown Manhattan podcast and video recording studio with 4K cameras, broadcast audio, professional lighting and camera-ready sets.',
    path: '/',
  }),
};

// Hours and booking rules in the FAQ come from the database.
export const revalidate = 300;

export default async function Home() {
  const [facts, services] = await Promise.all([getBookingFacts(), getActiveServices().catch(() => [])]);
  // The tour length shown in the hero comes from the service itself.
  const tourMinutes = services.find((s) => s.category === 'tour')?.duration_minutes ?? null;
  return (
    <>
      <HeroSection tourMinutes={tourMinutes} />
      <AvailableSetupsSection />
      <section className="section-padding surface-soft" aria-labelledby="nyc-studio-services">
        <div className="container max-w-5xl">
          <Reveal>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-zayro-primary mb-3">Midtown Manhattan production space</p>
            <h2 id="nyc-studio-services" className="text-[clamp(2.25rem,10.5vw,3rem)] md:text-7xl font-black text-zayro-dark mb-6">
              CREATE IN
              <br />
              NEW YORK CITY
            </h2>
            <p className="text-lg md:text-xl text-zayro-gray max-w-3xl leading-relaxed mb-10">
              ZAYRO Studios is a podcast recording, video filming and content production studio at 40 W 37th Street in
              Midtown Manhattan. Choose the service that matches your project.
            </p>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Reveal>
              <Link href="/podcast-studio-nyc" className="card card-interactive group block h-full">
                <p className="text-sm font-bold text-zayro-primary mb-3">PODCAST RECORDING</p>
                <h3 className="text-3xl font-black text-zayro-dark mb-3">Podcast Studio NYC</h3>
                <p className="text-zayro-gray mb-6">
                  Professional audio and multi-camera video podcasts with broadcast microphones, studio lighting and technical support.
                </p>
                <span className="font-bold text-zayro-primary">Explore podcast studio →</span>
              </Link>
            </Reveal>
            <Reveal delayMs={80}>
              <Link href="/video-production-studio-nyc" className="card card-interactive group block h-full">
                <p className="text-sm font-bold text-zayro-primary mb-3">VIDEO &amp; FILMING</p>
                <h3 className="text-3xl font-black text-zayro-dark mb-3">Video Production Studio NYC</h3>
                <p className="text-zayro-gray mb-6">
                  A flexible Manhattan filming studio for interviews, YouTube videos, courses, branded content and green-screen recording.
                </p>
                <span className="font-bold text-zayro-primary">Explore video studio →</span>
              </Link>
            </Reveal>
          </div>
        </div>
      </section>
      <StudioExperienceSection />
      <HowBookingWorksSection />

      {/* What a session includes */}
      <section className="section-padding surface-soft">
        <div className="container max-w-4xl">
          <Reveal>
            <h2 className="text-[clamp(2.25rem,10.5vw,3rem)] md:text-7xl font-black mb-8 text-zayro-dark">
              BUILT FOR
              <br />
              CREATORS
            </h2>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Reveal>
              <div className="card h-full">
                <h3 className="text-2xl font-bold text-zayro-dark mb-4">Ready when you arrive</h3>
                <p className="text-zayro-gray leading-relaxed mb-4">
                  Cameras, microphones and lighting are set up in the studio, so you can focus on your conversation.
                </p>
                <p className="text-zayro-gray leading-relaxed">
                  Podcast Pro includes a producer / technician on site who runs the session for you.
                </p>
              </div>
            </Reveal>

            <Reveal delayMs={80}>
              <div className="card h-full">
                <h3 className="text-2xl font-bold text-zayro-dark mb-4">Your files, your way</h3>
                <p className="text-zayro-gray leading-relaxed mb-4">
                  Recording sessions include your raw files. Professional editing is included in the Full Podcast Package.
                </p>
                <p className="text-zayro-gray leading-relaxed">
                  Recording only? Ask us for an editing quote for any session.
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
                <h2 className="text-[clamp(2.75rem,14vw,4.5rem)] md:text-8xl font-black leading-none mb-8 text-zayro-dark">
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
                  <Link href="/booking?category=tour" className="button button-secondary">
                    FREE STUDIO TOUR
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

      <FAQSection facts={facts} />
      <CTASection />
    </>
  );
}
