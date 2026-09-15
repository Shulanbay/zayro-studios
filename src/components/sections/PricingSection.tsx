import Link from 'next/link';

export default function PricingSection() {
  const packages = [
    {
      name: 'Single Hour',
      price: '$200',
      description: 'Perfect for podcast episodes or short video content',
      features: ['4K Video', 'Professional Audio', 'Editing Included', '1 hour'],
      popular: false,
    },
    {
      name: 'Half Day',
      price: '$500',
      description: 'Ideal for multi-guest recordings or video production',
      features: ['4K Multi-Camera', 'Professional Audio', 'Advanced Editing', '4 hours', 'Expert Support'],
      popular: true,
    },
    {
      name: 'Full Day',
      price: '$900',
      description: 'Best for comprehensive production projects',
      features: ['4K Multi-Camera', 'Professional Audio', 'Full Editing Suite', '8 hours', 'Expert Support', 'Same-Day Delivery'],
      popular: false,
    },
  ];

  return (
    <section className="py-16 md:py-24 bg-zayro-bg">
      <div className="container">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Simple & Transparent Pricing
          </h2>
          <p className="text-xl text-zayro-gray max-w-2xl mx-auto">
            All prices include professional editing and delivery
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {packages.map((pkg, idx) => (
            <div
              key={idx}
              className={`card transition-all duration-300 ${
                pkg.popular ? 'ring-2 ring-zayro-primary scale-105 md:scale-100' : ''
              }`}
            >
              {pkg.popular && (
                <div className="mb-4 inline-block bg-zayro-primary text-white px-3 py-1 rounded text-xs font-semibold">
                  Most Popular
                </div>
              )}

              <h3 className="text-2xl font-bold mb-2">{pkg.name}</h3>
              <div className="mb-2 text-zayro-gray">{pkg.description}</div>

              <div className="mb-6">
                <span className="text-4xl font-bold text-zayro-primary">{pkg.price}</span>
              </div>

              <ul className="space-y-3 mb-8">
                {pkg.features.map((feature, fidx) => (
                  <li key={fidx} className="flex items-center gap-2 text-zayro-gray">
                    <span className="text-zayro-primary">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href="/booking"
                className={`button w-full justify-center ${
                  pkg.popular ? 'button-primary' : 'button-secondary'
                }`}
              >
                Book Now
              </Link>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <p className="text-zayro-gray">
            Need custom pricing or bulk bookings?{' '}
            <Link href="/contact" className="text-zayro-primary font-semibold hover:underline">
              Contact us
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
