import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About ZAYRO Studios',
  description: 'Learn about ZAYRO Studios, a premium podcast and video studio in Midtown Manhattan.',
};

export default function AboutPage() {
  return (
    <main>
      <section className="section-padding surface-soft">
        <div className="container max-w-3xl">
          <h1 className="text-5xl md:text-6xl font-bold mb-6 text-zayro-dark">
            About ZAYRO Studios
          </h1>
          <p className="text-xl text-zayro-gray leading-relaxed">
            A podcast and video recording studio in the heart of Midtown Manhattan.
          </p>
        </div>
      </section>

      <section className="section-padding bg-white">
        <div className="container max-w-3xl space-y-6">
          <div className="card">
            <h2 className="text-2xl font-bold mb-4 text-zayro-dark">Our Mission</h2>
            <p className="text-zayro-gray leading-relaxed">
              To give creators and podcasters access to professional-grade equipment and a space
              built for focused, high-quality recording — without needing a production team of their own.
            </p>
          </div>

          <div className="card">
            <h2 className="text-2xl font-bold mb-4 text-zayro-dark">Why ZAYRO?</h2>
            <p className="text-zayro-gray leading-relaxed mb-4">
              Every session comes with multi-camera 4K video, broadcast-quality audio, and a producer
              on hand — you show up and record, we handle the technical side.
            </p>
            <p className="text-zayro-gray leading-relaxed">
              We don't just rent studio space. Editing and fast delivery are part of every booking.
            </p>
          </div>

          <div className="card">
            <h2 className="text-2xl font-bold mb-4 text-zayro-dark">Our Commitment</h2>
            <ul className="space-y-3 text-zayro-gray">
              <li className="flex gap-3">
                <span className="text-zayro-primary" aria-hidden="true">✓</span>
                <span>Professional-grade equipment, every session</span>
              </li>
              <li className="flex gap-3">
                <span className="text-zayro-primary" aria-hidden="true">✓</span>
                <span>Fast, reliable turnaround on editing and delivery</span>
              </li>
              <li className="flex gap-3">
                <span className="text-zayro-primary" aria-hidden="true">✓</span>
                <span>Support throughout your session</span>
              </li>
              <li className="flex gap-3">
                <span className="text-zayro-primary" aria-hidden="true">✓</span>
                <span>Transparent, upfront pricing</span>
              </li>
              <li className="flex gap-3">
                <span className="text-zayro-primary" aria-hidden="true">✓</span>
                <span>Midtown Manhattan location</span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
