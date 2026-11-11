import Image from 'next/image';
import Link from 'next/link';
import Reveal from '@/components/ui/Reveal';
import { POLICY_COPY } from '@/lib/policies';
import type { PublicSetup } from '@/lib/setupCatalog';

function capacityLabel(capacity: number | null): string | null {
  if (!capacity) return null;
  return capacity <= 2 ? `${capacity} seats` : `Up to ${capacity} seats`;
}

/**
 * The podcast setups, straight from the booking catalog (see
 * lib/setupCatalog.ts). Each card opens the booking flow with that setup
 * preselected. Hidden when no setup is active.
 */
export default function AvailableSetupsSection({ setups }: { setups: PublicSetup[] }) {
  if (setups.length === 0) return null;
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
              {setups.length} camera-ready interiors in one studio room. {POLICY_COPY.setupChange}
            </p>
          </div>
        </Reveal>

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {setups.map((setup, index) => {
            const capacity = capacityLabel(setup.capacity);
            return (
              <li key={setup.slug}>
                <Reveal delayMs={index * 70}>
                  <Link
                    href={setup.bookingHref}
                    aria-label={`Book the ${setup.name} podcast setup`}
                    className="group block h-full overflow-hidden rounded-xl-plus border border-zayro-border bg-white shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-zayro-primary hover:shadow-lift motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                  >
                    {setup.image && (
                      <div className="relative aspect-[16/10] overflow-hidden bg-zayro-bg">
                        <Image
                          src={setup.image}
                          alt={`${setup.name} podcast studio setup at ZAYRO Studios`}
                          fill
                          sizes="(min-width: 768px) 50vw, 100vw"
                          className="object-cover transition-transform duration-500 group-hover:scale-[1.025] motion-reduce:transition-none"
                          priority={index < 2}
                        />
                        {capacity && (
                          <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-zayro-dark shadow-sm backdrop-blur-sm">
                            {capacity}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="flex items-end justify-between gap-5 p-5 md:p-6">
                      <div>
                        <h3 className="text-2xl font-black text-zayro-dark mb-2">{setup.name}</h3>
                        {setup.description && <p className="text-sm text-zayro-gray leading-relaxed">{setup.description}</p>}
                      </div>
                      <span className="shrink-0 text-2xl text-zayro-primary transition-transform group-hover:translate-x-1" aria-hidden="true">
                        →
                      </span>
                    </div>
                  </Link>
                </Reveal>
              </li>
            );
          })}
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
