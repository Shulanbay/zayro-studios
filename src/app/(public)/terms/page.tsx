import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import { POLICY_COPY } from '@/lib/policies';

export const metadata: Metadata = pageMetadata({
  title: 'Terms of Service | ZAYRO Studios',
  description:
    'Booking, cancellation and studio terms for ZAYRO Studios.',
  path: '/terms',
});

export default function TermsPage() {
  return (
    <div>
      <section className="section-padding surface-soft">
        <div className="container">
          <h1 className="text-[clamp(2.25rem,10vw,3rem)] md:text-6xl font-bold mb-4 text-zayro-dark">
            Terms of Service
          </h1>
        </div>
      </section>

      <section className="section-padding bg-white">
        <div className="container max-w-3xl card">
          <p className="text-zayro-gray leading-relaxed mb-6">
            Last updated: November 11, 2026
          </p>

          <h2 className="text-2xl font-bold mb-4">Agreement to Terms</h2>
          <p className="text-zayro-gray leading-relaxed mb-6">
            By accessing and using this website, you accept and agree to be bound by the terms and provision
            of this agreement. If you do not agree to abide by the above, please do not use this service.
          </p>

          <h2 id="booking-policies" className="text-2xl font-bold mb-4 scroll-mt-24">Booking, Cancellation and Studio-Time Policies</h2>
          <p className="text-zayro-gray leading-relaxed mb-4">
            All studio bookings are subject to the following terms. You agree to them when you book.
          </p>
          <ul className="space-y-2 text-zayro-gray mb-6">
            <li>• Full payment is required at the time of booking.</li>
            <li>• {POLICY_COPY.cancellation}</li>
            <li>• {POLICY_COPY.changes}</li>
            <li>• {POLICY_COPY.noShow}</li>
            <li>• {POLICY_COPY.refund}</li>
            <li>• {POLICY_COPY.studioTime}</li>
            <li>• {POLICY_COPY.earlyArrival}</li>
            <li>• {POLICY_COPY.setupChange}</li>
            <li>• {POLICY_COPY.lateArrival}</li>
            <li>• {POLICY_COPY.extension}</li>
            <li>• Full Podcast Package: {POLICY_COPY.editedDelivery}</li>
            <li>• Sessions use at most 3 cameras. Additional cameras can be added only to packages that include fewer than 3.</li>
            <li>
              • Cancel, reschedule or add time with the secure Manage Your Booking link in your confirmation email. Changes
              to your package, extras or details are made by contacting the studio.
            </li>
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
    </div>
  );
}
