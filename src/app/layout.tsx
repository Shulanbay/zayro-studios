import type { Metadata } from 'next';
import './globals.css';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: 'ZAYRO Studios | Premium Podcast & Video Studio in NYC',
  description:
    'Professional podcast and video recording studio in Midtown Manhattan. Book your studio session today.',
  metadataBase: new URL('https://zayro.studio'),
  openGraph: {
    title: 'ZAYRO Studios | Podcast & Video Studio NYC',
    description: 'Premium podcast and video recording studio in Midtown Manhattan',
    url: 'https://zayro.studio',
    siteName: 'ZAYRO Studios',
    type: 'website',
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
  alternates: {
    canonical: 'https://zayro.studio',
  },
};

const localBusinessJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'ZAYRO Studios',
  url: 'https://zayro.studio',
  email: 'hello@zayro.studio',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '40 W 37th St, Suite 603',
    addressLocality: 'New York',
    addressRegion: 'NY',
    postalCode: '10018',
    addressCountry: 'US',
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
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
        />
      </head>
      <body className="bg-zayro-bg text-zayro-dark">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <Header />
        <main id="main-content" className="min-h-screen">
          {children}
        </main>
        <Footer />

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
