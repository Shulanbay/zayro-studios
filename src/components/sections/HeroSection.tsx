import Link from 'next/link';

export default function HeroSection() {
  return (
    <section className="py-20 md:py-32 bg-gradient-to-b from-white to-zayro-bg">
      <div className="container">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          {/* Content */}
          <div>
            <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-6">
              Your Story.
              <br />
              <span className="text-zayro-primary">Our Studio.</span>
            </h1>

            <p className="text-xl text-zayro-gray mb-8 leading-relaxed">
              Professional podcast and video recording studio in the heart of New York City.
              Professional equipment. Expert support. Delivered fast.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <Link href="/booking" className="button button-primary">
                Book Studio Now
              </Link>
              <Link href="/pricing" className="button button-secondary">
                Check Availability
              </Link>
            </div>

            <p className="text-sm text-zayro-gray mt-8">
              ✓ 4K Video Recording  •  ✓ Professional Audio  •  ✓ Expert Support
            </p>
          </div>

          {/* Visual */}
          <div className="relative">
            <div className="aspect-square bg-gradient-to-br from-zayro-primary via-zayro-dark to-zayro-gray rounded-lg overflow-hidden">
              <div className="w-full h-full flex items-center justify-center text-white">
                <div className="text-center">
                  <div className="text-6xl mb-4">🎬</div>
                  <p className="text-lg font-semibold">Studio Hero Image</p>
                  <p className="text-sm text-gray-300 mt-2">(High-quality photo to be added)</p>
                </div>
              </div>
            </div>

            {/* Floating badge */}
            <div className="absolute -bottom-4 -right-4 bg-white rounded-lg shadow-lg p-4 border border-zayro-bg">
              <p className="text-sm font-semibold text-zayro-dark">Available Today</p>
              <p className="text-xs text-zayro-gray">Book in minutes</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
