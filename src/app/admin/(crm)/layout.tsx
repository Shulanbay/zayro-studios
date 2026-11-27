import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/crm/auth';
import { NAV_ITEMS } from '@/lib/crm/nav';
import CrmShell from '@/components/crm/CrmShell';
import { adminLocaleFor } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Admin | ZAYRO Studios', robots: { index: false, follow: false } };

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  const items = NAV_ITEMS.filter((i) => admin.can(i.permission)).map(({ href, label, labelKey, icon, group }) => ({ href, label, labelKey, icon, group }));
  return (
    <CrmShell items={items} locale={adminLocaleFor(admin)} admin={{ email: admin.email, name: admin.fullName, role: admin.roleName }}>
      {children}
    </CrmShell>
  );
}
