import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://zayro.studio';

  const routes = [
    { path: '', priority: 1, changeFrequency: 'weekly' as const, lastModified: '2026-10-16' },
    { path: '/podcast-studio-nyc', priority: 0.95, changeFrequency: 'monthly' as const, lastModified: '2026-10-16' },
    { path: '/video-production-studio-nyc', priority: 0.95, changeFrequency: 'monthly' as const, lastModified: '2026-10-16' },
    { path: '/studio', priority: 0.8, changeFrequency: 'monthly' as const, lastModified: '2026-10-16' },
    { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' as const, lastModified: '2026-10-16' },
    { path: '/booking', priority: 0.9, changeFrequency: 'weekly' as const, lastModified: '2026-10-16' },
    { path: '/about', priority: 0.6, changeFrequency: 'monthly' as const, lastModified: '2026-10-16' },
    { path: '/contact', priority: 0.6, changeFrequency: 'monthly' as const, lastModified: '2026-10-16' },
    { path: '/faq', priority: 0.6, changeFrequency: 'monthly' as const, lastModified: '2026-10-16' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' as const, lastModified: '2026-09-26' },
    { path: '/terms', priority: 0.3, changeFrequency: 'yearly' as const, lastModified: '2026-09-26' },
  ];

  return routes.map((route) => ({
    url: `${base}${route.path}`,
    lastModified: route.lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
