import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageTitle, Skeleton, StatusBadge } from '@/components/app/shell';
import { adminUserAction } from '@/app/actions/account';
import { load, fmtDate } from '@/lib/data';
import { Pagination, pageFrom } from '@/components/app/pagination';

export const metadata: Metadata = { title: 'Users' };
type U = { id: string; email: string | null; role: string; suspended: boolean; created_at: string; plan: string; verifications_this_month: number };
type SP = Promise<{ q?: string; page?: string }>;

async function Table({ searchParams }: { searchParams: SP }) {
  const { q = '', page = '1' } = await searchParams;
  const p = pageFrom(page);
  const data = await load<{ total: number; items: U[] }>(`/admin/users?limit=25&offset=${(p - 1) * 25}${q ? `&q=${encodeURIComponent(q.slice(0, 254))}` : ''}`, '/admin/users');
  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-dim"><tr>{['Email', 'Role', 'Plan', 'This month', 'Joined', 'Status', ''].map((h) => <th key={h} className="p-4 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {data.items.map((u) => (
              <tr key={u.id}>
                <td className="max-w-[16rem] truncate p-4" title={u.id}>{u.email ?? '—'}</td><td className="p-4">{u.role}</td><td className="p-4 capitalize">{u.plan}</td>
                <td className="p-4 tabular-nums">{u.verifications_this_month}</td><td className="p-4">{fmtDate(u.created_at)}</td>
                <td className="p-4"><StatusBadge s={u.suspended ? 'suspended' : 'active'} /></td>
                <td className="p-4 text-right"><form action={adminUserAction}><input type="hidden" name="id" value={u.id} />
                  <input type="hidden" name="action" value={u.suspended ? 'restore' : 'suspend'} />
                  <button aria-label={`${u.suspended ? 'Restore' : 'Suspend'} ${u.email ?? u.id}`}
                    className={`min-h-9 rounded-lg border px-3 text-xs font-medium ${u.suspended ? 'border-ok/40 text-ok hover:bg-ok/10' : 'border-err/40 text-err hover:bg-err/10'}`}>{u.suspended ? 'Restore' : 'Suspend'}</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.items.length && <p className="p-6 text-center text-sm text-muted">No users match.</p>}
      </div>
      <Pagination basePath="/admin/users" params={{ q }} page={p} pageSize={25} total={data.total} label="users" />
    </>
  );
}

export default function Users({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageTitle title="Users">Suspending a user signs them out everywhere and blocks new sign-ins. It is logged in the audit log.</PageTitle>
      <form className="mb-5 flex max-w-md gap-2" role="search"><input name="q" placeholder="Search email or user id" aria-label="Search users" className="input mt-0" />
        <button className="btn btn-ghost">Search</button></form>
      <Suspense fallback={<Skeleton h="h-80" />}><Table searchParams={searchParams} /></Suspense>
    </>
  );
}
