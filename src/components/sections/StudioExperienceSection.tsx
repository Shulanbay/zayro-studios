import Link from 'next/link';
import Reveal from '@/components/ui/Reveal';

/** Why book here — outcomes, not a second equipment list (that lives on /studio). */
export default function StudioExperienceSection() {
  const features = [
    { title: 'Ready when you arrive', description: 'Your chosen setup, cameras, sound and lighting are prepared before your session starts.' },
    { title: 'A technician runs the room', description: 'A videographer / studio technician handles the technical side, so you can focus on the conversation.' },
    { title: 'Raw files within 24 hours', description: 'Raw camera files and separate audio tracks are delivered through Google Drive within 24 hours.' },
    { title: 'Editing when you want it', description: 'Included with the Full Podcast Package, or added to any podcast session as an extra.' },
    { title: 'Several looks, one room', description: 'Switch setups mid-session if you like — changes typically take 10–20 minutes of your booked time.' },
    { title: 'Easy to reach', description: 'Steps from Herald Square, Bryant Park and Times Square, with a free tour before you book.' },
  ];

  return (
    <section className="section-padding bg-white">
      <div className="container max-w-5xl">
        <Reveal>
          <h2 className="text-[clamp(2.25rem,10.5vw,3rem)] md:text-7xl font-black mb-6 text-zayro-dark">
            WHY CREATORS
            <br />
            BOOK ZAYRO
          </h2>
          <p className="text-lg text-zayro-gray mb-12 max-w-2xl">
            Curious about the gear?{' '}
            <Link href="/studio" className="font-semibold text-zayro-primary hover:underline">
              See the full equipment list
            </Link>
            .
          </p>
        </Reveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, idx) => (
            <Reveal key={idx} delayMs={idx * 60}>
              <div className="card h-full">
                <div className="w-10 h-10 rounded-full bg-gradient-cta mb-5 flex items-center justify-center text-white font-bold text-sm" aria-hidden="true">
                  {String(idx + 1).padStart(2, '0')}
                </div>
                <h3 className="text-lg font-bold text-zayro-dark mb-2">{feature.title}</h3>
                <p className="text-sm text-zayro-gray leading-relaxed">{feature.description}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
