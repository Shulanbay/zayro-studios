import Link from 'next/link';
import Reveal from '@/components/ui/Reveal';

export default function CTASection() {
  return (
    <section className="section-padding surface-dark text-center">
      <div className="container max-w-4xl">
        <Reveal>
          <h2 className="text-6xl md:text-8xl font-black mb-8 leading-none">
            READY
            <br />
            TO
            <br />
            RECORD?
          </h2>

          <p className="text-xl mb-12 font-light max-w-2xl mx-auto text-zayro-gray">
            Book your studio session today and start creating professional content in Midtown Manhattan.
          </p>

          <Link href="/booking" className="button button-primary text-base px-10 py-4">
            Book Studio
          </Link>

          <p className="text-sm mt-12 font-light text-zayro-gray">
            Questions? <a href="mailto:hello@zayro.studio" className="underline">hello@zayro.studio</a>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
