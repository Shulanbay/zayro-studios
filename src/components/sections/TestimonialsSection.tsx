import type { Testimonial } from '@/lib/showcase';

/** Real, permitted client quotes only (lib/showcase.ts). Renders nothing while there are none. No rating schema. */
export default function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
  if (testimonials.length === 0) return null;
  return (
    <section className="section-padding surface-soft">
      <div className="container max-w-5xl">
        <h2 className="text-[clamp(2rem,9vw,3rem)] md:text-6xl font-black text-zayro-dark mb-10">WHAT CLIENTS SAY</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {testimonials.map((t, i) => (
            <li key={i} className="card">
              <blockquote className="text-lg text-zayro-dark mb-4">“{t.quote}”</blockquote>
              <p className="font-bold text-zayro-dark">{t.name}</p>
              {t.role && <p className="text-sm text-zayro-gray">{t.role}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
