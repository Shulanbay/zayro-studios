import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import Link from 'next/link';
import { BUSINESS_ADDRESS } from '@/lib/constants';
import HeroSection from '@/components/sections/HeroSection';
import TrustStrip from '@/components/sections/TrustStrip';
import WhatYouCanBookSection from '@/components/sections/WhatYouCanBookSection';
import AvailableSetupsSection from '@/components/sections/AvailableSetupsSection';
import StudioExperienceSection from '@/components/sections/StudioExperienceSection';
import HowBookingWorksSection from '@/components/sections/HowBookingWorksSection';
import PricingSection from '@/components/sections/PricingSection';
import FAQSection from '@/components/sections/FAQSection';
import ProjectsSection from '@/components/sections/ProjectsSection';
import TestimonialsSection from '@/components/sections/TestimonialsSection';
import { getBookingFacts } from '@/lib/bookingFacts';
import { getActiveServices } from '@/lib/catalogData';
import { getPublicSetups } from '@/lib/setupCatalog';
import { priceNumber, servicesInCategory, type CatalogService } from '@/lib/catalog';
import { PUBLISHED_PROJECTS, PUBLISHED_TESTIMONIALS } from '@/lib/showcase';
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
  const [facts, services, setups] = await Promise.all([getBookingFacts(), getActiveServices().catch(() => null), getPublicSetups('podcast')]);
  // Prices, the tour length and setups all come from the database.
  const tourMinutes = services?.find((s) => s.category === 'tour')?.duration_minutes ?? null;
  const podcast = services ? servicesInCategory(services as unknown as CatalogService[], 'podcast') : [];
  const podcastFrom = podcast.length ? Math.min(...podcast.map((s) => priceNumber(s.base_price))) : null;
  return (
    <>
      <HeroSection podcastFrom={podcastFrom} />
      <TrustStrip openSevenDays={facts.openSevenDays} />
      <WhatYouCanBookSection tourMinutes={tourMinutes} />
      <AvailableSetupsSection setups={setups} />
      <PricingSection services={services} />
      <HowBookingWorksSection />
      <StudioExperienceSection />
      {/* Hidden until there is approved, real work to show (lib/showcase.ts). */}
      <ProjectsSection projects={PUBLISHED_PROJECTS} />
      <TestimonialsSection testimonials={PUBLISHED_TESTIMONIALS} />

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

      <FAQSection facts={facts} compact />
      <CTASection />
    </>
  );
}
