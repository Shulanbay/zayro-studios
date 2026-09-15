import Link from 'next/link';

export default function PricingSection() {
  const packages = [
    {
      name: 'Single Hour',
      price: '$200',
      duration: '1 hour',
      features: ['4K Video', 'Professional Audio', 'Editing Included'],
    },
    {
      name: 'Half Day',
      price: '$500',
      duration: '4 hours',
      features: ['4K Multi-Camera', 'Professional Audio', 'Advanced Editing', 'Expert Support'],
      popular: true,
    },
    {
      name: 'Full Day',
      price: '$900',
      duration: '8 hours',
      features: ['4K Multi-Camera', 'Professional Audio', 'Full Editing Suite', 'Expert Support', 'Same-Day Delivery'],
    },
  ];

  return (
    <section className="section-padding bg-zayro-bg">
      <div className="container max-w-5xl">
        <h2 className="text-5xl md:text-7xl font-black mb-4 text-zayro-dark">
          PRICING
        </h2>
        <p className="text-xl text-zayro-gray font-light mb-16 max-w-xl">
          Simple and transparent. All packages include professional editing and delivery.
        </p>

        {/* Editorial pricing layout */}
        <div className="space-y-12">
          {packages.map((pkg, idx) => (
            <div key={idx} className={`border-b border-zayro-gray pb-12 ${pkg.popular ? 'bg-white p-8 rounded-sm border border-zayro-gray' : ''}`}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
                {/* Package name and duration */}
                <div>
                  <h3 className="text-3xl md:text-4xl font-black text-zayro-dark mb-2">
                    {pkg.name}
                  </h3>
                  <p className="text-lg text-zayro-gray">{pkg.duration}</p>
                </div>

                {/* Price prominently displayed */}
                <div>
                  <p className="text-5xl md:text-6xl font-black text-zayro-primary mb-4">
                    {pkg.price}
                  </p>
                  {pkg.popular && (
                    <span className="text-sm font-semibold text-zayro-primary">MOST POPULAR</span>
                  )}
                </div>

                {/* Features and CTA */}
                <div>
                  <ul className="space-y-2 mb-6">
                    {pkg.features.map((feature, fidx) => (
                      <li key={fidx} className="text-zayro-gray">
                        ✓ {feature}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/booking"
                    className={`inline-block button ${
                      pkg.popular ? 'button-primary' : 'button-secondary'
                    }`}
                  >
                    BOOK NOW
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Custom pricing note */}
        <div className="mt-16 text-center">
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
