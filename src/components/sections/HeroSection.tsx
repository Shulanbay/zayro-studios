import Link from 'next/link';

export default function HeroSection() {
  return (
    <section className="min-h-screen bg-white flex flex-col items-center justify-center relative pt-20 md:pt-0">
      <div className="container max-w-5xl px-4">
        <div className="text-center mb-12 md:mb-16">
          {/* Large editorial headline */}
          <h1 className="text-6xl md:text-8xl font-black leading-none mb-6 md:mb-8 text-zayro-dark">
            PODCAST<br/>
            <span className="text-zayro-primary">STUDIO</span><br/>
            NEW YORK
          </h1>

          <p className="text-lg md:text-2xl text-zayro-gray font-light mb-8 md:mb-12 max-w-2xl mx-auto leading-relaxed">
            Professional recording in Midtown Manhattan. 4K video. Broadcast audio. Same-day delivery.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link href="/booking" className="button button-primary text-lg px-8 py-4">
              BOOK STUDIO
            </Link>
            <Link href="/pricing" className="button button-secondary text-lg px-8 py-4">
              CHECK AVAILABILITY
            </Link>
          </div>

          {/* Location info */}
          <div className="text-sm text-zayro-gray font-light">
            40 W 37th St  •  Suite 603  •  NYC
          </div>
        </div>

        {/* Hero visual */}
        <div className="aspect-video bg-gradient-to-br from-zayro-primary via-blue-500 to-zayro-dark rounded-sm overflow-hidden flex items-center justify-center text-white relative">
          <div className="absolute inset-0 opacity-10" style={{
            backgroundImage: 'repeating-linear-gradient(45deg, white 0, white 1px, transparent 0, transparent 12px)',
          }} />
          <div className="text-center relative">
            <div className="text-2xl md:text-4xl font-black tracking-[0.3em]">ZAYRO</div>
            <div className="text-xs md:text-sm font-bold tracking-[0.5em] text-blue-200 mt-2">STUDIOS</div>
          </div>
        </div>
      </div>
    </section>
  );
}
