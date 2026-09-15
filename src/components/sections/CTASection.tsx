import Link from 'next/link';

export default function CTASection() {
  return (
    <section className="section-padding bg-zayro-dark text-white">
      <div className="container max-w-4xl text-center">
        <h2 className="text-6xl md:text-8xl font-black mb-8 leading-none">
          READY<br/>
          TO<br/>
          RECORD?
        </h2>

        <p className="text-xl text-gray-300 mb-12 font-light max-w-2xl mx-auto">
          Book your studio session today and start creating professional content in Midtown Manhattan.
        </p>

        <Link
          href="/booking"
          className="inline-block button bg-zayro-primary hover:bg-white hover:text-zayro-dark text-white font-bold py-4 px-10 text-lg transition-all"
        >
          BOOK STUDIO
        </Link>

        <p className="text-gray-400 text-sm mt-12 font-light">
          Questions? Contact us at hello@zayro.studio
        </p>
      </div>
    </section>
  );
}
