/**
 * The single typed catalogue of analytics events. Pure — shared by the
 * browser tracker, the collect endpoint, the server recorders, every
 * destination adapter and the docs (docs/marketing-event-matrix.md mirrors
 * PLATFORM_EVENTS below; a unit test keeps the two in step).
 *
 * Two kinds of events:
 *  - browser events: funnel steps and views. Anyone can send them, so they
 *    carry no money and never count as a conversion;
 *  - server events: the authoritative conversions (Checkout created, purchase
 *    confirmed by the Stripe webhook, free tour confirmed, contact accepted,
 *    extension paid, refund succeeded). The collect endpoint refuses them.
 */
import { z } from 'zod';

export const BROWSER_EVENTS = [
  'page_view',
  'landing_viewed',
  'pricing_viewed',
  'view_item',
  'booking_started',
  'service_selected',
  'setup_selected',
  'date_selected',
  'time_selected',
  'extras_reached',
  'extra_added',
  'details_started',
  'hold_created',
  'tour_cta_clicked',
  'tour_booking_started',
  'tour_date_selected',
  'tour_details_submitted',
  'contact_viewed',
  'contact_started',
  'phone_clicked',
  'email_clicked',
  'directions_clicked',
  'engaged',
] as const;

export const SERVER_EVENTS = [
  'checkout_created',
  'purchase_confirmed',
  'tour_confirmed',
  'booking_confirmed',
  'contact_submitted',
  'extension_purchased',
  'booking_rescheduled',
  'booking_cancelled',
  'refund_succeeded',
] as const;

export type BrowserEventName = (typeof BROWSER_EVENTS)[number];
export type ServerEventName = (typeof SERVER_EVENTS)[number];
export type EventName = BrowserEventName | ServerEventName;

export const EVENT_VERSION = 1;

