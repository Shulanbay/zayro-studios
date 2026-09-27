import type { Metadata } from 'next';

export const SITE_URL = 'https://zayro.studio';
export const SITE_NAME = 'ZAYRO Studios';

/**
 * Per-page metadata with its own canonical URL and Open Graph URL. (A
 * canonical set only in the root layout would mark every page as a
 * duplicate of the home page.)
 */
export function pageMetadata({
  title,
  description,
  path,
  noindex = false,
}: {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path, siteName: SITE_NAME, type: 'website', locale: 'en_US' },
    twitter: { card: 'summary_large_image', title, description },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
  };
}
