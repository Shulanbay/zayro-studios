'use client';

import { usePathname } from 'next/navigation';

/** Renders the public header/footer everywhere except the admin CRM. */
export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith('/admin')) return null;
  return <>{children}</>;
}
