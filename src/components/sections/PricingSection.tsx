'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Reveal from '@/components/ui/Reveal';
import { bookingHref, formatDuration, formatPrice, priceNumber, servicesInCategory, type CatalogService } from '@/lib/catalog';

type Service = Pick<CatalogService, 'id' | 'name' | 'description' | 'base_price' | 'duration_minutes' | 'features' | 'category' | 'badge' | 'is_featured' | 'display_order'>;

export default function PricingSection() {
  const [allServices, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/services')
      .then((r) => {
        if (!r.ok) throw new Error('failed');
        return r.json();
      })
      .then((data) => setServices(Array.isArray(data) ? data : []))
      .catch(() => setError(true));
  }, []);

  // The homepage only shows the core podcast sessions; photography, the tour
  // and monthly packages are linked to the full pricing page.
  const services = allServices ? servicesInCategory(allServices as CatalogService[], 'podcast') : null;
  const photography = allServices ? servicesInCategory(allServices as CatalogService[], 'photography') : [];
  const photoFrom = photography.length ? Math.min(...photography.map((s) => priceNumber(s.base_price))) : null;
  const tour = allServices ? servicesInCategory(allServices as CatalogService[], 'tour')[0] : undefined;

  return (
    <section className="section-padding bg-zayro-bg" id="pricing">
      <div className="container max-w-5xl">
        <Reveal>
          <h2 className="text-5xl md:text-7xl font-black mb-4 text-zayro-dark">PRICING</h2>
          <p className="text-xl text-zayro-gray font-light mb-16 max-w-xl">
            Simple and transparent podcast sessions. Photography and monthly packages are on the full pricing page.
          </p>
        </Reveal>

        {error && (
          <p className="text-zayro-gray">Pricing is temporarily unavailable — please check our <Link href="/pricing" className="text-zayro-primary font-semibold">pricing page</Link> or contact us.</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {!services &&
            !error &&
            [0, 1, 2].map((i) => <div key={i} className="skeleton h-80 rounded-xl-plus" />)}

          {services?.map((service, idx) => (
            <Reveal key={service.id} delayMs={idx * 80} className="h-full">
              <div className="card h-full flex flex-col">
                {service.badge && (
                  <span className="self-start mb-3 rounded-full bg-gradient-cta px-3 py-1 text-sm font-semibold text-white">
                    {service.badge}
                  </span>
                )}
                <h3 className="text-2xl font-black text-zayro-dark mb-2">{service.name}</h3>
                <p className="text-sm text-zayro-gray mb-6">{service.description}</p>
                <div className="flex items-baseline gap-2 mb-6">
                  <span className="text-4xl font-black text-zayro-dark">
                    {formatPrice(service.base_price)}
                  </span>
                  <span className="text-sm text-zayro-gray">/ {formatDuration(service.duration_minutes)}</span>
                </div>
                {service.features && service.features.length > 0 && (
                  <ul className="space-y-2 mb-8 flex-1">
                    {service.features.map((feature, fidx) => (
                      <li key={fidx} className="text-sm text-zayro-gray flex gap-2">
                        <span className="text-zayro-primary" aria-hidden="true">✓</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  href={bookingHref(service)}
                  className="button button-primary w-full mt-auto"
                  aria-label={`Book now: ${service.name}`}
                >
                  BOOK NOW
                </Link>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/pricing#photography" className="card card-interactive block">
            <span className="block text-lg font-black text-zayro-dark">Photography</span>
            <span className="block text-base text-zayro-gray">
              {photoFrom !== null ? `Studio shoots from ${formatPrice(photoFrom)}` : 'Headshots and brand content'}
            </span>
          </Link>
          <Link href="/pricing#monthly" className="card card-interactive block">
            <span className="block text-lg font-black text-zayro-dark">Monthly Podcast Packages</span>
            <span className="block text-base text-zayro-gray">Prepaid sessions for regular shows, at a discount</span>
          </Link>
          {tour ? (
            <Link href={bookingHref(tour)} className="card card-interactive block">
              <span className="block text-lg font-black text-zayro-dark">{tour.name}</span>
              <span className="block text-base text-zayro-gray">{formatDuration(tour.duration_minutes)} · no payment required</span>
            </Link>
          ) : (
            <Link href="/contact" className="card card-interactive block">
              <span className="block text-lg font-black text-zayro-dark">Custom projects</span>
              <span className="block text-base text-zayro-gray">Tell us what you need</span>
            </Link>
          )}
        </div>

        <div className="mt-10 text-center">
          <Link href="/pricing" className="button button-secondary">
            See full pricing
          </Link>
        </div>
      </div>
    </section>
  );
}
