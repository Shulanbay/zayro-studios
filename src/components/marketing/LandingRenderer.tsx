/**
 * Public rendering of a landing page's blocks in the site's own design.
 * All text is rendered as escaped text (no HTML from the builder); prices
 * come from the live catalog; empty or hidden blocks are skipped.
 */
import Image from 'next/image';
import Link from 'next/link';
import PriceCard from '@/components/pricing/PriceCard';
import { isEmptyBlock, type ContentBlock } from '@/lib/marketing/blocks';
import { bookingHref, contactHref, formatPrice, isBookable, priceTerms, sortServices } from '@/lib/catalog';
import type { Service } from '@/lib/db/schema';
import type { PublicSetup } from '@/lib/setupCatalog';
import LeadForm from './LeadForm';
import VideoFacade from './VideoFacade';

export interface LandingContext {
  slug: string;
  services: Service[];
  setups: PublicSetup[];
  messengers: { whatsapp: string | null; telegram: string | null };
}

function Paragraphs({ text, className = '' }: { text: string; className?: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className={`${className} whitespace-pre-line`}>
            {p}
          </p>
        ))}
    </>
  );
}

function Heading({ heading, subheading, center = false, id }: { heading?: string; subheading?: string; center?: boolean; id?: string }) {
  if (!heading && !subheading) return null;
  return (
    <div className={`mb-10 max-w-2xl ${center ? 'mx-auto text-center' : ''}`}>
      {heading && (
        <h2 id={id} className="text-3xl md:text-5xl font-black text-zayro-dark mb-3 leading-tight">
          {heading}
        </h2>
      )}
      {subheading && <p className="text-lg text-zayro-gray">{subheading}</p>}
    </div>
  );
}

function Cta({ label, href, variant = 'primary' }: { label: string; href: string; variant?: 'primary' | 'secondary' | 'light' }) {
  if (!label || !href) return null;
  const cls = variant === 'primary' ? 'button button-primary' : variant === 'light' ? 'button bg-white text-zayro-dark hover:bg-zayro-bg' : 'button button-secondary';
  const external = /^https:\/\//.test(href);
  return external ? (
    <a href={href} className={cls} rel="noopener" target="_blank" data-analytics-cta={label}>
      {label}
    </a>
  ) : (
    <Link href={href} className={cls} data-analytics-cta={label}>
      {label}
    </Link>
  );
}

