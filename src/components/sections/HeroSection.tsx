import Link from 'next/link';

const OFFERINGS = [
  { label: 'Podcast recording', detail: 'Sessions by the hour, 1–3 cameras', href: '/booking?category=podcast' },
  { label: 'Studio photography', detail: 'Headshots, portraits and brand content', href: '/booking?category=photography' },
  { label: 'Free studio tour', detail: '30 minutes, no payment needed', href: '/booking?category=tour' },
];

/**
 * Above the fold: rendered immediately (no scroll-reveal), so the largest
 * text paints without waiting for JavaScript.
 */
export default function HeroSection() {
  return (
    <section className="surface-soft relative overflow-hidden pt-16 pb-20 md:pt-28 md:pb-28">
      <div className="container max-w-5xl">
        <div className="text-center mb-12 md:mb-16">
          <span className="chip mb-6">
            <span className="chip-dot" aria-hidden="true" />
            Midtown Manhattan, NYC
          </span>

          <h1 className="text-[clamp(2.75rem,14vw,4.5rem)] md:text-8xl font-black leading-none tracking-tight mb-6 md:mb-8 text-zayro-dark">
            PODCAST
            <br />
            <span className="bg-gradient-cta bg-clip-text text-transparent">STUDIO</span>
            <br />
            NEW YORK
          </h1>

          <p className="text-lg md:text-2xl text-zayro-gray font-light mb-8 md:mb-12 max-w-2xl mx-auto leading-relaxed">
            Podcast recording and studio photography in Midtown Manhattan — 4K cameras, broadcast-quality audio and professional
            lighting.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-10">
            <Link href="/booking" className="button button-primary text-base px-8 py-4">
              Book a Session
            </Link>
            <Link href="/pricing" className="button button-secondary text-base px-8 py-4">
              See Pricing
            </Link>
          </div>

          <p className="text-sm text-zayro-gray">40 W 37th St · Suite 603 · New York, NY 10018</p>
        </div>

        <ul className="grid grid-cols-1 md:grid-cols-3 gap-4" aria-label="What you can book">
          {OFFERINGS.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex items-center justify-between gap-4 h-full rounded-xl-plus border border-zayro-border bg-white/80 px-6 py-5 shadow-soft transition-all hover:-translate-y-0.5 hover:border-zayro-primary hover:shadow-lift"
              >
                <span className="min-w-0">
                  <span className="block text-lg font-bold text-zayro-dark">{item.label}</span>
                  <span className="block text-sm text-zayro-gray">{item.detail}</span>
                </span>
                <span className="text-zayro-primary text-xl transition-transform group-hover:translate-x-1" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
