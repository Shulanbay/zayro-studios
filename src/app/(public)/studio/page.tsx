import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Studio Tour | ZAYRO Studios',
  description: 'Explore ZAYRO Studios equipment, layout, and facilities in Midtown Manhattan.',
};

export default function StudioPage() {
  return (
    <main>
      {/* Hero */}
      <section className="py-16 md:py-24 bg-zayro-bg">
        <div className="container">
          <h1 className="text-5xl md:text-6xl font-bold mb-4">
            Professional Studio
          </h1>
          <p className="text-xl text-zayro-gray">
            State-of-the-art equipment in a premium Midtown Manhattan location
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-16 md:py-24 bg-white">
        <div className="container max-w-3xl">
          <h2 className="text-4xl font-bold mb-8">Inside ZAYRO Studios</h2>

          <div className="space-y-8">
            <div>
              <h3 className="text-2xl font-bold mb-4">The Space</h3>
              <p className="text-zayro-gray mb-4 leading-relaxed">
                Located on the 6th floor of 40 W 37th Street in Midtown Manhattan,
                ZAYRO Studios offers a professional, light-filled recording environment
                perfect for podcasts, video content, and live streaming.
              </p>
              <p className="text-zayro-gray leading-relaxed">
                The studio features flexible set configurations, professional backdrop options,
                and all the equipment you need for broadcast-quality production.
              </p>
            </div>

            <div>
              <h3 className="text-2xl font-bold mb-4">Equipment Highlights</h3>
              <ul className="space-y-3 text-zayro-gray">
                <li className="flex gap-3">
                  <span className="text-zayro-primary">✓</span>
                  <span>Sony FX30 and A7IV for 4K video recording</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-zayro-primary">✓</span>
                  <span>Shure SM7B microphones with professional mixing</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-zayro-primary">✓</span>
                  <span>Professional lighting rigs for cinematic production</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-zayro-primary">✓</span>
                  <span>Green screen and custom backdrops</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-zayro-primary">✓</span>
                  <span>Live streaming capability to multiple platforms</span>
                </li>
                <li className="flex gap-3">
                  <span className="text-zayro-primary">✓</span>
                  <span>Fast turnaround editing and same-day delivery</span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-2xl font-bold mb-4">Amenities</h3>
              <ul className="space-y-3 text-zayro-gray">
                <li className="flex gap-3">
                  <span>🚗</span>
                  <span>Parking available on-site and nearby</span>
                </li>
                <li className="flex gap-3">
                  <span>☕</span>
                  <span>Green room with refreshments</span>
                </li>
                <li className="flex gap-3">
                  <span>♿</span>
                  <span>Accessible studio and facilities</span>
                </li>
                <li className="flex gap-3">
                  <span>🚕</span>
                  <span>Close to subway, taxi, and rideshare options</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
