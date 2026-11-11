/**
 * Confirmed studio facts only. These describe the studio, not every
 * package: package contents are on the pricing cards.
 */
export default function TrustStrip({ openSevenDays = false }: { openSevenDays?: boolean }) {
  const items = [
    'Midtown Manhattan',
    '4K Multi-Camera',
    'Broadcast Audio',
    'Professional Lighting',
    'On-Site Technical Support',
    'Raw Files Within 24 Hours',
    ...(openSevenDays ? ['Open 7 Days'] : []),
  ];
  return (
    <section aria-label="Studio highlights" className="border-y border-zayro-border bg-white">
      <ul className="container max-w-6xl flex flex-wrap justify-center gap-x-6 gap-y-3 py-5 text-sm font-semibold text-zayro-dark">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-gradient-cta" aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
