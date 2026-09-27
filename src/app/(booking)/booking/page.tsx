import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import BookingFlow from '@/components/booking/BookingFlow';

export const metadata: Metadata = pageMetadata({
  title: 'Book a Session | ZAYRO Studios',
  description:
    'Book a podcast session, photoshoot or free studio tour at ZAYRO Studios in Midtown Manhattan. Live availability, secure online payment.',
  path: '/booking',
});

export default function BookingPage() {
  return (
    <div className="min-h-screen bg-zayro-bg">
      <BookingFlow />
    </div>
  );
}
