import PackageCheckout from '@/components/packages/PackageCheckout';
import { pageMetadata } from '@/lib/seo';
export const metadata = pageMetadata({ title: 'Buy Monthly Package | ZAYRO Studios', description: 'Buy a prepaid monthly package and choose your recording dates later.', path: '/packages/buy', noindex: true });
export default function Page() { return <PackageCheckout />; }
