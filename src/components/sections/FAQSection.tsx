'use client';

import { useState } from 'react';

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = [
    {
      question: 'What time can I book the studio?',
      answer:
        'We are open Monday-Friday from 9:00 AM to 6:00 PM, and Saturday from 10:00 AM to 4:00 PM. Sunday is closed. You can book any available time slot during these hours.',
    },
    {
      question: 'How much in advance do I need to book?',
      answer:
        'You can book the studio as soon as today (subject to availability), or up to 90 days in advance. We recommend booking at least 1 hour in advance to ensure your preferred time is available.',
    },
    {
      question: 'Do you offer editing services?',
      answer:
        'Yes! All studio bookings include professional editing and delivery. We provide color grading, audio mixing, and final export in your choice of formats.',
    },
    {
      question: 'Can you handle live streaming?',
      answer:
        'Absolutely. We have full live streaming setup available, with equipment to stream to multiple platforms simultaneously. Let us know your streaming requirements during booking.',
    },
    {
      question: 'What is your cancellation policy?',
      answer:
        'You can cancel or reschedule up to 24 hours before your booking for a full refund. Cancellations within 24 hours are subject to a 50% fee. No-shows forfeit the full booking amount.',
    },
    {
      question: 'Do you provide parking?',
      answer:
        'Yes, we have parking available at our location in Midtown Manhattan. We can also provide directions to nearby parking garages if needed.',
    },
  ];

  return (
    <section className="section-padding bg-zayro-bg">
      <div className="container max-w-4xl">
        <h2 className="text-5xl md:text-7xl font-black mb-4 text-zayro-dark">
          QUESTIONS?
        </h2>
        <p className="text-xl text-zayro-gray font-light mb-16">
          Everything you need to know about booking and using ZAYRO Studios.
        </p>

        <div className="space-y-0">
          {faqs.map((faq, idx) => (
            <div
              key={idx}
              className="border-b border-zayro-gray py-6 cursor-pointer group"
              onClick={() => setOpenIndex(openIndex === idx ? null : idx)}
            >
              <div className="flex items-start justify-between gap-6">
                <h3 className="text-lg md:text-xl font-semibold text-zayro-dark flex-1 group-hover:text-zayro-primary transition-colors">
                  {faq.question}
                </h3>
                <span className={`text-2xl text-zayro-primary flex-shrink-0 transition-transform ${openIndex === idx ? 'rotate-180' : ''}`}>
                  ▼
                </span>
              </div>

              {openIndex === idx && (
                <p className="mt-6 text-zayro-gray leading-relaxed font-light">
                  {faq.answer}
                </p>
              )}
            </div>
          ))}
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
