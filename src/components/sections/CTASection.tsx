import Link from 'next/link';

export default function CTASection() {
  return (
    <section className="py-20 md:py-32 bg-zayro-dark text-white">
      <div className="container text-center">
        <h2 className="text-4xl md:text-5xl font-bold mb-6">
          Ready to Create Something Amazing?
        </h2>

        <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto leading-relaxed">
          Book your studio session today and start creating professional content
          in Midtown Manhattan.
        </p>

        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <Link
            href="/booking"
            className="bg-zayro-primary hover:bg-zayro-dark hover:border-2 hover:border-zayro-primary text-white font-semibold py-3 px-8 rounded transition-all"
          >
            Book Studio Now
          </Link>
          <Link
            href="/studio-tour"
            className="border-2 border-white hover:bg-white hover:text-zayro-dark text-white font-semibold py-3 px-8 rounded transition-all"
          >
            Free Studio Tour
          </Link>
        </div>

        <p className="text-gray-400 text-sm mt-8">
          Questions? Call us at +1-XXX-XXX-XXXX or email hello@zayro.studio
        </p>
      </div>
    </section>
  );
}
