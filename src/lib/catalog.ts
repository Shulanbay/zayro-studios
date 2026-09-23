/**
 * Service catalog rules shared by the pricing page, booking flow, public
 * API and admin. Pure functions only — safe to import from client
 * components and to unit test. Everything shown to customers is derived
 * from the `services` table; nothing here hardcodes a price.
 */

export const SERVICE_CATEGORIES = ['podcast', 'photography', 'tour', 'package', 'video', 'livestream', 'editing'] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  podcast: 'Podcast',
  photography: 'Photography',
  tour: 'Studio Tour',
  package: 'Monthly Package',
  video: 'Video',
  livestream: 'Livestream',
  editing: 'Editing',
};

/** Order of category tabs in the booking flow. Packages are never bookable. */
export const BOOKING_CATEGORY_ORDER: ServiceCategory[] = ['podcast', 'photography', 'video', 'livestream', 'editing', 'tour'];

export const PACKAGE_TYPES = ['studio_recording', 'full_production'] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];

export const PACKAGE_TYPE_LABELS: Record<PackageType, string> = {
  studio_recording: 'Studio Recording Membership',
  full_production: 'Full Production Membership',
};

export const DEFAULT_PACKAGE_VALIDITY_DAYS = 30;

/** The subset of service fields the catalog logic needs. */
export interface CatalogService {
  id: number;
  name: string;
  description: string | null;
  base_price: string;
  duration_minutes: number;
  category: string;
  features: string[] | null;
  is_active: boolean;
  display_order: number;
  is_featured: boolean;
  badge: string | null;
  session_count: number | null;
  validity_days: number | null;
  package_type: string | null;
  package_base_service_id: number | null;
}

export function isServiceCategory(value: unknown): value is ServiceCategory {
  return typeof value === 'string' && (SERVICE_CATEGORIES as readonly string[]).includes(value);
}

export function isPackageType(value: unknown): value is PackageType {
  return typeof value === 'string' && (PACKAGE_TYPES as readonly string[]).includes(value);
}

/** A monthly package is bought, not booked into a time slot. */
export function isPackage(service: Pick<CatalogService, 'category'>): boolean {
  return service.category === 'package';
}

/** Can a customer pick this service and a time slot directly? */
export function isBookable(service: Pick<CatalogService, 'category' | 'is_active'>): boolean {
  return service.is_active && !isPackage(service);
}

export function sortServices<T extends Pick<CatalogService, 'display_order' | 'id'>>(list: T[]): T[] {
  return [...list].sort((a, b) => a.display_order - b.display_order || a.id - b.id);
}

export function bookableServices<T extends CatalogService>(list: T[]): T[] {
  return sortServices(list.filter(isBookable));
}

export function servicesInCategory<T extends CatalogService>(list: T[], category: string): T[] {
  return sortServices(list.filter((s) => s.category === category));
}

/** Booking-flow tabs: only categories that currently have a bookable service. */
export function bookingCategories(list: CatalogService[]): ServiceCategory[] {
  const present = new Set(list.filter(isBookable).map((s) => s.category));
  return BOOKING_CATEGORY_ORDER.filter((c) => present.has(c));
}

export function priceNumber(value: string | number): number {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatPrice(value: string | number): string {
  const n = priceNumber(value);
  if (n === 0) return 'Free';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = `${hours} hour${hours === 1 ? '' : 's'}`;
  return rest ? `${h} ${rest} min` : h;
}

export interface PackagePricing {
  sessions: number;
  packagePrice: number;
  /** Price per session inside the package. */
  perSession: number;
  /** null when the base service is missing (then no discount can be shown). */
  regularPrice: number | null;
  baseSessionPrice: number | null;
  savings: number | null;
  discountPercent: number | null;
  validityDays: number;
}

/**
 * Regular price = session_count × the base service's current price.
 * Discount and savings are derived from that, so the pricing page can never
 * disagree with the database.
 */
export function computePackagePricing(
  pkg: Pick<CatalogService, 'base_price' | 'session_count' | 'validity_days'>,
  baseService: Pick<CatalogService, 'base_price'> | null | undefined
): PackagePricing {
  const sessions = pkg.session_count && pkg.session_count > 0 ? pkg.session_count : 1;
  const packagePrice = priceNumber(pkg.base_price);
  const baseSessionPrice = baseService ? priceNumber(baseService.base_price) : null;
  const regularPrice = baseSessionPrice !== null ? round2(baseSessionPrice * sessions) : null;
  const savings = regularPrice !== null ? round2(regularPrice - packagePrice) : null;
  const discountPercent =
    regularPrice && savings !== null && savings > 0 ? Math.round((savings / regularPrice) * 100) : regularPrice ? 0 : null;
  return {
    sessions,
    packagePrice,
    perSession: round2(packagePrice / sessions),
    regularPrice,
    baseSessionPrice,
    savings,
    discountPercent,
    validityDays: pkg.validity_days && pkg.validity_days > 0 ? pkg.validity_days : DEFAULT_PACKAGE_VALIDITY_DAYS,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Contact-form topic for requesting a package (the purchase is handled by request). */
export function packageRequestTopic(pkg: Pick<CatalogService, 'name' | 'base_price' | 'package_type'>): string {
  const membership = isPackageType(pkg.package_type) ? `${PACKAGE_TYPE_LABELS[pkg.package_type]} — ` : '';
  return `Monthly Package: ${membership}${pkg.name} (${formatPrice(pkg.base_price)})`;
}

export function contactHref(topic: string): string {
  return `/contact?topic=${encodeURIComponent(topic)}`;
}

export function bookingHref(service: Pick<CatalogService, 'id'>): string {
  return `/booking?service=${service.id}`;
}
