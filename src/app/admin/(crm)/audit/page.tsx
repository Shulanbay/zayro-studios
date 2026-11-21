import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq, gte, ilike, lt, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { parsePage } from '@/lib/crm/range';
import { addDays, isDateString, wallTimeToUtc } from '@/lib/crm/time';
import { getAdminI18n } from '@/lib/i18n/server';
import { Card, EmptyState, Forbidden, PageHeader, Pagination, StatusBadge } from '@/components/crm/ui';

export const dynamic = 'force-dynamic';
const PAGE = 50;

const ENTITY_LINKS: Record<string, string> = { booking: '/admin/sessions/', customer: '/admin/customers/', purchase: '/admin/purchases/', customer_package: '/admin/packages/' };

function short(value: unknown) {
  if (value === null || value === undefined) return '';
  const s = JSON.stringify(value);
  return s.length > 220 ? `${s.slice(0, 220)}…` : s;
}

export default async function AuditPage({ searchParams }: { searchParams: { q?: string; entity?: string; outcome?: string; actor?: string; from?: string; to?: string; page?: string } }) {
  const admin = await getAdminContext();
  if (!admin) redirect('/admin/login');
  if (!admin.can('audit.read')) return <Forbidden what="the audit log" />;
  const { t, f, label } = getAdminI18n(admin);

  const c: SQL[] = [];
  if (searchParams.q?.trim()) c.push(ilike(auditLogs.operation, `%${searchParams.q.trim().replace(/[\\%_]/g, '')}%`));
  if (searchParams.entity?.trim()) c.push(eq(auditLogs.entity_type, searchParams.entity.trim()));
  if (['success', 'denied', 'failed'].includes(searchParams.outcome ?? '')) c.push(eq(auditLogs.outcome, searchParams.outcome as 'success'));
  if (searchParams.actor?.trim()) c.push(ilike(auditLogs.actor_email, `%${searchParams.actor.trim().replace(/[\\%_]/g, '')}%`));
  if (isDateString(searchParams.from)) c.push(gte(auditLogs.created_at, wallTimeToUtc(searchParams.from, '00:00')));
  if (isDateString(searchParams.to)) c.push(lt(auditLogs.created_at, wallTimeToUtc(addDays(searchParams.to, 1), '00:00')));
  const where = c.length ? and(...c) : undefined;
  const page = parsePage(searchParams.page);

  const [rows, [{ total }], entities] = await Promise.all([
    db.query.auditLogs.findMany({ where, orderBy: [desc(auditLogs.created_at)], limit: PAGE, offset: (page - 1) * PAGE }),
    db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where),
    db.selectDistinct({ e: auditLogs.entity_type }).from(auditLogs),
  ]);
  const params = Object.fromEntries(Object.entries(searchParams).filter(([k, v]) => k !== 'page' && typeof v === 'string')) as Record<string, string>;

  return (
    <>
      <PageHeader title={t('common.nav.audit')} description={t('system.audit.description', { count: Number(total) })} />
      <form method="get" className="card !p-4 mb-4 grid grid-cols-2 md:grid-cols-6 gap-2 items-end" aria-label={t('system.audit.filterLabel')}>
        <div>
          <label className="field-label" htmlFor="q">
            {t('system.audit.action')}
          </label>
          <input id="q" name="q" defaultValue={searchParams.q} placeholder={t('system.audit.actionPlaceholder')} />
        </div>
        <div>
          <label className="field-label" htmlFor="entity">
            {t('system.audit.recordType')}
          </label>
          <select id="entity" name="entity" defaultValue={searchParams.entity ?? ''}>
            <option value="">{t('system.audit.any')}</option>
            {entities.map(({ e }) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="outcome">
            {t('system.audit.outcome')}
          </label>
          <select id="outcome" name="outcome" defaultValue={searchParams.outcome ?? ''}>
            <option value="">{t('system.audit.any')}</option>
            {['success', 'denied', 'failed'].map((o) => (
              <option key={o} value={o}>
                {label(o)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="actor">
            {t('system.audit.by')}
          </label>
          <input id="actor" name="actor" defaultValue={searchParams.actor} placeholder={t('system.audit.byPlaceholder')} />
        </div>
        <div>
          <label className="field-label" htmlFor="from">
            {t('system.audit.from')}
          </label>
          <input id="from" type="date" name="from" defaultValue={searchParams.from} />
        </div>
        <div>
          <label className="field-label" htmlFor="to">
            {t('system.audit.to')}
          </label>
          <input id="to" type="date" name="to" defaultValue={searchParams.to} />
        </div>
        <div className="col-span-2 md:col-span-6 flex gap-2">
          <button type="submit" className="crm-btn crm-btn-primary">
            {t('common.actions.apply')}
          </button>
          <Link href="/admin/audit" className="crm-btn">
            {t('system.audit.reset')}
          </Link>
        </div>
      </form>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t('system.audit.empty')} />
        ) : (
          <div className="crm-table-wrap -mx-5 md:-mx-6 -my-5 md:-my-6">
            <table className="crm-table min-w-[900px]">
              <caption className="sr-only">{t('system.audit.caption')}</caption>
              <thead>
                <tr>
                  {(['when', 'by', 'action', 'record', 'outcome', 'details'] as const).map((c) => (
                    <th key={c} scope="col">
                      {t(`system.audit.cols.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const link = r.entity_id && ENTITY_LINKS[r.entity_type] ? `${ENTITY_LINKS[r.entity_type]}${r.entity_id}` : null;
                  return (
                    <tr key={r.id}>
                      <td className="text-xs whitespace-nowrap">{f.instant(r.created_at)}</td>
                      <td className="text-xs break-all">{r.actor_email ?? t('system.audit.system')}</td>
                      <td>
                        <code className="text-xs">{r.operation}</code>
                      </td>
                      <td className="text-xs">
                        {r.entity_type}
                        {r.entity_id && <div className="text-zayro-gray break-all">{link ? <Link href={link}>{r.entity_id}</Link> : r.entity_id}</div>}
                      </td>
                      <td>
                        <StatusBadge status={r.outcome} />
                      </td>
                      <td className="text-[11px] text-zayro-gray break-words max-w-[360px]">
                        {r.before_data !== null && <div>{t('system.audit.before', { value: short(r.before_data) })}</div>}
                        {r.after_data !== null && <div>{t('system.audit.after', { value: short(r.after_data) })}</div>}
                        {r.metadata !== null && <div>{short(r.metadata)}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pagination base="/admin/audit" params={params} page={page} pageSize={PAGE} total={Number(total)} />
    </>
  );
}
