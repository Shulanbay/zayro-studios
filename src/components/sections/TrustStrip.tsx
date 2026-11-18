import type { ReactNode } from 'react';

/**
 * Confirmed studio facts only. These describe the studio, not every
 * package: package contents are on the pricing cards.
 *
 * Shown as a slow, endless ticker so the list never breaks into an uneven
 * second row. Visitors who prefer reduced motion get a static, wrapped list.
 */

const svg = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    {path}
  </svg>
);

const ICONS: Record<string, ReactNode> = {
  pin: svg(
    <>
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>,
  ),
  camera: svg(
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="m15.5 10.5 6-3.5v10l-6-3.5" />
    </>,
  ),
  mic: svg(
    <>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>,
  ),
  light: svg(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>,
  ),
  headset: svg(
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="13.5" width="4" height="6" rx="1.5" />
      <rect x="17" y="13.5" width="4" height="6" rx="1.5" />
    </>,
  ),
  clock: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  calendar: svg(
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>,
  ),
};

function Item({ icon, label }: { icon: string; label: string }) {
  return (
    <li className="flex shrink-0 items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#eaf2ff] text-zayro-primary ring-1 ring-[#d7e5ff]" aria-hidden="true">
        {ICONS[icon]}
      </span>
      <span className="whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] text-zayro-dark">{label}</span>
    </li>
  );
}

export default function TrustStrip({ openSevenDays = false }: { openSevenDays?: boolean }) {
  const items = [
    { icon: 'pin', label: 'Midtown Manhattan' },
    { icon: 'camera', label: '4K Multi-Camera' },
    { icon: 'mic', label: 'Broadcast Audio' },
    { icon: 'light', label: 'Professional Lighting' },
    { icon: 'headset', label: 'On-Site Technical Support' },
    { icon: 'clock', label: 'Raw Files Within 24 Hours' },
    ...(openSevenDays ? [{ icon: 'calendar', label: 'Open 7 Days' }] : []),
  ];

  return (
    <section aria-label="Studio highlights" className="trust-strip border-y border-zayro-border bg-white py-6 md:py-7">
      <div className="trust-strip-viewport">
        <div className="trust-strip-track">
          <ul className="trust-strip-list">
            {items.map((item) => (
              <Item key={item.label} {...item} />
            ))}
          </ul>
          {/* Second copy makes the loop seamless; screen readers skip it. */}
          <ul className="trust-strip-list trust-strip-copy" aria-hidden="true">
            {items.map((item) => (
              <Item key={item.label} {...item} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