export function isBrowserEvent(name: unknown): name is BrowserEventName {
  return typeof name === 'string' && (BROWSER_EVENTS as readonly string[]).includes(name);
}
export function isServerEvent(name: unknown): name is ServerEventName {
  return typeof name === 'string' && (SERVER_EVENTS as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// Properties: a strict allowlist per event. Unknown keys are rejected
// (.strict()), strings are short, nothing can carry free text.
// ---------------------------------------------------------------------------

const slug = z.string().trim().max(80).regex(/^[A-Za-z0-9 _.:/&+()'-]*$/, 'unsupported characters');
export const ANALYTICS_CATEGORIES = ['podcast', 'photography', 'video', 'tour', 'package', 'livestream', 'editing', 'other'] as const;
const category = z.enum(ANALYTICS_CATEGORIES);
const id = z.union([z.number().int().positive().max(1_000_000), z.string().regex(/^\d{1,7}$/)]);
const step = z.number().int().min(0).max(20);

const serviceProps = z.object({ service_id: id.optional(), service_name: slug.optional(), category: category.optional() }).strict();

export const BROWSER_PROPERTIES: Record<BrowserEventName, z.ZodTypeAny> = {
  page_view: z.object({ title: z.string().trim().max(120).optional() }).strict(),
  landing_viewed: z.object({}).strict(),
  pricing_viewed: z.object({}).strict(),
  view_item: serviceProps,
  booking_started: z.object({ category: category.optional(), entry: z.enum(['booking_page', 'deep_link', 'package']).optional() }).strict(),
  service_selected: serviceProps,
  setup_selected: z.object({ service_id: id.optional(), setup_slug: slug.optional() }).strict(),
  date_selected: z.object({ service_id: id.optional(), days_ahead: z.number().int().min(0).max(400).optional() }).strict(),
  time_selected: z.object({ service_id: id.optional(), hour: z.number().int().min(0).max(23).optional(), hours: z.number().int().min(1).max(24).optional() }).strict(),
  extras_reached: z.object({ service_id: id.optional() }).strict(),
  extra_added: z.object({ service_id: id.optional(), addon_id: id.optional(), quantity: z.number().int().min(1).max(20).optional() }).strict(),
  details_started: z.object({ service_id: id.optional(), step: step.optional() }).strict(),
  hold_created: z.object({ service_id: id.optional(), category: category.optional() }).strict(),
  tour_cta_clicked: z.object({ placement: slug.optional() }).strict(),
  tour_booking_started: z.object({}).strict(),
  tour_date_selected: z.object({ days_ahead: z.number().int().min(0).max(400).optional() }).strict(),
  tour_details_submitted: z.object({}).strict(),
  contact_viewed: z.object({}).strict(),
  contact_started: z.object({ topic: slug.optional() }).strict(),
  phone_clicked: z.object({ placement: slug.optional() }).strict(),
  email_clicked: z.object({ placement: slug.optional() }).strict(),
  directions_clicked: z.object({ placement: slug.optional() }).strict(),
  engaged: z.object({ seconds: z.number().int().min(0).max(86400).optional() }).strict(),
};

/** Tour bookings use their own funnel names (BookingFlow maps the generic step). */
export const TOUR_FUNNEL_NAME: Partial<Record<BrowserEventName, BrowserEventName>> = {
  booking_started: 'tour_booking_started',
  date_selected: 'tour_date_selected',
  hold_created: 'tour_details_submitted',
};

// ---------------------------------------------------------------------------
// Funnels (dashboard). Each step names its population so rates never divide
// incompatible things.
// ---------------------------------------------------------------------------

export interface FunnelStep {
  key: string;
  label: string;
  event: EventName | 'session';
  population: 'sessions' | 'events' | 'bookings' | 'purchases';
  definition: string;
}

export const BOOKING_FUNNEL: FunnelStep[] = [
  { key: 'landing', label: 'Landing viewed', event: 'session', population: 'sessions', definition: 'Consented sessions that started in the range (a session is one visit; 30 minutes without activity starts a new one).' },
  { key: 'pricing', label: 'Pricing viewed', event: 'pricing_viewed', population: 'sessions', definition: 'Consented sessions that opened the pricing or packages page.' },
  { key: 'booking_started', label: 'Booking started', event: 'booking_started', population: 'sessions', definition: 'Consented sessions with a first booking interaction (the first booking_started per session).' },
  { key: 'service', label: 'Service selected', event: 'service_selected', population: 'sessions', definition: 'Consented sessions that picked a service.' },
  { key: 'setup', label: 'Setup selected', event: 'setup_selected', population: 'sessions', definition: 'Consented sessions that picked a studio setup (only services with several setups have this step).' },
  { key: 'date', label: 'Date selected', event: 'date_selected', population: 'sessions', definition: 'Consented sessions that picked a date.' },
  { key: 'time', label: 'Time selected', event: 'time_selected', population: 'sessions', definition: 'Consented sessions that picked a time.' },
  { key: 'extras', label: 'Extras reached', event: 'extras_reached', population: 'sessions', definition: 'Consented sessions that reached the extras step (only services with extras).' },
  { key: 'details', label: 'Details started', event: 'details_started', population: 'sessions', definition: 'Consented sessions that reached the contact-details step.' },
  { key: 'hold', label: 'Time reserved', event: 'hold_created', population: 'sessions', definition: 'Consented sessions where the server reserved the slot (temporary hold).' },
  { key: 'checkout', label: 'Checkout created', event: 'checkout_created', population: 'bookings', definition: 'Stripe Checkout sessions successfully created by the server (not button clicks). All visitors, with or without analytics consent.' },
  { key: 'purchase', label: 'Paid booking', event: 'purchase_confirmed', population: 'purchases', definition: 'Bookings confirmed by a successful Stripe payment (signature-verified webhook). All visitors.' },
];

export const TOUR_FUNNEL: FunnelStep[] = [
  { key: 'tour_cta', label: 'Tour CTA clicked', event: 'tour_cta_clicked', population: 'sessions', definition: 'Consented sessions that clicked a “Book a free studio tour” call to action.' },
  { key: 'tour_started', label: 'Tour booking started', event: 'tour_booking_started', population: 'sessions', definition: 'Consented sessions that selected the studio tour in the booking flow.' },
  { key: 'tour_date', label: 'Tour date selected', event: 'tour_date_selected', population: 'sessions', definition: 'Consented sessions that picked a tour date.' },
  { key: 'tour_details', label: 'Tour details submitted', event: 'tour_details_submitted', population: 'sessions', definition: 'Consented sessions where the tour time was reserved after details were entered.' },
  { key: 'tour_confirmed', label: 'Tour confirmed', event: 'tour_confirmed', population: 'bookings', definition: 'Free studio tours confirmed in the database. All visitors.' },
];

export const CONTACT_FUNNEL: FunnelStep[] = [
  { key: 'contact_viewed', label: 'Contact page viewed', event: 'contact_viewed', population: 'sessions', definition: 'Consented sessions that opened the contact page.' },
  { key: 'contact_started', label: 'Form started', event: 'contact_started', population: 'sessions', definition: 'Consented sessions that started typing in the contact form.' },
  { key: 'contact_submitted', label: 'Form accepted', event: 'contact_submitted', population: 'events', definition: 'Contact messages the server accepted and delivered (spam-protected). All visitors.' },
];

// ---------------------------------------------------------------------------
// Destinations and the cross-platform event matrix
// ---------------------------------------------------------------------------

export const DESTINATIONS = [
  'ga4',
  'google_ads',
  'meta_pixel',
  'meta_capi',
  'reddit_pixel',
  'reddit_capi',
  'pinterest_tag',
  'pinterest_capi',
  'tiktok_pixel',
  'tiktok_events_api',
] as const;
export type Destination = (typeof DESTINATIONS)[number];

export const BROWSER_DESTINATIONS: Destination[] = ['google_ads', 'meta_pixel', 'reddit_pixel', 'pinterest_tag', 'tiktok_pixel'];
export const SERVER_DESTINATIONS: Destination[] = ['ga4', 'meta_capi', 'reddit_capi', 'pinterest_capi', 'tiktok_events_api'];

/** Consent each destination needs. GA4 is analytics; every ad platform is advertising. */
export const DESTINATION_CONSENT: Record<Destination, 'analytics' | 'advertising'> = {
  ga4: 'analytics',
  google_ads: 'advertising',
  meta_pixel: 'advertising',
  meta_capi: 'advertising',
  reddit_pixel: 'advertising',
  reddit_capi: 'advertising',
  pinterest_tag: 'advertising',
  pinterest_capi: 'advertising',
  tiktok_pixel: 'advertising',
  tiktok_events_api: 'advertising',
};

export interface PlatformMapping {
  ga4?: string;
  googleAds?: 'booking' | 'tour' | 'contact';
  meta?: string;
  reddit?: string;
  pinterest?: string;
  tiktok?: string;
}

/**
 * Internal event → each platform's standard event. One primary paid-booking
 * event per platform (GA4 purchase, Google Ads "booking" label, Meta
 * Purchase, Reddit Purchase, Pinterest checkout, TikTok CompletePayment);
 * nothing else maps to those names, so optimisation is never ambiguous.
 * Platform names follow each vendor's documented standard events — verify
 * them against the current docs before enabling a platform.
 */
export const PLATFORM_EVENTS: Partial<Record<EventName, PlatformMapping>> = {
  page_view: { ga4: 'page_view', meta: 'PageView', reddit: 'PageVisit', pinterest: 'pagevisit', tiktok: 'PageView' },
  pricing_viewed: { ga4: 'view_item_list', meta: 'ViewContent', reddit: 'ViewContent', pinterest: 'viewcategory', tiktok: 'ViewContent' },
  view_item: { ga4: 'view_item', meta: 'ViewContent', reddit: 'ViewContent', pinterest: 'viewcategory', tiktok: 'ViewContent' },
  booking_started: { ga4: 'booking_started' },
  service_selected: { ga4: 'select_item' },
  setup_selected: { ga4: 'booking_setup_selected' },
  date_selected: { ga4: 'booking_date_selected' },
  time_selected: { ga4: 'booking_time_selected' },
  extras_reached: { ga4: 'booking_extras_viewed' },
  extra_added: { ga4: 'booking_extra_added' },
  details_started: { ga4: 'booking_details_started' },
  hold_created: { ga4: 'booking_hold_created' },
  tour_cta_clicked: { ga4: 'studio_tour_started' },
  contact_started: { ga4: 'contact_form_started' },
  phone_clicked: { ga4: 'phone_clicked' },
  email_clicked: { ga4: 'email_clicked' },
  directions_clicked: { ga4: 'directions_clicked' },
  checkout_created: { ga4: 'begin_checkout', meta: 'InitiateCheckout', reddit: 'Custom:InitiateCheckout', pinterest: 'custom:initiate_checkout', tiktok: 'InitiateCheckout' },
  purchase_confirmed: { ga4: 'purchase', googleAds: 'booking', meta: 'Purchase', reddit: 'Purchase', pinterest: 'checkout', tiktok: 'CompletePayment' },
  tour_confirmed: { ga4: 'studio_tour_confirmed', googleAds: 'tour', meta: 'Schedule', reddit: 'Lead', pinterest: 'lead', tiktok: 'Schedule' },
  contact_submitted: { ga4: 'contact_form_submitted', googleAds: 'contact', meta: 'Lead', reddit: 'Lead', pinterest: 'lead', tiktok: 'SubmitForm' },
  extension_purchased: { ga4: 'booking_extended' },
  refund_succeeded: { ga4: 'refund' },
  booking_rescheduled: { ga4: 'booking_rescheduled' },
  booking_cancelled: { ga4: 'booking_cancelled' },
};

/** GA4 key events (mark only these as key events in the GA4 property). */
export const GA4_KEY_EVENTS = ['purchase', 'studio_tour_confirmed', 'contact_form_submitted', 'begin_checkout'] as const;

/** Events the browser may echo to pixels with the server's event ID (dedup pairs). */
export const MIRRORED_CONVERSIONS: ServerEventName[] = ['checkout_created', 'purchase_confirmed', 'tour_confirmed', 'contact_submitted'];

/** Server events that are delivered to server-side destinations (CAPI / MP). */
export const SERVER_DELIVERED: Partial<Record<ServerEventName, Destination[]>> = {
  checkout_created: ['ga4', 'meta_capi', 'reddit_capi', 'pinterest_capi', 'tiktok_events_api'],
  purchase_confirmed: ['ga4', 'meta_capi', 'reddit_capi', 'pinterest_capi', 'tiktok_events_api'],
  tour_confirmed: ['ga4', 'meta_capi', 'reddit_capi', 'pinterest_capi', 'tiktok_events_api'],
  contact_submitted: ['ga4', 'meta_capi', 'reddit_capi', 'pinterest_capi', 'tiktok_events_api'],
  extension_purchased: ['ga4'],
  refund_succeeded: ['ga4'],
};
