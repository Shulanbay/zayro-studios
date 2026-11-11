import Reveal from '@/components/ui/Reveal';

export default function HowBookingWorksSection() {
  const steps = [
    { title: 'Pick a package and setup', description: 'Choose the session that fits your show, the look you want and how many hours you need (1–9).' },
    { title: 'Choose a time', description: 'See live availability and reserve your slot — it’s held for you while you check out.' },
    { title: 'Pay & get your link', description: 'Pay securely online. Your confirmation email includes a link to reschedule, add time or cancel.' },
    { title: 'Arrive ready to record', description: 'Your reserved time includes preparation and setup changes, so arrive ready to begin.' },
  ];

  return (
    <section className="section-padding bg-white">
      <div className="container max-w-5xl">
        <Reveal>
          <h2 className="text-[clamp(2.25rem,10.5vw,3rem)] md:text-7xl font-black mb-16 text-zayro-dark">
            HOW BOOKING
            <br />
            WORKS
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((step, idx) => (
            <Reveal key={idx} delayMs={idx * 80}>
              <div className="relative">
                <div className="text-6xl font-black bg-gradient-cta bg-clip-text text-transparent mb-4" aria-hidden="true">
                  {idx + 1}
                </div>
                <h3 className="text-xl font-bold text-zayro-dark mb-2">{step.title}</h3>
                <p className="text-zayro-gray leading-relaxed">{step.description}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
