import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | ZAYRO Studios',
  description: 'Privacy policy for ZAYRO Studios.',
};

export default function PrivacyPage() {
  return (
    <main>
      <section className="py-16 md:py-24 bg-zayro-bg">
        <div className="container">
          <h1 className="text-5xl md:text-6xl font-bold mb-4">
            Privacy Policy
          </h1>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-white">
        <div className="container max-w-3xl prose prose-sm">
          <p className="text-zayro-gray leading-relaxed mb-6">
            Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>

          <h2 className="text-2xl font-bold mb-4">Introduction</h2>
          <p className="text-zayro-gray leading-relaxed mb-6">
            ZAYRO Studios ("we" or "us" or "our") operates the zayro.studio website (the "Site").
            This page informs you of our policies regarding the collection, use, and disclosure of personal
            data when you use our Site and the choices you have associated with that data.
          </p>

          <h2 className="text-2xl font-bold mb-4">Information Collection and Use</h2>
          <p className="text-zayro-gray leading-relaxed mb-6">
            We collect several different types of information for various purposes to provide and improve
            our Site to you.
          </p>

          <h3 className="text-xl font-semibold mb-3">Types of Data Collected</h3>
          <ul className="space-y-2 text-zayro-gray mb-6">
            <li>• Personal data: name, email address, phone number, booking information</li>
            <li>• Usage data: pages visited, time spent, referral source</li>
            <li>• Device information: browser type, IP address, operating system</li>
          </ul>

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
    </main>
  );
}
