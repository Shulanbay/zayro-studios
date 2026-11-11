import Link from 'next/link';
import Reveal from '@/components/ui/Reveal';
import { formatDuration } from '@/lib/catalog';

/** What a visitor can book, linking to the SEO landing pages and straight into booking. */
export default function WhatYouCanBookSection({ tourMinutes = null }: { tourMinutes?: number | null }) {
  const cards = [
    {
      eyebrow: 'PODCAST RECORDING',
      title: 'Podcast Studio NYC',
      text: 'Solo shows, interviews and multi-camera video podcasts, booked by the hour with a technician on site.',
      href: '/podcast-studio-nyc',
      cta: 'Explore podcast studio',
    },
    {
      eyebrow: 'VIDEO & FILMING',
      title: 'Video Production Studio NYC',
      text: 'Interviews, YouTube videos, online courses and branded content in a Manhattan filming studio.',
      href: '/video-production-studio-nyc',
      cta: 'Explore video studio',
    },
    {
      eyebrow: 'STUDIO PHOTOGRAPHY',
      title: 'Headshots & Brand Content',
      text: 'Studio headshots, portraits and brand photo sessions in the same space.',
      href: '/pricing#photography',
      cta: 'See photography pricing',
    },
    {
      eyebrow: 'FREE STUDIO TOUR',
      title: 'See the Space First',
      text: `${tourMinutes ? `${formatDuration(tourMinutes)}, ` : ''}no payment needed. Meet the team and see every setup before you book.`,
      href: '/booking?category=tour',
      cta: 'Book a free tour',
    },
  ];
  return (
    <section className="section-padding surface-soft" aria-labelledby="what-you-can-book">
      <div className="container max-w-5xl">
        <Reveal>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-zayro-primary mb-3">40 W 37th Street, Midtown Manhattan</p>
          <h2 id="what-you-can-book" className="text-[clamp(2.25rem,10.5vw,3rem)] md:text-7xl font-black text-zayro-dark mb-6">
            WHAT YOU
            <br />
            CAN BOOK
          </h2>
          <p className="text-lg md:text-xl text-zayro-gray max-w-3xl leading-relaxed mb-10">
            ZAYRO Studios is a podcast recording, video filming and content production studio in Midtown Manhattan. Choose the
            session that matches your project.
          </p>
        </Reveal>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {cards.map((c, i) => (
            <Reveal key={c.href} delayMs={i * 60}>
              <Link href={c.href} className="card card-interactive group block h-full">
                <p className="text-sm font-bold text-zayro-primary mb-3">{c.eyebrow}</p>
                <h3 className="text-2xl md:text-3xl font-black text-zayro-dark mb-3">{c.title}</h3>
                <p className="text-zayro-gray mb-6">{c.text}</p>
                <span className="font-bold text-zayro-primary">
                  {c.cta} <span aria-hidden="true">→</span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
