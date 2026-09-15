import type { Metadata } from 'next';
import BookingFlow from '@/components/booking/BookingFlow';

export const metadata: Metadata = {
  title: 'Book Studio | ZAYRO Studios',
  description: 'Book your professional podcast or video studio session at ZAYRO Studios in Manhattan.',
  robots: {
    index: false,
  },
};

export default function BookingPage() {
  return (
    <main className="min-h-screen bg-zayro-bg">
      <BookingFlow />
    </main>
  );
}
