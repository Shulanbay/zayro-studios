'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Reveal from '@/components/ui/Reveal';

interface Service {
  id: number;
  name: string;
  description: string | null;
  base_price: string;
  duration_minutes: number;
  features: string[] | null;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours % 1 === 0 ? hours : hours.toFixed(1)} hour${hours !== 1 ? 's' : ''}`;
}

export default function PricingSection() {
  const [services, setServices] = useState<Service[] | null>(null);
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

  return (
    <section className="section-padding bg-zayro-bg" id="pricing">
      <div className="container max-w-5xl">
        <Reveal>
          <h2 className="text-5xl md:text-7xl font-black mb-4 text-zayro-dark">PRICING</h2>
          <p className="text-xl text-zayro-gray font-light mb-16 max-w-xl">
            Simple and transparent. Every session includes professional recording gear and a producer on hand.
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
            <Reveal key={service.id} delayMs={idx * 80}>
              <div className="card h-full flex flex-col">
                <h3 className="text-2xl font-black text-zayro-dark mb-2">{service.name}</h3>
                <p className="text-sm text-zayro-gray mb-6">{service.description}</p>
                <div className="flex items-baseline gap-2 mb-6">
                  <span className="text-4xl font-black text-zayro-dark">
                    {parseFloat(service.base_price) > 0 ? `$${parseFloat(service.base_price).toFixed(0)}` : 'Free'}
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
                <Link href="/booking" className="button button-primary w-full mt-auto">
                  BOOK NOW
                </Link>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-16 text-center">
          <p className="text-zayro-gray">
            Need custom pricing or a multi-session package?{' '}
            <Link href="/contact" className="text-zayro-primary font-semibold hover:underline">
              Contact us
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
