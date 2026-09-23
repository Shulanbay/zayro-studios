import Reveal from '@/components/ui/Reveal';

export default function HowBookingWorksSection() {
  const steps = [
    { title: 'Pick a service', description: 'Choose the session type that fits your recording, from a single hour to full production.' },
    { title: 'Choose a time', description: 'See real, live availability and reserve your slot — it’s held for you while you check out.' },
    { title: 'Confirm & record', description: 'Pay securely online, get an instant confirmation email, and show up ready to record.' },
  ];

  return (
    <section className="section-padding bg-white">
      <div className="container max-w-5xl">
        <Reveal>
          <h2 className="text-5xl md:text-7xl font-black mb-16 text-zayro-dark">
            HOW BOOKING
            <br />
            WORKS
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
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
