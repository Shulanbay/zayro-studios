import type { Setup } from './db/schema';
import { listSetupsForCategory } from './bookingQuote';

/**
 * The public setup catalog, read from the same `setups` table (and the same
 * filter) the booking flow uses, so the homepage can never show a setup the
 * booking flow doesn't offer. The slug is the stable identity used in
 * booking links; names are display text only.
 */
export interface PublicSetup {
  slug: string;
  name: string;
  description: string | null;
  capacity: number | null;
  image: string | null;
  bookingHref: string;
}

export function setupBookingHref(category: string, slug: string): string {
  return `/booking?category=${encodeURIComponent(category)}&setup=${encodeURIComponent(slug)}`;
}

export function toPublicSetup(setup: Setup, category: string): PublicSetup {
  const image = (setup.metadata as { image?: unknown })?.image;
  return {
    slug: setup.slug,
    name: setup.name,
    description: setup.description,
    capacity: setup.capacity,
    image: typeof image === 'string' && image.startsWith('/') ? image : null,
    bookingHref: setupBookingHref(category, setup.slug),
  };
}

/** Active setups for a category in display order; [] when the database is unavailable (the section then hides). */
export async function getPublicSetups(category = 'podcast'): Promise<PublicSetup[]> {
  try {
    return (await listSetupsForCategory(category)).map((s) => toPublicSetup(s, category));
  } catch (error) {
    console.error('Setups unavailable:', (error as Error)?.message || error);
    return [];
  }
}
