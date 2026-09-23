import Link from 'next/link';

export interface PriceCardProps {
  title: string;
  description?: string | null;
  badge?: string | null;
  featured?: boolean;
  price: string;
  priceSuffix?: string;
  /** Crossed-out regular price, e.g. for packages. */
  regularPrice?: string | null;
  /** e.g. "Save $40 · 10% off" */
  savings?: string | null;
  meta?: string[];
  features?: string[] | null;
  cta: { href: string; label: string; ariaLabel?: string };
}

/**
 * One pricing card. Stretches to the height of its grid row (h-full + flex)
 * so cards in a row line up, with the CTA pinned to the bottom.
 */
export default function PriceCard({
  title,
  description,
  badge,
  featured,
  price,
  priceSuffix,
  regularPrice,
  savings,
  meta,
  features,
  cta,
}: PriceCardProps) {
  return (
    <article
      className={`card h-full flex flex-col min-w-0 relative ${featured ? 'card-selected' : ''}`}
      aria-label={badge ? `${title} (${badge})` : title}
    >
      {badge && (
        <span className="self-start mb-4 inline-flex items-center rounded-full bg-gradient-cta px-3 py-1 text-sm font-semibold text-white">
          {badge}
        </span>
      )}
      <h3 className="text-2xl font-black text-zayro-dark mb-2 break-words">{title}</h3>
      {description && <p className="text-base text-zayro-gray mb-6">{description}</p>}

      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-4xl font-black text-zayro-dark">{price}</span>
        {priceSuffix && <span className="text-base text-zayro-gray">{priceSuffix}</span>}
      </div>
      {regularPrice && (
        <p className="text-base text-zayro-gray">
          Regular price: <span className="line-through">{regularPrice}</span>
        </p>
      )}
      {savings && <p className="text-base font-semibold text-green-700 mt-1">{savings}</p>}
      {meta && meta.length > 0 && (
        <p className="text-sm text-zayro-gray mt-2">{meta.join(' · ')}</p>
      )}

      {features && features.length > 0 && (
        <ul className="space-y-2 mt-6 mb-8">
          {features.map((feature, i) => (
            <li key={i} className="text-base text-zayro-gray flex gap-2 min-w-0">
              <span className="text-zayro-primary flex-shrink-0" aria-hidden="true">
                ✓
              </span>
              <span className="min-w-0 break-words">{feature}</span>
            </li>
          ))}
        </ul>
      )}

      <Link
        href={cta.href}
        aria-label={cta.ariaLabel}
        className="button button-primary w-full mt-auto text-center"
      >
        {cta.label}
      </Link>
    </article>
  );
}
