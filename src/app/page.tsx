import Link from 'next/link';
import { BUSINESS_ADDRESS, BUSINESS_PHONE } from '@/lib/constants';
import HeroSection from '@/components/sections/HeroSection';
import StudioExperienceSection from '@/components/sections/StudioExperienceSection';
import PricingSection from '@/components/sections/PricingSection';
import EquipmentSection from '@/components/sections/EquipmentSection';
import FAQSection from '@/components/sections/FAQSection';
import CTASection from '@/components/sections/CTASection';

export default function Home() {
  return (
    <>
      {/* Hero Section */}
      <HeroSection />

      {/* Studio Experience */}
      <StudioExperienceSection />

      {/* Equipment */}
      <EquipmentSection />

      {/* Pricing */}
      <PricingSection />

      {/* Why Choose ZAYRO */}
      <section className="py-16 md:py-24 bg-white">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              Why Choose ZAYRO
            </h2>
            <p className="text-xl text-zayro-gray max-w-2xl mx-auto">
              Professional podcast and video production made simple
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                title: 'Turn-Key Experience',
                description: 'Show up and start recording. Audio, video, and lighting are all handled for you.',
                icon: '⚡',
              },
              {
                title: 'Professional Quality',
                description: '4K multi-camera video with broadcast-quality audio that elevates your brand.',
                icon: '🎬',
              },
              {
                title: 'Expert Support',
                description: 'Work directly with professionals who care about your results and your success.',
                icon: '🤝',
              },
              {
                title: 'Fast Turnaround',
                description: 'Your files are delivered quickly, perfect for creators on tight schedules.',
                icon: '⏱️',
              },
              {
                title: 'Flexible Scheduling',
                description: 'Book the exact dates and times that work for your production schedule.',
                icon: '📅',
              },
              {
                title: 'Premium Location',
                description: 'Located in the heart of Midtown Manhattan with convenient access and parking.',
                icon: '📍',
              },
            ].map((item, idx) => (
              <div key={idx} className="card">
                <div className="text-4xl mb-4">{item.icon}</div>
                <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                <p className="text-zayro-gray">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Location Section */}
      <section className="py-16 md:py-24 bg-zayro-bg">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold mb-6">
                Located in Midtown Manhattan
              </h2>
              <p className="text-lg text-zayro-gray mb-6">
                Conveniently located on West 37th Street between 5th and 6th Avenues,
                just minutes from Herald Square, Bryant Park, and Times Square.
              </p>

              <div className="space-y-4 mb-8">
                <div>
                  <h4 className="font-semibold mb-2">Address</h4>
                  <p className="text-zayro-gray">{BUSINESS_ADDRESS}</p>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Phone</h4>
                  <p className="text-zayro-gray">{BUSINESS_PHONE}</p>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Hours</h4>
                  <p className="text-zayro-gray">Monday - Friday: 9:00 AM - 6:00 PM</p>
                  <p className="text-zayro-gray">Saturday: 10:00 AM - 4:00 PM</p>
                  <p className="text-zayro-gray">Sunday: Closed</p>
                </div>
              </div>

              <div className="flex gap-4">
                <Link href="/booking" className="button button-primary">
                  Book Studio
                </Link>
                <Link href="/studio-tour" className="button button-secondary">
                  Free Studio Tour
                </Link>
              </div>
            </div>

            <div className="bg-gradient-to-br from-zayro-primary to-zayro-dark rounded-lg h-96 flex items-center justify-center">
              <div className="text-center text-white">
                <p className="text-lg font-semibold mb-2">📍</p>
                <p className="text-sm">Map embedding coming soon</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <FAQSection />

      {/* Final CTA */}
      <CTASection />
    </>
  );
}
