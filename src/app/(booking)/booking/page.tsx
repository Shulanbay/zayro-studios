import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Book Studio | ZAYRO Studios',
  description: 'Book your ZAYRO Studios session. Easy online booking with available dates and times.',
  robots: {
    index: false,
  },
};

export default function BookingPage() {
  return (
    <main className="min-h-screen bg-zayro-bg py-8 md:py-12">
      <div className="container">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-bold mb-6">
            Book Your Studio Session
          </h1>

          <div className="bg-white rounded-lg p-8 border border-zayro-bg">
            <div className="text-center">
              <div className="text-6xl mb-4">📅</div>
              <h2 className="text-2xl font-bold mb-3">Booking System Loading</h2>
              <p className="text-zayro-gray mb-6">
                The advanced booking system is being built with real-time availability checking,
                temporary holds during checkout, and instant confirmation.
              </p>

              <div className="bg-zayro-bg p-6 rounded-lg mb-6 text-left space-y-2">
                <h3 className="font-semibold text-zayro-dark mb-3">Phase 2 Development Plan:</h3>
                <p className="text-sm text-zayro-gray">
                  ✓ Service selection with pricing <br/>
                  ✓ Duration configuration <br/>
                  ✓ Calendar date picker <br/>
                  ✓ Time slot availability <br/>
                  ✓ Customer information form <br/>
                  ✓ Order review and summary <br/>
                  ✓ Stripe payment integration <br/>
                  ✓ 15-minute temporary booking holds <br/>
                  ✓ Google Calendar sync <br/>
                  ✓ Confirmation emails <br/>
                </p>
              </div>

              <p className="text-zayro-gray text-sm">
                For now, please contact us at hello@zayro.studio or call +1-XXX-XXX-XXXX to book.
              </p>
            </div>
          </div>

          {/* Booking Status Timeline */}
          <div className="mt-12">
            <h3 className="text-2xl font-bold mb-8">How Booking Works</h3>

            <div className="space-y-4">
              {[
                { num: 1, title: 'Select Service', desc: 'Choose your recording package' },
                { num: 2, title: 'Pick Date & Time', desc: 'View real-time availability' },
                { num: 3, title: 'Enter Details', desc: 'Tell us about your session' },
                { num: 4, title: 'Secure Payment', desc: '15-minute hold while you pay' },
                { num: 5, title: 'Confirmation', desc: 'Get your booking details' },
              ].map((step, idx) => (
                <div key={idx} className="flex gap-4 items-start">
                  <div className="flex-shrink-0 w-10 h-10 bg-zayro-primary text-white rounded-full flex items-center justify-center font-bold">
                    {step.num}
                  </div>
                  <div>
                    <h4 className="font-semibold text-zayro-dark">{step.title}</h4>
                    <p className="text-zayro-gray">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
