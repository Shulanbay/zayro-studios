/**
 * Landing-page content blocks: the schema the builder edits and the public
 * renderer draws. Validated with zod on every save, so a page can never be
 * published with a broken block. Text is plain text (rendered escaped); links
 * are site paths, https URLs, tel:, mailto: or messenger links only.
 */
import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional().default('');

/** Links a page may use: site paths, https, tel:, mailto:, WhatsApp/Telegram, or a #anchor. */
export const safeHref = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^(\/(?!\/)[^\s]*|#[A-Za-z0-9_-]+|https:\/\/[^\s]+|tel:\+?[\d\s()-]{5,25}|mailto:[^\s@]+@[^\s@]+)$/.test(v), 'Use a site path (/booking), an https:// link, tel:, mailto: or #anchor');

/** Images: site files (/setups/…) or https URLs. */
export const safeImage = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^(\/(?!\/)[\w\-./]+\.(webp|png|jpe?g|avif|gif|svg)|https:\/\/[^\s]+)$/i.test(v), 'Use a site image (/setups/…) or an https:// image URL');

const cta = z.object({ label: optionalText(60), href: safeHref.optional().default('') });

const base = {
  id: z.string().regex(/^[a-z0-9]{6,24}$/),
  hidden: z.boolean().optional().default(false),
  /** Anchor for in-page links (#pricing). */
  anchor: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{0,40}$/)
    .optional()
    .default(''),
};

export const heroBlock = z.object({
  ...base,
  type: z.literal('hero'),
  eyebrow: optionalText(80),
  heading: text(140).min(1, 'Add a heading'),
  subheading: optionalText(400),
  primary: cta.optional().default({ label: '', href: '' }),
  secondary: cta.optional().default({ label: '', href: '' }),
  image: safeImage.optional().default(''),
  imageAlt: optionalText(160),
  theme: z.enum(['dark', 'light']).optional().default('dark'),
});

export const featuresBlock = z.object({
  ...base,
  type: z.literal('features'),
  heading: optionalText(140),
  subheading: optionalText(300),
  items: z.array(z.object({ title: text(80).min(1), body: optionalText(300) })).max(12).default([]),
});

export const packagesBlock = z.object({
  ...base,
  type: z.literal('packages'),
  heading: optionalText(140),
  subheading: optionalText(300),
  /** catalog = live prices from Services (always in sync); custom = text cards. */
  source: z.enum(['catalog', 'custom']).default('catalog'),
  category: z.enum(['podcast', 'video', 'photography', 'package', 'tour', 'all']).optional().default('podcast'),
  serviceIds: z.array(z.number().int().positive()).max(12).optional().default([]),
  items: z
    .array(
      z.object({
        name: text(80).min(1),
        price: optionalText(40),
        period: optionalText(40),
        description: optionalText(300),
        features: z.array(text(120)).max(12).default([]),
        cta: cta.optional().default({ label: '', href: '' }),
        highlight: z.boolean().optional().default(false),
      })
    )
    .max(6)
    .optional()
    .default([]),
  ctaLabel: optionalText(40),
});

export const setupsBlock = z.object({
  ...base,
  type: z.literal('setups'),
  heading: optionalText(140),
  subheading: optionalText(300),
  /** studio = the real setups and photos from the studio catalog. */
  source: z.enum(['studio', 'custom']).default('studio'),
  items: z.array(z.object({ title: text(80).min(1), body: optionalText(300), image: safeImage.optional().default('') })).max(12).optional().default([]),
});

export const galleryBlock = z.object({
  ...base,
  type: z.literal('gallery'),
  heading: optionalText(140),
  images: z.array(z.object({ src: safeImage.refine((v) => v !== '', 'Add an image'), alt: optionalText(160) })).max(24).default([]),
  videoUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === '' || /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/)|youtu\.be\/|player\.vimeo\.com\/video\/|vimeo\.com\/)[\w-]+/.test(v), 'Use a YouTube or Vimeo link')
    .optional()
    .default(''),
});

export const testimonialsBlock = z.object({
  ...base,
  type: z.literal('testimonials'),
  heading: optionalText(140),
  items: z.array(z.object({ quote: text(600).min(1), author: text(80).min(1), role: optionalText(100) })).max(12).default([]),
});

export const faqBlock = z.object({
  ...base,
  type: z.literal('faq'),
  heading: optionalText(140),
  items: z.array(z.object({ q: text(200).min(1), a: text(1200).min(1) })).max(20).default([]),
});

export const leadFormBlock = z.object({
  ...base,
  type: z.literal('leadForm'),
  heading: optionalText(140),
  subheading: optionalText(300),
  askEmail: z.boolean().optional().default(true),
  askMessage: z.boolean().optional().default(true),
  submitLabel: optionalText(40),
  successMessage: optionalText(300),
  /** Show WhatsApp / Telegram buttons (numbers come from Admin → Tracking). */
  showMessengers: z.boolean().optional().default(true),
});

export const ctaBlock = z.object({
  ...base,
  type: z.literal('cta'),
  heading: text(140).min(1),
  body: optionalText(300),
  button: cta.optional().default({ label: '', href: '' }),
});

export const textBlock = z.object({
  ...base,
  type: z.literal('text'),
  heading: optionalText(140),
  body: text(5000).min(1),
});

export const contentBlock = z.discriminatedUnion('type', [heroBlock, featuresBlock, packagesBlock, setupsBlock, galleryBlock, testimonialsBlock, faqBlock, leadFormBlock, ctaBlock, textBlock]);
export type ContentBlock = z.infer<typeof contentBlock>;
export type BlockType = ContentBlock['type'];
export const BLOCK_TYPES: BlockType[] = ['hero', 'features', 'packages', 'setups', 'gallery', 'testimonials', 'faq', 'leadForm', 'cta', 'text'];

