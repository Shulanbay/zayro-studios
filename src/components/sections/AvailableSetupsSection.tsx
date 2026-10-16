import Image from 'next/image';
import Link from 'next/link';
import Reveal from '@/components/ui/Reveal';

const setups = [
  {
    name: 'Cream Lounge',
    description: 'Soft boucle seating, warm oak and an intimate two-person frame.',
    capacity: '2 guests',
    image: '/setups/cream-lounge.webp',
  },
  {
    name: 'Sofa Lounge',
    description: 'A relaxed three-person setup with sculptural seating and warm niches.',
    capacity: 'Up to 3 guests',
    image: '/setups/sofa-lounge.webp',
  },
  {
    name: 'Library Table',
    description: 'A polished editorial backdrop for interviews and business conversations.',
    capacity: '2 guests',
    image: '/setups/library-table.webp',
  },
  {
    name: 'Garden Lounge',
    description: 'A fresh, light-filled look with greenery and a signature textured wall.',
    capacity: '2 guests',
    image: '/setups/garden-lounge.webp',
  },
] as const;

export default function AvailableSetupsSection() {
  return (
    <section className="section-padding bg-white" aria-labelledby="available-setups-title">
      <div className="container max-w-6xl">
        <Reveal>
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between mb-10 md:mb-14">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-zayro-primary mb-3">Choose your look</p>
              <h2 id="available-setups-title" className="text-[clamp(2.25rem,10.5vw,3rem)] md:text-7xl font-black text-zayro-dark">
                AVAILABLE
                <br />
                SETUPS
              </h2>
            </div>
            <p className="max-w-md text-lg text-zayro-gray">
              Four camera-ready interiors. Pick the atmosphere that fits your show and we&apos;ll have it ready when you arrive.
            </p>
          </div>
        </Reveal>

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {setups.map((setup, index) => (
            <li key={setup.name}>
              <Reveal delayMs={index * 70}>
                <Link
                  href="/booking?category=podcast"
                  aria-label={`Book the ${setup.name} podcast setup`}
                  className="group block h-full overflow-hidden rounded-xl-plus border border-zayro-border bg-white shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-zayro-primary hover:shadow-lift"
                >
                  <div className="relative aspect-[16/10] overflow-hidden bg-zayro-bg">
                    <Image
                      src={setup.image}
                      alt={`${setup.name} podcast studio setup at ZAYRO Studios`}
                      fill
                      sizes="(min-width: 768px) 50vw, 100vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.025]"
                      priority={index < 2}
                    />
                    <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-zayro-dark shadow-sm backdrop-blur-sm">
                      {setup.capacity}
                    </span>
                  </div>
                  <div className="flex items-end justify-between gap-5 p-5 md:p-6">
                    <div>
                      <h3 className="text-2xl font-black text-zayro-dark mb-2">{setup.name}</h3>
                      <p className="text-sm text-zayro-gray leading-relaxed">{setup.description}</p>
                    </div>
                    <span className="shrink-0 text-2xl text-zayro-primary transition-transform group-hover:translate-x-1" aria-hidden="true">
                      →
                    </span>
                  </div>
                </Link>
              </Reveal>
            </li>
          ))}
        </ul>

        <Reveal delayMs={160}>
          <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Link href="/booking?category=podcast" className="button button-primary">
              Book a Podcast Session
            </Link>
            <Link href="/booking?category=tour" className="button button-secondary">
              See Them on a Free Tour
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
