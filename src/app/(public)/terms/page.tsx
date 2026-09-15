import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | ZAYRO Studios',
  description: 'Terms of service for ZAYRO Studios.',
};

export default function TermsPage() {
  return (
    <main>
      <section className="py-16 md:py-24 bg-zayro-bg">
        <div className="container">
          <h1 className="text-5xl md:text-6xl font-bold mb-4">
            Terms of Service
          </h1>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-white">
        <div className="container max-w-3xl">
          <p className="text-zayro-gray leading-relaxed mb-6">
            Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>

          <h2 className="text-2xl font-bold mb-4">Agreement to Terms</h2>
          <p className="text-zayro-gray leading-relaxed mb-6">
            By accessing and using this website, you accept and agree to be bound by the terms and provision
            of this agreement. If you do not agree to abide by the above, please do not use this service.
          </p>

          <h2 className="text-2xl font-bold mb-4">Booking and Cancellation Policy</h2>
          <p className="text-zayro-gray leading-relaxed mb-4">
            All studio bookings are subject to the following terms:
          </p>
          <ul className="space-y-2 text-zayro-gray mb-6">
            <li>• Full payment is required at time of booking</li>
            <li>• Cancellations more than 24 hours in advance receive a full refund</li>
            <li>• Cancellations within 24 hours forfeit 50% of the booking amount</li>
            <li>• No-shows forfeit 100% of the booking amount</li>
            <li>• Rescheduling must be made at least 24 hours in advance</li>
          </ul>

          <h2 className="text-2xl font-bold mb-4">Intellectual Property Rights</h2>
          <p className="text-zayro-gray leading-relaxed mb-6">
            Unless otherwise stated, ZAYRO Studios and/or its licensors own the intellectual property rights
            for all material on zayro.studio. All intellectual property rights are reserved.
          </p>

          <h2 className="text-2xl font-bold mb-4">Content and Studio Rules</h2>
          <p className="text-zayro-gray leading-relaxed mb-4">
            You agree not to:
          </p>
          <ul className="space-y-2 text-zayro-gray mb-6">
            <li>• Create, publish, or distribute any illegal content</li>
            <li>• Violate anyone's privacy or intellectual property rights</li>
            <li>• Damage, disable, overburden, or impair the studio equipment</li>
            <li>• Violate any applicable laws or regulations</li>
          </ul>

          <h2 className="text-2xl font-bold mb-4">Contact Us</h2>
          <p className="text-zayro-gray leading-relaxed">
            If you have any questions about these Terms and Conditions, please contact us at
            hello@zayro.studio
          </p>
        </div>
      </section>
    </main>
  );
}
