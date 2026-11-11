import type { BookingFacts } from './bookingFacts';
import { POLICY_FAQ, type PolicyItem } from './policies';

/**
 * The public FAQ: booking facts from the database plus the shared policy
 * answers from lib/policies.ts. The visible FAQ and the FAQPage JSON-LD are
 * both built from this list, so they can't disagree. Pure.
 */
export function buildFaqs(facts: BookingFacts): PolicyItem[] {
  const hours = (n: number) => `${n} hour${n === 1 ? '' : 's'}`;
  return [
    {
      id: 'hours',
      question: 'What time can I book the studio?',
      answer: facts.hoursSentence
        ? `Sessions can be booked from ${facts.hoursSentence}. The booking calendar always shows the live availability for your chosen date.`
        : 'Opening hours vary by day. The booking calendar always shows the live availability for your chosen date (New York time).',
    },
    {
      id: 'advance',
      question: 'How far in advance can I book?',
      answer: `You can book up to ${facts.horizonDays} days ahead. Same-day sessions are possible when a time is free — online booking closes ${hours(facts.minNoticeHours)} before the start time.`,
    },
    ...POLICY_FAQ,
    {
      id: 'livestream',
      question: 'Can I live stream from the studio?',
      answer:
        'Livestream Setup can be added as a paid extra when you book a podcast session. Email us what and where you want to stream before your session, and we will confirm what is possible.',
    },
    {
      id: 'directions',
      question: 'How do I get to the studio?',
      answer:
        'We are at 40 W 37th St, Suite 603, New York, NY 10018 — a short walk from Herald Square and Bryant Park. If you plan to drive, there are public parking garages in the area; email us and we will help with directions.',
    },
  ];
}

export function faqJsonLd(items: PolicyItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
  };
}
