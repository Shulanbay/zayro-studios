export default function StudioExperienceSection() {
  const features = [
    {
      number: '01',
      title: 'Multi-Camera Recording',
      description: '4K video with multiple camera angles for dynamic content'
    },
    {
      number: '02',
      title: 'Professional Audio',
      description: 'Broadcast-quality microphones and mixing equipment'
    },
    {
      number: '03',
      title: 'Studio Lighting',
      description: 'Professional lighting rigs for cinematic production value'
    },
    {
      number: '04',
      title: 'Green Screen',
      description: 'Full green screen setup for virtual backgrounds'
    },
    {
      number: '05',
      title: 'Live Streaming',
      description: 'Equipment and support for live multi-platform streaming'
    },
    {
      number: '06',
      title: 'Same-Day Delivery',
      description: 'Fast turnaround editing and file delivery'
    },
  ];

  return (
    <section className="section-padding bg-white">
      <div className="container max-w-4xl">
        <h2 className="text-5xl md:text-7xl font-black mb-16 text-zayro-dark">
          EVERYTHING<br/>YOU NEED
        </h2>

        {/* Editorial rows instead of cards */}
        <div className="space-y-0">
          {features.map((feature, idx) => (
            <div key={idx} className="editorial-row group cursor-pointer">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div className="flex gap-6 flex-1">
                  <span className="editorial-number whitespace-nowrap">{feature.number}</span>
                  <div>
                    <h3 className="editorial-title mb-2">{feature.title}</h3>
                    <p className="editorial-description">{feature.description}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
