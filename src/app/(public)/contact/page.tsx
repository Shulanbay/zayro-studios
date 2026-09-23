import type { Metadata } from 'next';
import { BUSINESS_ADDRESS, BUSINESS_PHONE, BUSINESS_EMAIL } from '@/lib/constants';
import ContactForm from '@/components/sections/ContactForm';

export const metadata: Metadata = {
  title: 'Contact ZAYRO Studios',
  description: 'Get in touch with ZAYRO Studios. Located in Midtown Manhattan.',
};

export default function ContactPage() {
  return (
    <main>
      <section className="section-padding surface-soft">
        <div className="container">
          <h1 className="text-5xl md:text-6xl font-bold mb-4 text-zayro-dark">
            Get in Touch
          </h1>
          <p className="text-xl text-zayro-gray">
            Have questions? We'd love to hear from you.
          </p>
        </div>
      </section>

      <section className="section-padding bg-white">
        <div className="container">
          <div className={`grid grid-cols-1 ${BUSINESS_PHONE ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-6 mb-12 max-w-3xl mx-auto`}>
            <div className="card text-center">
              <div className="w-10 h-10 rounded-full bg-gradient-cta mx-auto mb-4" aria-hidden="true" />
              <h3 className="font-semibold mb-2 text-zayro-dark">Address</h3>
              <p className="text-zayro-gray text-sm">{BUSINESS_ADDRESS}</p>
            </div>

            {BUSINESS_PHONE && (
              <div className="card text-center">
                <div className="w-10 h-10 rounded-full bg-gradient-cta mx-auto mb-4" aria-hidden="true" />
                <h3 className="font-semibold mb-2 text-zayro-dark">Phone</h3>
                <a href={`tel:${BUSINESS_PHONE}`} className="text-zayro-primary hover:underline">
                  {BUSINESS_PHONE}
                </a>
              </div>
            )}

            <div className="card text-center">
              <div className="w-10 h-10 rounded-full bg-gradient-cta mx-auto mb-4" aria-hidden="true" />
              <h3 className="font-semibold mb-2 text-zayro-dark">Email</h3>
              <a href={`mailto:${BUSINESS_EMAIL}`} className="text-zayro-primary hover:underline">
                {BUSINESS_EMAIL}
              </a>
            </div>
          </div>

          <ContactForm />
        </div>
      </section>
    </main>
  );
}
