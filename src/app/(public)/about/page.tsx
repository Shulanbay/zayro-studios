import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About ZAYRO Studios',
  description: 'Learn about ZAYRO Studios, a premium podcast and video studio in Midtown Manhattan.',
};

export default function AboutPage() {
  return (
    <main>
      <section className="py-16 md:py-24 bg-zayro-bg">
        <div className="container max-w-3xl">
          <h1 className="text-5xl md:text-6xl font-bold mb-6">
            About ZAYRO Studios
          </h1>
          <p className="text-xl text-zayro-gray leading-relaxed">
            Premium podcast and video recording studio in the heart of Midtown Manhattan.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-white">
        <div className="container max-w-3xl space-y-8">
          <div>
            <h2 className="text-3xl font-bold mb-4">Our Mission</h2>
            <p className="text-zayro-gray leading-relaxed">
              To empower creators and podcasters with professional-grade equipment and expertise,
              making high-quality content production accessible and effortless. We believe that
              great content deserves great production.
            </p>
          </div>

          <div>
            <h2 className="text-3xl font-bold mb-4">Why ZAYRO?</h2>
            <p className="text-zayro-gray leading-relaxed mb-4">
              Built by creators, for creators. We understand what it takes to produce professional
              content at scale. Our team has years of experience in podcasting, video production,
              and live streaming.
            </p>
            <p className="text-zayro-gray leading-relaxed">
              We don't just rent studio space. We provide a complete creative partner experience,
              from booking to delivery.
            </p>
          </div>

          <div>
            <h2 className="text-3xl font-bold mb-4">Our Commitment</h2>
            <ul className="space-y-3 text-zayro-gray">
              <li className="flex gap-3">
                <span className="text-zayro-primary">✓</span>
                <span>Professional-grade equipment always</span>
              </li>
              <li className="flex gap-3">
                <span className="text-zayro-primary">✓</span>
                <span>Fast, reliable turnaround</span>
              </li>
              <li className="flex gap-3">
                <span className="text-zayro-primary">✓</span>
                <span>Expert support throughout your session</span>
              </li>
              <li className="flex gap-3">
                <span className="text-zayro-primary">✓</span>
                <span>Transparent, competitive pricing</span>
              </li>
              <li className="flex gap-3">
                <span className="text-zayro-primary">✓</span>
                <span>Premium NYC location</span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
