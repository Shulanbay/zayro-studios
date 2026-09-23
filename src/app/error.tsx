'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Unhandled application error:', error);
  }, [error]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center surface-soft">
      <div className="container max-w-xl text-center py-24">
        <h1 className="text-3xl md:text-4xl font-black mb-4 text-zayro-dark">Something went wrong</h1>
        <p className="text-zayro-gray mb-10">
          We hit an unexpected error. Please try again, or contact us if it keeps happening.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button onClick={reset} className="button button-primary">
            Try Again
          </button>
          <a href="mailto:hello@zayro.studio" className="button button-secondary">
            Contact Us
          </a>
        </div>
      </div>
    </div>
  );
}
