'use client';

/** Reopens the cookie consent preferences (change or withdraw a choice). */
export default function CookiePreferencesButton({ className = '' }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event('zayro:open-cookie-preferences'))}>
      Cookie preferences
    </button>
  );
}