export const contentBlocks = z.array(contentBlock).max(40);

export function newBlockId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

/** A fresh block of a type with sensible empty defaults (the builder's "Add block"). */
export function emptyBlock(type: BlockType): ContentBlock {
  const id = newBlockId();
  switch (type) {
    case 'hero':
      return heroBlock.parse({ id, type, heading: 'Your headline', primary: { label: 'Book a session', href: '/booking' } });
    case 'features':
      return featuresBlock.parse({ id, type, heading: '', items: [] });
    case 'packages':
      return packagesBlock.parse({ id, type, source: 'catalog', category: 'podcast' });
    case 'setups':
      return setupsBlock.parse({ id, type, source: 'studio' });
    case 'gallery':
      return galleryBlock.parse({ id, type, images: [] });
    case 'testimonials':
      return testimonialsBlock.parse({ id, type, items: [] });
    case 'faq':
      return faqBlock.parse({ id, type, items: [] });
    case 'leadForm':
      return leadFormBlock.parse({ id, type, anchor: 'contact' });
    case 'cta':
      return ctaBlock.parse({ id, type, heading: 'Ready to record?', button: { label: 'Book now', href: '/booking' } });
    case 'text':
      return textBlock.parse({ id, type, body: 'Write your text here.' });
  }
}

/** Parses stored blocks, dropping (never crashing on) a block that no longer validates. */
export function readBlocks(value: unknown): ContentBlock[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? safeJson(value) : [];
  const out: ContentBlock[] = [];
  for (const raw of list) {
    const parsed = contentBlock.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function safeJson(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Blocks that would show nothing yet (no items): rendered hidden on the public page. */
export function isEmptyBlock(b: ContentBlock): boolean {
  if (b.type === 'testimonials' || b.type === 'faq' || b.type === 'features') return b.items.length === 0;
  if (b.type === 'gallery') return b.images.length === 0 && !b.videoUrl;
  if (b.type === 'packages') return b.source === 'custom' && b.items.length === 0;
  if (b.type === 'setups') return b.source === 'custom' && b.items.length === 0;
  return false;
}

// ---------------------------------------------------------------------------
// Templates for the four funnels in the brief. No invented reviews or
// numbers: testimonials and galleries start empty and stay hidden until the
// team adds real ones; prices always come from the live catalog.
// ---------------------------------------------------------------------------

export const PAGE_TEMPLATES = ['blank', 'home', 'video-podcast', 'reels-pack', 'promo-ads'] as const;
export type PageTemplate = (typeof PAGE_TEMPLATES)[number];

export function templateBlocks(template: PageTemplate): ContentBlock[] {
  const b = <T extends BlockType>(type: T, extra: Record<string, unknown> = {}) => contentBlock.parse({ ...emptyBlock(type), ...extra });
  switch (template) {
    case 'blank':
      return [b('hero')];
    case 'home':
      return [
        b('hero', { eyebrow: 'Midtown Manhattan', heading: 'Premium podcast & video studio in NYC', subheading: 'Professional cameras, lighting and sound — record with a producer in a designed studio.', primary: { label: 'Book a session', href: '/booking' }, secondary: { label: 'Free studio tour', href: '/booking?category=tour' } }),
        b('setups', { heading: 'Four studio setups' }),
        b('packages', { heading: 'Pricing', category: 'podcast', anchor: 'pricing' }),
        b('testimonials', { heading: 'What clients say' }),
        b('faq', { heading: 'Questions' }),
        b('leadForm', { heading: 'Get a quote', subheading: 'Tell us about your project — we reply within one business day.' }),
      ];
    case 'video-podcast':
      return [
        b('hero', { eyebrow: 'Video podcast studio', heading: 'Launch your video podcast this week', subheading: 'Multi-camera recording, studio lighting and broadcast audio in one session.', primary: { label: 'Book a recording', href: '/booking' }, secondary: { label: 'See pricing', href: '#pricing' } }),
        b('features', { heading: 'What is included', items: [{ title: 'Multi-camera setup', body: '' }, { title: 'Studio lighting', body: '' }, { title: 'Broadcast microphones', body: '' }] }),
        b('setups', { heading: 'Choose your set' }),
        b('packages', { heading: 'Pricing', category: 'podcast', anchor: 'pricing' }),
        b('faq', { heading: 'Questions' }),
        b('leadForm', { heading: 'Plan your first episode' }),
      ];
    case 'reels-pack':
      return [
        b('hero', { eyebrow: 'Short-form content', heading: 'A month of Reels in one studio session', subheading: 'Vertical video for Instagram, TikTok and YouTube Shorts — filmed and edited by our team.', primary: { label: 'Get a quote', href: '#contact' } }),
        b('features', { heading: 'How it works', items: [{ title: 'Plan', body: '' }, { title: 'Film', body: '' }, { title: 'Edit', body: '' }] }),
        b('gallery', { heading: 'Examples' }),
        b('packages', { heading: 'Packages', category: 'package' }),
        b('leadForm', { heading: 'Request your Reels pack' }),
      ];
    case 'promo-ads':
      return [
        b('hero', { eyebrow: 'Limited offer', heading: 'Book your studio session', subheading: 'Professional podcast and video production in Midtown Manhattan.', primary: { label: 'Book now', href: '/booking' }, secondary: { label: 'Free studio tour', href: '/booking?category=tour' } }),
        b('packages', { heading: 'Pricing', category: 'podcast' }),
        b('testimonials', { heading: 'Reviews' }),
        b('cta', { heading: 'Ready when you are', body: 'Pick a time online — confirmation is instant.', button: { label: 'Choose a time', href: '/booking' } }),
        b('leadForm', { heading: 'Questions? Leave your number' }),
      ];
  }
}
