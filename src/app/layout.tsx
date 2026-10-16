import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import SiteChrome from '@/components/layout/SiteChrome';
import JsonLd from '@/components/seo/JsonLd';
import { BUSINESS_EMAIL, BUSINESS_NAME, BUSINESS_PHONE } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'ZAYRO Studios | Premium Podcast & Video Studio in NYC',
  description:
    'Professional podcast and video recording studio in Midtown Manhattan. Book your studio session today.',
  metadataBase: new URL('https://zayro.studio'),
  openGraph: {
    title: 'ZAYRO Studios | Podcast & Video Studio NYC',
    description: 'Premium podcast and video recording studio in Midtown Manhattan',
    url: '/',
    siteName: 'ZAYRO Studios',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ZAYRO Studios | Podcast & Video Studio NYC',
    description: 'Professional podcast and video recording studio in Midtown Manhattan',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

const localBusinessJsonLd = {
  '@context': 'https://schema.org',
  '@type': ['LocalBusiness', 'ProfessionalService'],
  '@id': 'https://zayro.studio/#business',
  name: BUSINESS_NAME,
  url: 'https://zayro.studio',
  description: 'Podcast, video recording, filming and photography studio in Midtown Manhattan, New York City.',
  email: BUSINESS_EMAIL,
  ...(BUSINESS_PHONE ? { telephone: BUSINESS_PHONE } : {}),
  priceRange: '$$',
  image: [
    'https://zayro.studio/setups/cream-lounge.webp',
    'https://zayro.studio/setups/sofa-lounge.webp',
    'https://zayro.studio/setups/library-table.webp',
    'https://zayro.studio/setups/garden-lounge.webp',
  ],
  address: {
    '@type': 'PostalAddress',
    streetAddress: '40 W 37th St, Suite 603',
    addressLocality: 'New York',
    addressRegion: 'NY',
    postalCode: '10018',
    addressCountry: 'US',
  },
  areaServed: [
    { '@type': 'City', name: 'New York City' },
    { '@type': 'AdministrativeArea', name: 'Manhattan' },
  ],
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    name: 'Studio Services',
    itemListElement: [
      { '@type': 'OfferCatalog', name: 'Podcast Recording' },
      { '@type': 'OfferCatalog', name: 'Video Recording and Filming' },
      { '@type': 'OfferCatalog', name: 'Studio Photography' },
      { '@type': 'OfferCatalog', name: 'Live Streaming' },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const gaId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <JsonLd data={localBusinessJsonLd} />
      </head>
      <body className="bg-zayro-bg text-zayro-dark">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <SiteChrome>
          <Header />
        </SiteChrome>
        <main id="main-content" className="min-h-screen">
          {children}
        </main>
        <SiteChrome>
          <Footer />
        </SiteChrome>

        {gaId && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} />
            <script
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${gaId}');`,
              }}
            />
          </>
        )}
      </body>
    </html>
  );
}
