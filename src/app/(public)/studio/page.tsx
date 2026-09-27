import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'The Studio | ZAYRO Studios',
  description:
    'The ZAYRO Studios space and equipment: 4K cameras, broadcast microphones and studio lighting in Midtown Manhattan.',
  path: '/studio',
});

export default function StudioPage() {
  return (
    <div>
      {/* Hero */}
      <section className="section-padding surface-soft">
        <div className="container">
          <h1 className="text-[clamp(2.25rem,10vw,3rem)] md:text-6xl font-bold mb-4 text-zayro-dark">
            The Studio
          </h1>
          <p className="text-xl text-zayro-gray">
            Broadcast-ready equipment in a Midtown Manhattan location.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="section-padding bg-white">
        <div className="container max-w-3xl">
          <h2 className="text-4xl font-bold mb-8 text-zayro-dark">Inside ZAYRO Studios</h2>

          <div className="space-y-6">
            <div className="card">
              <h3 className="text-xl font-bold mb-4 text-zayro-dark">The Space</h3>
              <p className="text-zayro-gray mb-4 leading-relaxed">
                Located at 40 W 37th Street in Midtown Manhattan, ZAYRO Studios offers a
                professional recording environment for podcasts, video content, and live streaming.
              </p>
              <p className="text-zayro-gray leading-relaxed">
                The studio features flexible set configurations, backdrop options, and the
                equipment you need for broadcast-quality production.
              </p>
            </div>

            <div className="card">
              <h3 className="text-xl font-bold mb-4 text-zayro-dark">Equipment Highlights</h3>
              <ul className="space-y-3 text-zayro-gray">
                <li className="flex gap-3">
                  <span className="text-zayro-primary" aria-hidden="true">✓</span>
                  <span>Sony FX30 and A7IV for 4K video recording</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-zayro-primary" aria-hidden="true">✓</span>
                  <span>Shure SM7B microphones with professional mixing</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-zayro-primary" aria-hidden="true">✓</span>
                  <span>Professional lighting rigs for cinematic production</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-zayro-primary" aria-hidden="true">✓</span>
                  <span>Green screen and custom backdrops</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-zayro-primary" aria-hidden="true">✓</span>
                  <span>Live streaming capability to multiple platforms</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-zayro-primary" aria-hidden="true">✓</span>
                  <span>Professional editing with the Full Podcast Package, or as an add-on</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
