import type { Metadata } from 'next';

// Private, per-customer page: never indexed, never in the sitemap, and no
// Referer leaves it (the link's token lives in the URL fragment anyway).
export const metadata: Metadata = {
  title: 'Manage Your Booking | ZAYRO Studios',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
