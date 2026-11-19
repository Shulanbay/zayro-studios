import Link from 'next/link';
import { contactHref } from '@/lib/catalog';

/** Custom corporate productions: quoted individually, never a fixed price. */
export default function CorporateSection({ className = 'section-padding bg-white' }: { className?: string }) {
  return (
    <section aria-labelledby="corporate-heading" className={className}>
      <div className="container max-w-5xl">
        <div className="card flex flex-col md:flex-row md:items-center gap-8 min-w-0 !p-8 md:!p-12">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold tracking-[0.14em] uppercase text-zayro-primary mb-3">For businesses</p>
            <h2 id="corporate-heading" className="text-3xl md:text-4xl font-black text-zayro-dark mb-4">
              Custom Corporate Productions
            </h2>
            <p className="text-lg text-zayro-gray max-w-2xl leading-relaxed">
              From executive interviews to branded podcasts and corporate video productions, our team provides tailored
              production experiences for businesses and professionals.
            </p>
          </div>
          <Link href={contactHref('Custom corporate production')} className="button button-primary md:w-auto w-full text-center">
            Request a Custom Quote
          </Link>
        </div>
      </div>
    </section>
  );
}
