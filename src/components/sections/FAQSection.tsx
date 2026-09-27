'use client';

import { useState } from 'react';
import type { BookingFacts } from '@/lib/bookingFacts';

function hours(n: number) {
  return `${n} hour${n === 1 ? '' : 's'}`;
}

export default function FAQSection({ showHeading = true, facts }: { showHeading?: boolean; facts: BookingFacts }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = [
    {
      question: 'What time can I book the studio?',
      answer: facts.hoursSentence
        ? `Sessions can be booked from ${facts.hoursSentence}. The booking calendar always shows the live availability for your chosen date.`
        : 'Opening hours vary by day. The booking calendar always shows the live availability for your chosen date (New York time).',
    },
    {
      question: 'How far in advance can I book?',
      answer: `You can book up to ${facts.horizonDays} days ahead. Same-day sessions are possible when a time is free — online booking closes ${hours(
        facts.minNoticeHours
      )} before the start time.`,
    },
    {
      question: 'Do you offer editing services?',
      answer:
        'Yes. Professional editing is included in the Full Podcast Package. Single Podcaster and Podcast Pro are recording-only sessions: you get the raw files, and editing can be added separately — just ask us for a quote.',
    },
    {
      question: 'Can I live stream from the studio?',
      answer:
        'Live streaming can be arranged on request. Email us what and where you want to stream before you book, and we will confirm what is possible for your session.',
    },
    {
      question: 'What is your cancellation policy?',
      answer:
        'You can cancel or reschedule up to 24 hours before your booking for a full refund. Cancellations within 24 hours are subject to a 50% fee. No-shows forfeit the full booking amount.',
    },
    {
      question: 'How do I get to the studio?',
      answer:
        'We are at 40 W 37th St, Suite 603, New York, NY 10018 — a short walk from Herald Square and Bryant Park. If you plan to drive, there are public parking garages in the area; email us and we will help with directions.',
    },
  ];

  return (
    <section className="section-padding bg-zayro-bg">
      <div className="container max-w-4xl">
        {showHeading && (
          <>
            <h2 className="text-[clamp(2.25rem,10.5vw,3rem)] md:text-7xl font-black mb-4 text-zayro-dark">
              QUESTIONS?
            </h2>
            <p className="text-xl text-zayro-gray font-light mb-16">
              Everything you need to know about booking and using ZAYRO Studios.
            </p>
          </>
        )}

        <div className="space-y-3">
          {faqs.map((faq, idx) => {
            const panelId = `faq-panel-${idx}`;
            const buttonId = `faq-button-${idx}`;
            const isOpen = openIndex === idx;
            return (
              <div key={idx} className="card overflow-hidden">
                <h3>
                  <button
                    id={buttonId}
                    type="button"
                    className="w-full flex items-start justify-between gap-6 p-0 rounded-md text-left whitespace-normal"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpenIndex(isOpen ? null : idx)}
                  >
                    <span className="text-lg font-semibold text-zayro-dark">{faq.question}</span>
                    <svg
                      className={`mt-1 h-5 w-5 flex-shrink-0 text-zayro-primary transition-transform duration-300 motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`}
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 7.5l5 5 5-5" />
                    </svg>
                  </button>
                </h3>

                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  aria-hidden={!isOpen}
                  className={`grid transition-all duration-300 ease-out motion-reduce:transition-none ${
                    isOpen ? 'grid-rows-[1fr] mt-4 visible' : 'grid-rows-[0fr] invisible'
                  }`}
                >
                  <p className="overflow-hidden text-zayro-gray leading-relaxed font-light">{faq.answer}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-12 text-center">
          <p className="text-zayro-gray font-light">
            More questions?{' '}
            <a href="mailto:hello@zayro.studio" className="text-zayro-primary font-semibold hover:underline">
              Email us
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
