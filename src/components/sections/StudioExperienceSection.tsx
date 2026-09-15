export default function StudioExperienceSection() {
  const experiences = [
    {
      title: 'Multi-Camera Recording',
      description: '4K video with multiple camera angles for dynamic content',
      icon: '🎥',
    },
    {
      title: 'Professional Audio',
      description: 'Broadcast-quality microphones and mixing equipment',
      icon: '🎙️',
    },
    {
      title: 'Studio Lighting',
      description: 'Professional lighting rigs for cinematic production value',
      icon: '💡',
    },
    {
      title: 'Green Screen',
      description: 'Full green screen setup for virtual backgrounds',
      icon: '🟢',
    },
    {
      title: 'Live Streaming',
      description: 'Equipment and support for live multi-platform streaming',
      icon: '📡',
    },
    {
      title: 'Same-Day Delivery',
      description: 'Fast turnaround editing and file delivery',
      icon: '⚡',
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="container">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Everything You Need
          </h2>
          <p className="text-xl text-zayro-gray max-w-2xl mx-auto">
            Complete professional studio experience with expert support
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {experiences.map((item, idx) => (
            <div key={idx} className="card hover:border-zayro-primary">
              <div className="text-4xl mb-4">{item.icon}</div>
              <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
              <p className="text-zayro-gray">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