function Img({ src, alt, className, sizes }: { src: string; alt: string; className?: string; sizes: string }) {
  return <Image src={src} alt={alt} fill sizes={sizes} className={className} unoptimized={/^https:\/\//.test(src)} />;
}

function Block({ block, ctx }: { block: ContentBlock; ctx: LandingContext }) {
  const sectionId = block.anchor || undefined;
  switch (block.type) {
    case 'hero': {
      const dark = block.theme === 'dark';
      return (
        <section id={sectionId} className={`relative overflow-hidden ${dark ? 'bg-zayro-dark text-white' : 'bg-[#f0f6fd] text-zayro-dark'}`} data-analytics-section="hero">
          {block.image && (
            <div className="absolute inset-0" aria-hidden={!block.imageAlt}>
              <Img src={block.image} alt={block.imageAlt} sizes="100vw" className={`object-cover ${dark ? 'opacity-40' : 'opacity-25'}`} />
              <div className={`absolute inset-0 ${dark ? 'bg-gradient-to-b from-zayro-dark/40 to-zayro-dark/90' : 'bg-gradient-to-b from-white/30 to-[#f0f6fd]'}`} />
            </div>
          )}
          <div className="container relative max-w-5xl py-20 md:py-32 text-center">
            {block.eyebrow && <span className={`chip mb-6 ${dark ? '!bg-white/10 !text-white !border-white/20' : ''}`}>{block.eyebrow}</span>}
            <h1 className="text-[clamp(2.25rem,9vw,4.5rem)] font-black leading-[1.05] tracking-tight mb-6">{block.heading}</h1>
            {block.subheading && <p className={`text-lg md:text-2xl font-light max-w-3xl mx-auto leading-relaxed mb-10 ${dark ? 'text-white/80' : 'text-zayro-gray'}`}>{block.subheading}</p>}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Cta label={block.primary.label} href={block.primary.href} variant={dark ? 'light' : 'primary'} />
              <Cta label={block.secondary.label} href={block.secondary.href} variant="secondary" />
            </div>
          </div>
        </section>
      );
    }
    case 'features':
      return (
        <section id={sectionId} className="section-padding bg-white" data-analytics-section="features">
          <div className="container max-w-6xl">
            <Heading heading={block.heading} subheading={block.subheading} center />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {block.items.map((it, i) => (
                <div key={i} className="card h-full">
                  <h3 className="text-xl font-bold text-zayro-dark mb-2">{it.title}</h3>
                  {it.body && <p className="text-zayro-gray">{it.body}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    case 'packages': {
      let cards: React.ReactNode[] = [];
      if (block.source === 'catalog') {
        const chosen = block.serviceIds.length
          ? block.serviceIds.map((id) => ctx.services.find((s) => s.id === id)).filter((s): s is Service => !!s)
          : sortServices(ctx.services.filter((s) => (block.category === 'all' ? s.category !== 'package' : s.category === block.category)));
        cards = chosen.slice(0, 6).map((service) => {
          const bookable = isBookable(service) && service.category !== 'package';
          const label = block.ctaLabel || (service.category === 'package' ? 'Buy Monthly Package' : bookable ? 'Book now' : 'Request a Quote');
          const href = service.category === 'package' ? `/packages/buy?package=${service.id}` : bookable ? bookingHref(service) : contactHref(service.name);
          const terms = priceTerms(service);
          return (
            <PriceCard
              key={service.id}
              title={service.name}
              description={service.description}
              badge={service.badge}
              featured={service.is_featured}
              price={formatPrice(service.base_price)}
              priceSuffix={service.category === 'package' ? 'package price' : terms.suffix}
              priceNote={service.category === 'package' ? null : terms.note}
              features={service.features}
              cta={{ href, label, ariaLabel: `${label}: ${service.name}` }}
              {...(service.category === 'package' ? { analyticsPackage: { id: service.id, name: service.name } } : {})}
            />
          );
        });
      } else {
        cards = block.items.map((it, i) => (
          <PriceCard key={i} title={it.name} description={it.description || null} featured={it.highlight} price={it.price || '—'} priceSuffix={it.period || undefined} features={it.features} cta={{ href: it.cta.href || '#contact', label: it.cta.label || 'Get started' }} />
        ));
      }
      if (cards.length === 0) return null;
      return (
        <section id={sectionId} className="section-padding bg-zayro-bg" data-analytics-section="pricing">
          <div className="container max-w-6xl">
            <Heading heading={block.heading} subheading={block.subheading} />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">{cards}</div>
          </div>
        </section>
      );
    }
    case 'setups': {
      const items = block.source === 'studio' ? ctx.setups.map((s) => ({ title: s.name, body: s.description ?? '', image: s.image ?? '', href: s.bookingHref })) : block.items.map((s) => ({ ...s, href: '' }));
      if (items.length === 0) return null;
      return (
        <section id={sectionId} className="section-padding bg-white" data-analytics-gallery="landing-setups">
          <div className="container max-w-6xl">
            <Heading heading={block.heading} subheading={block.subheading} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {items.map((it, i) => (
                <div key={i} className="card !p-0 overflow-hidden">
                  {it.image && (
                    <div className="relative aspect-[16/10] bg-zayro-bg">
                      <Img src={it.image} alt={it.title} sizes="(min-width: 640px) 50vw, 100vw" className="object-cover" />
                    </div>
                  )}
                  <div className="p-5">
                    <h3 className="text-xl font-bold text-zayro-dark">{it.title}</h3>
                    {it.body && <p className="text-zayro-gray mt-1">{it.body}</p>}
                    {it.href && (
                      <Link href={it.href} className="inline-block mt-3 font-semibold text-zayro-primary">
                        Book this set →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }
    case 'gallery':
      return (
        <section id={sectionId} className="section-padding bg-white" data-analytics-gallery="landing-gallery">
          <div className="container max-w-6xl">
            <Heading heading={block.heading} />
            {block.videoUrl && (
              <div className="mb-6">
                <VideoFacade url={block.videoUrl} title={block.heading || 'Video'} />
              </div>
            )}
            {block.images.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {block.images.map((img, i) => (
                  <div key={i} className="relative aspect-square rounded-2xl overflow-hidden bg-zayro-bg">
                    <Img src={img.src} alt={img.alt} sizes="(min-width: 768px) 33vw, 50vw" className="object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      );
    case 'testimonials':
      return (
        <section id={sectionId} className="section-padding bg-zayro-bg" data-analytics-section="testimonials">
          <div className="container max-w-6xl">
            <Heading heading={block.heading} center />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {block.items.map((it, i) => (
                <figure key={i} className="card h-full flex flex-col">
                  <blockquote className="text-zayro-dark text-lg leading-relaxed flex-1">“{it.quote}”</blockquote>
                  <figcaption className="mt-4 text-sm">
                    <span className="font-semibold text-zayro-dark">{it.author}</span>
                    {it.role && <span className="text-zayro-gray"> · {it.role}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      );
    case 'faq':
      return (
        <section id={sectionId} className="section-padding bg-white" data-analytics-section="faq">
          <div className="container max-w-3xl">
            <Heading heading={block.heading} center />
            <div className="grid gap-3">
              {block.items.map((it, i) => (
                <details key={i} className="card !p-0 group">
                  <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-zayro-dark flex justify-between gap-4">
                    {it.q}
                    <span aria-hidden="true" className="text-zayro-primary transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <div className="px-5 pb-5 text-zayro-gray">
                    <Paragraphs text={it.a} className="mb-2 last:mb-0" />
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>
      );
    case 'leadForm':
      return (
        <section id={sectionId || 'contact'} className="section-padding bg-zayro-bg" data-analytics-section="lead-form">
          <div className="container max-w-2xl">
            <Heading heading={block.heading || 'Get in touch'} subheading={block.subheading} center />
            <LeadForm
              slug={ctx.slug}
              askEmail={block.askEmail}
              askMessage={block.askMessage}
              submitLabel={block.submitLabel || 'Send request'}
              successMessage={block.successMessage || 'Thank you! We will contact you shortly.'}
              whatsapp={block.showMessengers ? ctx.messengers.whatsapp : null}
              telegram={block.showMessengers ? ctx.messengers.telegram : null}
            />
          </div>
        </section>
      );
    case 'cta':
      return (
        <section id={sectionId} className="section-padding bg-zayro-dark text-white" data-analytics-section="cta">
          <div className="container max-w-3xl text-center">
            <h2 className="text-3xl md:text-5xl font-black mb-4">{block.heading}</h2>
            {block.body && <p className="text-lg text-white/80 mb-8">{block.body}</p>}
            <Cta label={block.button.label} href={block.button.href} variant="light" />
          </div>
        </section>
      );
    case 'text':
      return (
        <section id={sectionId} className="section-padding bg-white">
          <div className="container max-w-3xl">
            <Heading heading={block.heading} />
            <div className="text-lg text-zayro-gray leading-relaxed">
              <Paragraphs text={block.body} className="mb-4" />
            </div>
          </div>
        </section>
      );
  }
}

export default function LandingRenderer({ blocks, ctx }: { blocks: ContentBlock[]; ctx: LandingContext }) {
  return (
    <div data-landing-page={ctx.slug}>
      {blocks
        .filter((b) => !b.hidden && !isEmptyBlock(b))
        .map((b) => (
          <Block key={b.id} block={b} ctx={ctx} />
        ))}
    </div>
  );
}
