import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Admin sign in | ZAYRO Studios', robots: { index: false, follow: false } };

export default function AdminLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
