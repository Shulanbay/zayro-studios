import type { Metadata } from 'next';
import FAQSection from '@/components/sections/FAQSection';

export const metadata: Metadata = {
  title: 'FAQ | ZAYRO Studios',
  description: 'Frequently asked questions about booking and using ZAYRO Studios.',
};

export default function FAQPage() {
  return (
    <main>
      <section className="py-16 md:py-24 bg-zayro-bg">
        <div className="container">
          <h1 className="text-5xl md:text-6xl font-bold mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-xl text-zayro-gray">
            Everything you need to know about booking and using our studio
          </p>
        </div>
      </section>

      <FAQSection />
    </main>
  );
}
