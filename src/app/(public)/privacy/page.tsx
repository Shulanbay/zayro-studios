import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata({
  title: 'Privacy Policy | ZAYRO Studios',
  description:
    'How ZAYRO Studios collects, uses and protects your information.',
  path: '/privacy',
});

export default function PrivacyPage() {
  return (
    <div>
      <section className="section-padding surface-soft">
        <div className="container">
          <h1 className="text-[clamp(2.25rem,10vw,3rem)] md:text-6xl font-bold mb-4 text-zayro-dark">
            Privacy Policy
          </h1>
        </div>
      </section>

      <section className="section-padding bg-white">
        <div className="container max-w-3xl card">
          {/* LEGAL REVIEW: this copy describes the analytics/advertising setup accurately but is not legal advice.
              The owner (or counsel) must review it before the advertising destinations are switched on — see docs/analytics.md. */}
          <p className="text-zayro-gray leading-relaxed mb-6">
            Last updated: November 11, 2026
          </p>

          <h2 className="text-2xl font-bold mb-4">Introduction</h2>
          <p className="text-zayro-gray leading-relaxed mb-6">
            ZAYRO Studios (&quot;we&quot;, &quot;us&quot; or &quot;our&quot;) operates the zayro.studio website (the &quot;Site&quot;).
            This page explains what personal data we collect when you use the Site, why, who we share it with, how long we keep it
            and the choices you have.
          </p>

          <h2 className="text-2xl font-bold mb-4">Information we collect</h2>
          <ul className="space-y-2 text-zayro-gray mb-6">
            <li>• Booking and contact details you give us: name, email address, phone number, company, booking answers and messages.</li>
            <li>• Payment status from Stripe. Payments are processed by Stripe on its secure checkout page; we never see or store your full card number.</li>
            <li>
              • Usage data, only if you allow analytics: pages viewed, the booking steps you reached, the website or campaign that brought you here
              (for example a search engine or an ad), approximate device type (desktop, mobile or tablet) and the time of each visit.
            </li>
            <li>
              • Ad click identifiers, only if you allow advertising: when you arrive from an ad, the ad platform adds an identifier to the link
              (Google <code>gclid</code>, Meta <code>fbclid</code>, Reddit <code>rdt_cid</code>, Pinterest <code>epik</code>, TikTok <code>ttclid</code>).
            </li>
          </ul>
          <p className="text-zayro-gray leading-relaxed mb-6">
            Our own analytics does not store your IP address or full browser details, and it is not linked to your name, email or phone number.
            It uses a random identifier, so it is pseudonymous rather than anonymous.
          </p>

          <h2 className="text-2xl font-bold mb-4">How we use your information</h2>
          <ul className="space-y-2 text-zayro-gray mb-6">
            <li>• To confirm, manage and support your booking, and to contact you about it.</li>
            <li>• Booking confirmations are sent through our email delivery provider; booking details are kept in our booking system and the studio&apos;s internal calendar and records.</li>
            <li>• With your permission, to understand how visitors find and use the Site and which campaigns lead to bookings, so we can improve the Site and our advertising.</li>
            <li>• To prevent fraud, spam and abuse (for example rate limiting, which uses a one-way hash of your IP address that is not kept with analytics).</li>
          </ul>

          <h2 id="cookies" className="text-2xl font-bold mb-4 scroll-mt-24">Cookies and your choices</h2>
          <p className="text-zayro-gray leading-relaxed mb-4">
            When you first visit, we ask which optional cookies you allow. Until you choose, only necessary cookies are used. You can change or
            withdraw your choice at any time with <strong>Cookie preferences</strong> at the bottom of every page; withdrawing stops future
            analytics and advertising measurement and deletes our analytics identifier cookies from your browser.
          </p>
          <ul className="space-y-3 text-zayro-gray mb-6">
            <li>
              • <strong>Necessary</strong> (always on): your booking in progress, secure checkout with Stripe, Manage Booking links, studio staff
              sign-in, security and spam protection, and remembering your cookie choice (12 months).
            </li>
            <li>
              • <strong>Analytics</strong>: our own first-party analytics (cookies <code>zayro_vid</code>, a random visitor ID kept up to 13 months,
              and <code>zayro_sid</code>, a 30-minute visit ID) and Google Analytics 4, loaded through Google Tag Manager. Google receives page and
              booking-step events from your browser and, for confirmed bookings, from our server (Measurement Protocol).
            </li>
            <li>
              • <strong>Advertising</strong>: Google Ads, Meta (Facebook and Instagram) Pixel and Conversions API, Reddit Pixel and Conversions API,
              Pinterest Tag and Conversions API, and TikTok Pixel and Events API. These tell each platform when a visit from its ad led to a booking,
              a studio tour or a contact request, so we can measure and improve our ads. Your browser sends events to the platforms, and our server
              may send the same confirmed conversion (with an event ID, the booking value in USD, the service booked and, if you arrived from that
              platform&apos;s ad, its click identifier). The platforms may use this under their own privacy policies, including for ad measurement and
              targeting.
            </li>
          </ul>
          <p className="text-zayro-gray leading-relaxed mb-6">
            We do not send your name, email address, phone number, booking notes, guest details or payment card data to analytics or advertising
            platforms. Enhanced matching features that use hashed contact details are switched off. Because advertising measurement shares
            information with these platforms, we do not claim that no data is ever shared; if you prefer that it isn&apos;t, choose
            &quot;Reject non-essential&quot; or turn off Advertising. You can also use the opt-out tools of Google, Meta, Reddit, Pinterest and TikTok in
            your account settings with each of them.
          </p>

          <h2 className="text-2xl font-bold mb-4">How long we keep it</h2>
          <ul className="space-y-2 text-zayro-gray mb-6">
            <li>• Detailed analytics events: 13 months. Visit summaries used for reports: up to 25 months.</li>
            <li>• Failed delivery logs to analytics/advertising platforms: 90 days.</li>
            <li>• Records of your cookie choices: up to 25 months, as proof of consent.</li>
            <li>• Bookings, payments, refunds and the record of which campaign led to a paid booking: as long as needed for our financial and tax records.</li>
          </ul>

          <h2 className="text-2xl font-bold mb-4">Your rights</h2>
          <p className="text-zayro-gray leading-relaxed mb-6">
            Depending on where you live, you may have the right to access, correct or delete your personal data, to object to or limit certain
            uses, and to opt out of the sharing of personal data for targeted advertising. To make a request, email us at hello@zayro.studio. You
            can opt out of advertising measurement on this Site at any time with Cookie preferences.
          </p>

          <h2 className="text-2xl font-bold mb-4">Service providers</h2>
          <p className="text-zayro-gray leading-relaxed mb-6">
            We use Stripe (payments), our email delivery provider, Google Workspace (calendar and records), our hosting and database providers, and,
            only with your permission, the analytics and advertising platforms listed above.
          </p>

          <h2 className="text-2xl font-bold mb-4">Security of Data</h2>
          <p className="text-zayro-gray leading-relaxed mb-6">
            The security of your data is important to us but remember that no method of transmission over
            the Internet or method of electronic storage is 100% secure.
          </p>

          <h2 className="text-2xl font-bold mb-4">Contact Us</h2>
          <p className="text-zayro-gray leading-relaxed">
            If you have any questions about this Privacy Policy, please contact us at
            hello@zayro.studio
          </p>
        </div>
      </section>
    </div>
  );
}
