import Reveal from '@/components/ui/Reveal';

export default function StudioExperienceSection() {
  const features = [
    { title: 'Multi-Camera Recording', description: '4K video with multiple camera angles for dynamic content' },
    { title: 'Professional Audio', description: 'Broadcast-quality microphones and mixing equipment' },
    { title: 'Studio Lighting', description: 'Professional lighting rigs for cinematic production value' },
    { title: 'Green Screen', description: 'Full green screen setup for virtual backgrounds' },
    { title: 'Live Streaming', description: 'Equipment and support for live multi-platform streaming' },
    { title: 'Same-Day Delivery', description: 'Fast turnaround editing and file delivery' },
  ];

  return (
    <section className="section-padding bg-white">
      <div className="container max-w-5xl">
        <Reveal>
          <h2 className="text-5xl md:text-7xl font-black mb-16 text-zayro-dark">
            EVERYTHING
            <br />
            YOU NEED
          </h2>
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
