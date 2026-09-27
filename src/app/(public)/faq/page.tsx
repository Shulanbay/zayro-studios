import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import FAQSection from '@/components/sections/FAQSection';
import { getBookingFacts } from '@/lib/bookingFacts';

export const metadata: Metadata = pageMetadata({
  title: 'FAQ | ZAYRO Studios',
  description:
    'Answers about booking, hours, editing, cancellations and visiting ZAYRO Studios in Midtown Manhattan.',
  path: '/faq',
});

// Hours and booking rules come from the database; refreshed every few minutes.
export const revalidate = 300;

export default async function FAQPage() {
  const facts = await getBookingFacts();
  return (
    <div>
      <section className="section-padding surface-soft">
        <div className="container">
          <h1 className="text-[clamp(2.25rem,10vw,3rem)] md:text-6xl font-bold mb-4 text-zayro-dark">
            Frequently Asked Questions
          </h1>
          <p className="text-xl text-zayro-gray">
            Everything you need to know about booking and using our studio
          </p>
        </div>
      </section>

      {/* The page hero above already carries the heading. */}
      <FAQSection showHeading={false} facts={facts} />
    </div>
  );
}
