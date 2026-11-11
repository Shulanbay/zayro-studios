/**
 * Typed home for real portfolio work and client testimonials. Both lists
 * are empty on purpose: nothing has been recorded or reviewed at the new
 * Midtown studio yet, and nothing here may be invented. The homepage hides
 * each section while its list is empty.
 *
 * Rules (see docs/content-requirements.md):
 *  - `location: 'zayro-midtown'` only for work actually recorded at ZAYRO.
 *  - Earlier work by the team elsewhere uses `location: 'prior'` and is shown
 *    under SELECTED PRODUCTION WORK with the required disclosure.
 *  - A testimonial needs the client's written permission; no ratings or
 *    Review / AggregateRating schema without real, visible reviews.
 */

export const PRIOR_WORK_HEADING = 'SELECTED PRODUCTION WORK';
export const PRIOR_WORK_DISCLOSURE = 'Produced by the ZAYRO team before the opening of our Midtown studio.';

export interface ShowcaseProject {
  slug: string;
  title: string;
  client: string;
  summary: string;
  /** Where it was produced: at the Midtown studio, or earlier work by the team elsewhere. */
  location: 'zayro-midtown' | 'prior';
  /** Local image path (approved, with rights). */
  image?: string;
  imageAlt?: string;
  url?: string;
  /** Only published entries are shown. */
  published: boolean;
}

export interface Testimonial {
  quote: string;
  name: string;
  role?: string;
  /** Written permission from the client to publish. */
  permissionOnFile: true;
  published: boolean;
}

const PROJECTS: ShowcaseProject[] = [];
const TESTIMONIALS: Testimonial[] = [];

export const PUBLISHED_PROJECTS = PROJECTS.filter((p) => p.published);
export const PUBLISHED_TESTIMONIALS = TESTIMONIALS.filter((t) => t.published && t.permissionOnFile);
