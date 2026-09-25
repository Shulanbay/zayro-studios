import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq, gte, ilike, lt, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditLogs } from '@/lib/db/schema';
import { getAdminContext } from '@/lib/crm/auth';
import { parsePage } from '@/lib/crm/range';
import { addDays, formatInstantEt, isDateString, wallTimeToUtc } from '@/lib/crm/time';
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
      <PageHeader title="Audit log" description={`${total} recorded action${Number(total) === 1 ? '' : 's'} · who did what, when, and the result. Secrets and payment data are never recorded.`} />
      <form method="get" className="card !p-4 mb-4 grid grid-cols-2 md:grid-cols-6 gap-2 items-end" aria-label="Filter audit log">
        <div>
          <label className="field-label" htmlFor="q">
            Action
          </label>
          <input id="q" name="q" defaultValue={searchParams.q} placeholder="e.g. refund" />
        </div>
        <div>
          <label className="field-label" htmlFor="entity">
            Record type
          </label>
          <select id="entity" name="entity" defaultValue={searchParams.entity ?? ''}>
            <option value="">Any</option>
            {entities.map(({ e }) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="outcome">
            Outcome
          </label>
          <select id="outcome" name="outcome" defaultValue={searchParams.outcome ?? ''}>
            <option value="">Any</option>
            <option value="success">Success</option>
            <option value="denied">Denied</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="actor">
            By
          </label>
          <input id="actor" name="actor" defaultValue={searchParams.actor} placeholder="email" />
        </div>
        <div>
          <label className="field-label" htmlFor="from">
            From
          </label>
          <input id="from" type="date" name="from" defaultValue={searchParams.from} />
        </div>
        <div>
          <label className="field-label" htmlFor="to">
            To
          </label>
          <input id="to" type="date" name="to" defaultValue={searchParams.to} />
        </div>
        <div className="col-span-2 md:col-span-6 flex gap-2">
          <button type="submit" className="crm-btn crm-btn-primary">
            Apply
          </button>
          <Link href="/admin/audit" className="crm-btn">
            Reset
          </Link>
        </div>
      </form>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No matching entries" />
        ) : (
          <div className="crm-table-wrap -mx-5 md:-mx-6 -my-5 md:-my-6">
            <table className="crm-table min-w-[900px]">
              <caption className="sr-only">Audit log</caption>
              <thead>
                <tr>
                  <th scope="col">When (ET)</th>
                  <th scope="col">By</th>
                  <th scope="col">Action</th>
                  <th scope="col">Record</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const link = r.entity_id && ENTITY_LINKS[r.entity_type] ? `${ENTITY_LINKS[r.entity_type]}${r.entity_id}` : null;
                  return (
                    <tr key={r.id}>
                      <td className="text-xs whitespace-nowrap">{formatInstantEt(r.created_at)}</td>
                      <td className="text-xs break-all">{r.actor_email ?? 'system'}</td>
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
                        {r.before_data !== null && <div>before: {short(r.before_data)}</div>}
                        {r.after_data !== null && <div>after: {short(r.after_data)}</div>}
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
