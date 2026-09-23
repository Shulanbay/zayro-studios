import Link from 'next/link';
import type { Metadata } from 'next';
import PriceCard from '@/components/pricing/PriceCard';
import { getActiveServices, getServicesById } from '@/lib/catalogData';
import {
  PACKAGE_TYPES,
  PACKAGE_TYPE_LABELS,
  bookingHref,
  computePackagePricing,
  contactHref,
  formatDuration,
  formatPrice,
  packageRequestTopic,
  servicesInCategory,
} from '@/lib/catalog';
import type { Service } from '@/lib/db/schema';

export const metadata: Metadata = {
  title: 'Pricing | ZAYRO Studios',
  description:
    'Podcast sessions, studio photography and prepaid monthly podcast packages at ZAYRO Studios in Midtown Manhattan.',
};

// Prices come straight from the database so admin changes show up
// immediately and the page can never disagree with checkout.
export const dynamic = 'force-dynamic';

const SECTIONS = [
  { id: 'podcast', label: 'Podcast Sessions' },
  { id: 'photography', label: 'Photography' },
  { id: 'monthly', label: 'Monthly Packages' },
];

const ON_LOCATION_TOPIC = 'On-location photography';

function SectionHeading({ id, title, intro }: { id: string; title: string; intro: string }) {
  return (
    <div className="mb-10 max-w-2xl">
      <h2 id={`${id}-heading`} className="text-4xl md:text-5xl font-black text-zayro-dark mb-3">
        {title}
      </h2>
      <p className="text-lg text-zayro-gray">{intro}</p>
    </div>
  );
}

function singleSessionCard(service: Service, ctaLabel: string) {
  return (
    <PriceCard
      key={service.id}
      title={service.name}
      description={service.description}
      badge={service.badge}
      featured={service.is_featured}
      price={formatPrice(service.base_price)}
      priceSuffix={`/ ${formatDuration(service.duration_minutes)}`}
      features={service.features}
      cta={{ href: bookingHref(service), label: ctaLabel, ariaLabel: `${ctaLabel}: ${service.name}` }}
    />
  );
}

