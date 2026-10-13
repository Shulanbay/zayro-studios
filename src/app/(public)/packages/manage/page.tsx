import PackageManager from '@/components/packages/PackageManager';
import { pageMetadata } from '@/lib/seo';
export const metadata = { ...pageMetadata({ title: 'Your Monthly Package | ZAYRO Studios', description: 'Manage your prepaid recording sessions.', path: '/packages/manage', noindex: true }), referrer: 'no-referrer' as const };
export default function Page() { return <PackageManager />; }
