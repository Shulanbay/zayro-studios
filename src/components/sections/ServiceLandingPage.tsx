import Image from 'next/image';
import Link from 'next/link';
import JsonLd from '@/components/seo/JsonLd';
import { BUSINESS_ADDRESS, BUSINESS_NAME } from '@/lib/constants';
import { SITE_URL } from '@/lib/seo';

interface ServiceLandingPageProps {
  path: string;
  eyebrow: string;
  title: string;
  intro: string;
  image: string;
  imageAlt: string;
  serviceName: string;
  serviceDescription: string;
  primaryHref: string;
  primaryLabel: string;
  highlights: readonly { title: string; description: string }[];
  idealFor: readonly string[];
  process: readonly { title: string; description: string }[];
  relatedTitle: string;
  relatedCopy: string;
  relatedHref: string;
}

export default function ServiceLandingPage(props: ServiceLandingPageProps) {
  const serviceJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${SITE_URL}${props.path}#service`,
    name: props.serviceName,
    description: props.serviceDescription,
    serviceType: props.serviceName,
    provider: { '@type': 'LocalBusiness', '@id': `${SITE_URL}/#business`, name: BUSINESS_NAME },
    areaServed: [
      { '@type': 'City', name: 'New York City' },
      { '@type': 'AdministrativeArea', name: 'Manhattan' },
    ],
    availableChannel: {
      '@type': 'ServiceChannel',
      serviceUrl: `${SITE_URL}/booking`,
      serviceLocation: {
        '@type': 'Place',
        name: BUSINESS_NAME,
        address: BUSINESS_ADDRESS,
      },
    },
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: props.serviceName, item: `${SITE_URL}${props.path}` },
    ],
  };

  return (
    <>
      <JsonLd data={serviceJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />

      <section className="section-padding surface-soft">
        <div className="container max-w-6xl grid grid-cols-1 lg:grid-cols-[1fr_1.05fr] gap-10 lg:gap-16 items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-zayro-primary mb-4">{props.eyebrow}</p>
            <h1 className="text-[clamp(2.6rem,11vw,4.5rem)] md:text-7xl font-black leading-none text-zayro-dark mb-6">
              {props.title}
            </h1>
            <p className="text-lg md:text-xl text-zayro-gray leading-relaxed mb-8">{props.intro}</p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link href={props.primaryHref} className="button button-primary">
                {props.primaryLabel}
              </Link>
              <Link href="/pricing" className="button button-secondary">
                View Pricing
              </Link>
            </div>
            <p className="text-sm text-zayro-gray mt-6">{BUSINESS_ADDRESS}</p>
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded-xl-plus border border-zayro-border shadow-lift">
            <Image src={props.image} alt={props.imageAlt} fill priority sizes="(min-width: 1024px) 52vw, 100vw" className="object-cover" />
          </div>
        </div>
      </section>

      <section className="section-padding bg-white" aria-labelledby="service-highlights">
        <div className="container max-w-6xl">
          <div className="max-w-3xl mb-12">
            <h2 id="service-highlights" className="text-4xl md:text-5xl font-black text-zayro-dark mb-4">
              Record in Midtown Manhattan
            </h2>
            <p className="text-lg text-zayro-gray leading-relaxed">{props.serviceDescription}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {props.highlights.map((item) => (
              <div className="card h-full" key={item.title}>
                <h3 className="text-xl font-black text-zayro-dark mb-3">{item.title}</h3>
                <p className="text-zayro-gray">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-padding surface-soft">
        <div className="container max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div>
            <h2 className="text-4xl md:text-5xl font-black text-zayro-dark mb-6">Ideal for</h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {props.idealFor.map((item) => (
                <li key={item} className="card !p-4 flex gap-3 text-zayro-gray">
                  <span className="text-zayro-primary font-bold" aria-hidden="true">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-4xl md:text-5xl font-black text-zayro-dark mb-6">How it works</h2>
            <ol className="space-y-4">
              {props.process.map((step, index) => (
                <li key={step.title} className="card flex gap-4">
                  <span className="text-zayro-primary font-black tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                  <span>
                    <strong className="block text-zayro-dark mb-1">{step.title}</strong>
                    <span className="text-zayro-gray">{step.description}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="section-padding surface-dark text-center">
        <div className="container max-w-3xl">
          <h2 className="text-4xl md:text-5xl font-black text-white mb-5">Ready to create?</h2>
          <p className="text-lg text-gray-300 mb-8">See live availability and reserve your recording time online.</p>
          <div className="flex flex-col sm:flex-row justify-center gap-4 mb-8">
            <Link href={props.primaryHref} className="button button-primary">{props.primaryLabel}</Link>
            <Link href="/booking?category=tour" className="button button-secondary">Book a Free Tour</Link>
          </div>
          <p className="text-sm text-gray-400">
            Also explore{' '}
            <Link href={props.relatedHref} className="text-zayro-sky hover:text-white underline underline-offset-4">
              {props.relatedTitle}
            </Link>{' '}
            — {props.relatedCopy}
          </p>
        </div>
      </section>
    </>
  );
}