export default async function PricingPage() {
  let active: Service[] = [];
  let loadFailed = false;
  try {
    active = await getActiveServices();
  } catch (error) {
    console.error('Pricing page: failed to load services', (error as Error)?.message);
    loadFailed = true;
  }

  const podcast = [
    ...servicesInCategory(active, 'podcast'),
    ...servicesInCategory(active, 'video'),
    ...servicesInCategory(active, 'livestream'),
    ...servicesInCategory(active, 'editing'),
  ];
  const photography = servicesInCategory(active, 'photography');
  const tour = servicesInCategory(active, 'tour')[0] ?? null;
  const packages = servicesInCategory(active, 'package');
  const baseServices = await getServicesById(
    packages.map((p) => p.package_base_service_id).filter((id): id is number => id !== null)
  ).catch(() => new Map<number, Service>());

  const packageGroups = PACKAGE_TYPES.map((type) => {
    const items = packages.filter((p) => p.package_type === type);
    const base = items.map((p) => baseServices.get(p.package_base_service_id ?? -1)).find(Boolean) ?? null;
    return { type, items, base };
  }).filter((g) => g.items.length > 0);

  const validityValues = Array.from(new Set(packages.map((p) => computePackagePricing(p, null).validityDays)));

  return (
    <main>
      <section className="py-16 md:py-24 bg-zayro-bg">
        <div className="container">
          <h1 className="text-5xl md:text-6xl font-black mb-4 text-zayro-dark">Pricing</h1>
          <p className="text-xl text-zayro-gray max-w-2xl">
            Podcast sessions, studio photography and prepaid monthly podcast packages. Taxes, if applicable, are
            calculated at checkout.
          </p>

          <nav aria-label="Pricing sections" className="mt-10">
            <ul className="flex flex-wrap gap-3">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="button button-secondary text-base py-2.5 px-5">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>

      {loadFailed && (
        <section className="container py-10">
          <p className="form-error-banner">
            Pricing is temporarily unavailable. Please try again shortly or{' '}
            <Link href="/contact" className="underline font-semibold">
              contact us
            </Link>
            .
          </p>
        </section>
      )}

      {/* Podcast Sessions */}
      <section id="podcast" aria-labelledby="podcast-heading" className="section-padding bg-white scroll-mt-24">
        <div className="container max-w-6xl">
          <SectionHeading
            id="podcast"
            title="Podcast Sessions"
            intro="Single recording sessions, booked by the hour. Pick a time that works and pay securely online."
          />
          {podcast.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
              {podcast.map((s) => singleSessionCard(s, 'Book Session'))}
            </div>
          ) : (
            !loadFailed && <p className="text-lg text-zayro-gray">No podcast sessions are available right now.</p>
          )}

          {tour && (
            <div className="card mt-10 flex flex-col md:flex-row md:items-center gap-6 min-w-0">
              <div className="flex-1 min-w-0">
                <h3 className="text-2xl font-black text-zayro-dark mb-1">{tour.name}</h3>
                <p className="text-base text-zayro-gray">
                  {tour.description} {formatDuration(tour.duration_minutes)} ·{' '}
                  {formatPrice(tour.base_price) === 'Free' ? 'no payment required' : formatPrice(tour.base_price)}.
                </p>
              </div>
              <Link
                href={bookingHref(tour)}
                className="button button-primary md:w-auto w-full"
                aria-label={`Book: ${tour.name}`}
              >
                Book a Tour
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Photography */}
      <section id="photography" aria-labelledby="photography-heading" className="section-padding surface-soft scroll-mt-24">
        <div className="container max-w-6xl">
          <SectionHeading
            id="photography"
            title="Photography"
            intro="Studio photography with professional lighting — headshots, portraits and brand content."
          />
          {photography.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
              {photography.map((s) => singleSessionCard(s, 'Book Photoshoot'))}
            </div>
          ) : (
            !loadFailed && <p className="text-lg text-zayro-gray">Photography sessions are not available right now.</p>
          )}

          <div className="card mt-10 flex flex-col md:flex-row md:items-center gap-6 min-w-0">
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-black text-zayro-dark mb-1">On-location upgrade available from $150.</h3>
              <p className="text-base text-zayro-gray">
                Final price depends on location, travel and production requirements. Tell us about your shoot and
                we&apos;ll send a quote.
              </p>
            </div>
            <Link href={contactHref(ON_LOCATION_TOPIC)} className="button button-secondary md:w-auto w-full">
              Request On-location Shoot
            </Link>
          </div>
        </div>
      </section>

      {/* Monthly Packages */}
      <section id="monthly" aria-labelledby="monthly-heading" className="section-padding bg-white scroll-mt-24">
        <div className="container max-w-6xl">
          <SectionHeading
            id="monthly"
            title="Monthly Podcast Packages"
            intro="Prepaid packages for one month of regular recording. A one-time payment — not an automatic subscription."
          />

          {packageGroups.length === 0 && !loadFailed && (
            <p className="text-lg text-zayro-gray">Monthly packages are not available right now.</p>
          )}

          {packageGroups.map((group) => (
            <div key={group.type} className="mb-14 last:mb-0">
              <h3 className="text-2xl md:text-3xl font-black text-zayro-dark mb-2">{PACKAGE_TYPE_LABELS[group.type]}</h3>
              {group.base && (
                <p className="text-base text-zayro-gray mb-8">
                  Priced from {group.base.name} at {formatPrice(group.base.base_price)} per session.
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
                {group.items.map((pkg) => {
                  const base = baseServices.get(pkg.package_base_service_id ?? -1) ?? null;
                  const p = computePackagePricing(pkg, base);
                  const hasDiscount = p.regularPrice !== null && p.savings !== null && p.savings > 0;
                  return (
                    <PriceCard
                      key={pkg.id}
                      title={pkg.name}
                      description={pkg.description}
                      badge={pkg.badge}
                      featured={pkg.is_featured}
                      price={formatPrice(p.packagePrice)}
                      priceSuffix="package price"
                      regularPrice={hasDiscount ? formatPrice(p.regularPrice!) : null}
                      savings={hasDiscount ? `Save ${formatPrice(p.savings!)} · ${p.discountPercent}% off` : null}
                      meta={[
                        `${p.sessions} session${p.sessions === 1 ? '' : 's'}`,
                        `${formatPrice(p.perSession)} per session`,
                        `valid ${p.validityDays} days`,
                      ]}
                      features={pkg.features}
                      cta={{
                        href: contactHref(packageRequestTopic(pkg)),
                        label: 'Request Monthly Package',
                        ariaLabel: `Request Monthly Package: ${pkg.name}`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {packageGroups.length > 0 && (
            <div className="card mt-14 bg-zayro-bg">
              <h3 className="text-xl font-black text-zayro-dark mb-4">How monthly packages work</h3>
              <ul className="space-y-3 text-base text-zayro-gray list-disc pl-5">
                <li>
                  Packages are prepaid and valid for{' '}
                  {validityValues.length === 1 ? `${validityValues[0]} days` : 'the number of days shown on each package'}{' '}
                  from the package start date you choose.
                </li>
                <li>Each session is scheduled individually, subject to studio availability.</li>
                <li>One-time payment. Packages do not renew automatically.</li>
                <li>
                  Requesting a package doesn&apos;t charge you — we&apos;ll confirm your start date and payment details
                  with you directly.
                </li>
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="section-padding surface-dark text-center">
        <div className="container">
          <h2 className="text-4xl font-bold mb-6">Ready to book?</h2>
          <p className="mb-8 max-w-xl mx-auto text-lg">
            Need something custom, like a longer shoot or a different package? Reach out and we&apos;ll put a plan
            together.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/booking" className="button button-primary">
              Book Studio Now
            </Link>
            <Link
              href="/contact"
              className="button button-secondary bg-transparent text-white border-white/30 hover:border-white hover:text-white"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
