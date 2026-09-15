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
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ZAYRO Studios | Podcast & Video Studio NYC',
    description: 'Professional podcast and video recording studio in Midtown Manhattan',
    images: ['/og-image.jpg'],
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="canonical" href="https://zayro.studio" />
      </head>
      <body className="bg-zayro-bg text-zayro-dark">
        <Header />
        <main className="min-h-screen">
          {children}
        </main>
        <Footer />

        {/* Analytics Scripts */}
        {process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID && (
          <script
            async
            src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID}`}
          />
        )}
      </body>
    </html>
  );
}
