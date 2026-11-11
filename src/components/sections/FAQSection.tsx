'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { BookingFacts } from '@/lib/bookingFacts';
import { buildFaqs } from '@/lib/faq';

/** Homepage shows the questions that decide a booking; /faq shows them all. */
const HOME_IDS = ['studio-time', 'raw-files', 'editing', 'cancel', 'reschedule', 'add-time', 'setup-change', 'hours'];

export default function FAQSection({ showHeading = true, facts, compact = false }: { showHeading?: boolean; facts: BookingFacts; compact?: boolean }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const all = buildFaqs(facts);
  const faqs = compact ? HOME_IDS.map((id) => all.find((f) => f.id === id)).filter((f): f is (typeof all)[number] => !!f) : all;

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
              <div key={faq.id} id={`faq-${faq.id}`} className="card overflow-hidden scroll-mt-24">
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
            {compact && (
              <>
                <Link href="/faq" className="text-zayro-primary font-semibold hover:underline">
                  See all questions
                </Link>
                {' · '}
              </>
            )}
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
