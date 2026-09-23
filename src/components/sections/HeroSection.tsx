import Link from 'next/link';
import Reveal from '@/components/ui/Reveal';

export default function HeroSection() {
  return (
    <section className="min-h-screen surface-soft flex flex-col items-center justify-center relative pt-24 md:pt-0 overflow-hidden">
      <div className="container max-w-5xl px-4">
        <Reveal>
          <div className="text-center mb-12 md:mb-16">
            <span className="chip mb-6" role="status">
              <span className="chip-dot" aria-hidden="true" />
              Midtown Manhattan, NYC
            </span>

            <h1 className="text-6xl md:text-8xl font-black leading-none mb-6 md:mb-8 text-zayro-dark">
              PODCAST
              <br />
              <span className="bg-gradient-cta bg-clip-text text-transparent">STUDIO</span>
              <br />
              NEW YORK
            </h1>

            <p className="text-lg md:text-2xl text-zayro-gray font-light mb-8 md:mb-12 max-w-2xl mx-auto leading-relaxed">
              Professional recording in Midtown Manhattan. 4K video, broadcast audio, and same-day delivery.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
              <Link href="/booking" className="button button-primary text-base px-8 py-4">
                Book a Session
              </Link>
              <Link href="/pricing" className="button button-secondary text-base px-8 py-4">
                See Pricing
              </Link>
            </div>

            <div className="text-sm text-zayro-gray font-light">40 W 37th St · Suite 603 · NYC</div>
          </div>
        </Reveal>

        <Reveal delayMs={120}>
          <div className="visual-block aspect-video" aria-hidden="true">
            <div className="visual-block-mark">
              <div className="text-3xl md:text-5xl font-black tracking-[0.3em]">ZAYRO</div>
              <div className="text-xs md:text-sm font-bold tracking-[0.5em] text-zayro-sky mt-3">STUDIOS</div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
