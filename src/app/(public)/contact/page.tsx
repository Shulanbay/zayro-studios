import type { Metadata } from 'next';
import { BUSINESS_ADDRESS, BUSINESS_PHONE, BUSINESS_EMAIL } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Contact ZAYRO Studios',
  description: 'Get in touch with ZAYRO Studios. Located in Midtown Manhattan.',
};

export default function ContactPage() {
  return (
    <main>
      <section className="py-16 md:py-24 bg-zayro-bg">
        <div className="container">
          <h1 className="text-5xl md:text-6xl font-bold mb-4">
            Get in Touch
          </h1>
          <p className="text-xl text-zayro-gray">
            Have questions? We'd love to hear from you.
          </p>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-white">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            <div className="card text-center">
              <div className="text-4xl mb-4">📍</div>
              <h3 className="font-semibold mb-2">Address</h3>
              <p className="text-zayro-gray">{BUSINESS_ADDRESS}</p>
            </div>

            <div className="card text-center">
              <div className="text-4xl mb-4">📞</div>
              <h3 className="font-semibold mb-2">Phone</h3>
              <a href={`tel:${BUSINESS_PHONE}`} className="text-zayro-primary hover:underline">
                {BUSINESS_PHONE}
              </a>
            </div>

            <div className="card text-center">
              <div className="text-4xl mb-4">✉️</div>
              <h3 className="font-semibold mb-2">Email</h3>
              <a href={`mailto:${BUSINESS_EMAIL}`} className="text-zayro-primary hover:underline">
                {BUSINESS_EMAIL}
              </a>
            </div>
          </div>

          <div className="max-w-xl mx-auto">
            <h2 className="text-3xl font-bold mb-6 text-center">
              Send us a Message
            </h2>

            <form className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Name</label>
                <input
                  type="text"
                  placeholder="Your name"
                  className="w-full px-4 py-3 border border-zayro-bg rounded focus:border-zayro-primary focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Email</label>
                <input
                  type="email"
                  placeholder="your@email.com"
                  className="w-full px-4 py-3 border border-zayro-bg rounded focus:border-zayro-primary focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Message</label>
                <textarea
                  placeholder="Your message..."
                  rows={6}
                  className="w-full px-4 py-3 border border-zayro-bg rounded focus:border-zayro-primary focus:outline-none"
                  required
                ></textarea>
              </div>

              <button
                type="submit"
                className="button button-primary w-full"
              >
                Send Message
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
