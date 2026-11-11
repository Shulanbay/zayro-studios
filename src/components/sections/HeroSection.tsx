import Link from 'next/link';
import { BUSINESS_ADDRESS } from '@/lib/constants';
import { formatPrice } from '@/lib/catalog';
import HeroWaves from './HeroWaves';

/**
 * Above the fold: rendered immediately (no scroll-reveal), so the largest
 * text paints without waiting for JavaScript. Typography-first by design:
 * there is no approved studio footage yet (see docs/content-requirements.md);
 * `media` is the slot for it once it exists.
 */
export default function HeroSection({ podcastFrom = null, media = null }: { podcastFrom?: number | null; media?: React.ReactNode }) {
  const supporting = [podcastFrom !== null ? `Podcast sessions from ${formatPrice(podcastFrom)}` : null, 'Live availability', 'Raw files delivered within 24 hours'].filter(Boolean);
  return (
    <section className="relative overflow-hidden bg-[#f0f6fd] pt-16 pb-16 md:pt-28 md:pb-24">
      <HeroWaves />
      {/* Soft glow behind the copy so the dots never fight the text. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 55% 50% at 50% 50%, rgba(240,246,253,0.85) 0%, rgba(240,246,253,0.55) 45%, rgba(240,246,253,0) 80%)' }}
      />
      <div className="container relative max-w-5xl">
        <div className="text-center">
          <span className="chip mb-6">
            <span className="chip-dot" aria-hidden="true" />
            Midtown Manhattan, NYC
          </span>

          <h1 className="text-[clamp(2.75rem,14vw,4.5rem)] md:text-8xl font-black leading-none tracking-tight mb-6 md:mb-8 text-zayro-dark">
            PODCAST &amp; VIDEO
            <br />
            <span className="bg-gradient-cta bg-clip-text text-transparent">STUDIO</span>
            <br />
            NYC
          </h1>

          <p className="text-lg md:text-2xl text-zayro-gray font-light mb-8 md:mb-10 max-w-3xl mx-auto leading-relaxed">
            Record professional podcasts, interviews and branded content in a fully equipped Midtown Manhattan studio — with 4K
            cameras, broadcast audio, professional lighting and on-site technical support.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-5">
            <Link href="/booking" className="button button-primary text-base px-8 py-4">
              Book a Session
            </Link>
            <Link href="/pricing" className="button button-secondary text-base px-8 py-4">
              See Pricing
            </Link>
          </div>
          <p className="mb-8">
            <Link href="/booking?category=tour" className="inline-block py-2 font-bold text-zayro-primary hover:underline underline-offset-4">
              Tour the Studio — Free <span aria-hidden="true">→</span>
            </Link>
          </p>

          <p className="text-sm md:text-base font-semibold text-zayro-dark mb-2">{supporting.join(' · ')}</p>
          <p className="text-sm text-zayro-gray">{BUSINESS_ADDRESS}</p>
        </div>
        {media && <div className="mt-12">{media}</div>}
      </div>
    </section>
  );
}
