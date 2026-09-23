import { describe, it, expect } from 'vitest';
import {
  bookableServices,
  bookingCategories,
  computePackagePricing,
  formatDuration,
  formatPrice,
  isBookable,
  packageRequestTopic,
  servicesInCategory,
  contactHref,
  type CatalogService,
} from './catalog';

let nextId = 1;
function svc(overrides: Partial<CatalogService>): CatalogService {
  return {
    id: nextId++,
    name: 'Service',
    description: null,
    base_price: '100.00',
    duration_minutes: 60,
    category: 'podcast',
    features: [],
    is_active: true,
    display_order: 0,
    is_featured: false,
    badge: null,
    session_count: null,
    validity_days: null,
    package_type: null,
    package_base_service_id: null,
    ...overrides,
  };
}

const podcastPro = svc({ name: 'Podcast Pro', base_price: '200.00' });
const fullPackage = svc({ name: 'Full Podcast Package', base_price: '450.00' });
const pkg = (price: number, sessions: number, base: CatalogService) =>
  svc({ category: 'package', base_price: price.toFixed(2), session_count: sessions, validity_days: 30, package_base_service_id: base.id });

describe('monthly package pricing', () => {
  it.each([
    // [package price, sessions, base, regular, savings, discount %]
    [360, 2, podcastPro, 400, 40, 10],
    [680, 4, podcastPro, 800, 120, 15],
    [1280, 8, podcastPro, 1600, 320, 20],
    [810, 2, fullPackage, 900, 90, 10],
    [1530, 4, fullPackage, 1800, 270, 15],
    [2880, 8, fullPackage, 3600, 720, 20],
  ])('$%s for %s sessions → regular %s, save %s, %s%% off', (price, sessions, base, regular, savings, discount) => {
    const p = computePackagePricing(pkg(price as number, sessions as number, base as CatalogService), base as CatalogService);
    expect(p.packagePrice).toBe(price);
    expect(p.regularPrice).toBe(regular);
    expect(p.savings).toBe(savings);
    expect(p.discountPercent).toBe(discount);
    expect(p.perSession).toBe((price as number) / (sessions as number));
    expect(p.validityDays).toBe(30);
  });

  it('follows the base service price from the database (no hardcoded regular price)', () => {
    const p = computePackagePricing(pkg(360, 2, podcastPro), { base_price: '220.00' });
    expect(p.regularPrice).toBe(440);
    expect(p.savings).toBe(80);
    expect(p.discountPercent).toBe(18);
  });

  it('shows no discount when the base service is unknown', () => {
    const p = computePackagePricing(pkg(360, 2, podcastPro), null);
    expect(p).toMatchObject({ regularPrice: null, savings: null, discountPercent: null, packagePrice: 360 });
  });

  it('defaults validity to 30 days', () => {
    expect(computePackagePricing({ base_price: '100', session_count: 2, validity_days: null }, null).validityDays).toBe(30);
    expect(computePackagePricing({ base_price: '100', session_count: 2, validity_days: 45 }, null).validityDays).toBe(45);
  });
});

describe('category filtering', () => {
  const list = [
    svc({ name: 'Single Podcaster', base_price: '170.00', display_order: 10 }),
    svc({ name: 'Podcast Pro', base_price: '200.00', display_order: 20 }),
    svc({ name: 'Old Session', is_active: false }),
    svc({ name: 'Headshot Session', category: 'photography', display_order: 10 }),
    svc({ name: 'Brand Content Session', category: 'photography', display_order: 30 }),
    svc({ name: 'Studio Photoshoot', category: 'photography', display_order: 20 }),
    svc({ name: 'Free Studio Tour', category: 'tour', base_price: '0.00', duration_minutes: 30 }),
    svc({ name: '4 Sessions per Month', category: 'package', base_price: '680.00', session_count: 4 }),
  ];

  it('excludes inactive services and monthly packages from booking', () => {
    const names = bookableServices(list).map((s) => s.name);
    expect(names).not.toContain('Old Session');
    expect(names).not.toContain('4 Sessions per Month');
    expect(names).toContain('Free Studio Tour');
    expect(isBookable(list[7])).toBe(false);
    expect(isBookable(list[2])).toBe(false);
  });

  it('keeps photography separate from podcast, in display order', () => {
    expect(servicesInCategory(list, 'photography').map((s) => s.name)).toEqual([
      'Headshot Session',
      'Studio Photoshoot',
      'Brand Content Session',
    ]);
    expect(servicesInCategory(list, 'podcast').every((s) => s.category === 'podcast')).toBe(true);
  });

  it('offers booking tabs only for categories with bookable services, tour last, never packages', () => {
    expect(bookingCategories(list)).toEqual(['podcast', 'photography', 'tour']);
    expect(bookingCategories(list.filter((s) => s.category !== 'photography'))).toEqual(['podcast', 'tour']);
  });
});

describe('formatting helpers', () => {
  it('formats prices and durations', () => {
    expect(formatPrice('1280.00')).toBe('$1,280');
    expect(formatPrice('184.66')).toBe('$184.66');
    expect(formatPrice('0.00')).toBe('Free');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 hour');
    expect(formatDuration(90)).toBe('1 hour 30 min');
    expect(formatDuration(120)).toBe('2 hours');
  });

  it('builds a prefilled contact link for package requests', () => {
    const topic = packageRequestTopic({ name: '4 Sessions per Month', base_price: '680.00', package_type: 'studio_recording' });
    expect(topic).toBe('Monthly Package: Studio Recording Membership — 4 Sessions per Month ($680)');
    expect(contactHref(topic)).toBe(`/contact?topic=${encodeURIComponent(topic)}`);
  });
});
