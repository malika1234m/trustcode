import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageTitle, Skeleton, StatusBadge } from '@/components/app/shell';
import { load, fmtTime, type Ticket } from '@/lib/data';
import { Pagination, pageFrom } from '@/components/app/pagination';

export const metadata: Metadata = { title: 'Tickets' };
const FILTERS = ['open', 'pending', 'resolved', 'closed'];
type SP = Promise<{ status?: string; page?: string }>;
const SIZE = 25;

async function List({ searchParams }: { searchParams: SP }) {
  const { status, page: pg } = await searchParams;
  const page = pageFrom(pg);
  const s = status && FILTERS.includes(status) ? status : undefined;
  const { items, total } = await load<{ items: Ticket[]; total: number }>(`/admin/tickets?limit=${SIZE}&offset=${(page - 1) * SIZE}${s ? `&status=${s}` : ''}`, '/admin/tickets');
  return (
    <>
      <nav aria-label="Filter" className="mb-4 flex flex-wrap gap-2 text-sm">
        {[undefined, ...FILTERS].map((f) => <Link key={f ?? 'all'} href={f ? `/admin/tickets?status=${f}` : '/admin/tickets'} aria-current={f === s ? 'page' : undefined}
          className={`rounded-full border px-3 py-1 ${f === s ? 'border-brand text-fg' : 'border-line text-muted hover:text-fg'}`}>{f ?? 'all'}</Link>)}
      </nav>
      {items.length ? (
        <ul className="card divide-y divide-line">
          {items.map((t) => (
            <li key={t.id}><Link href={`/admin/tickets/${t.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-card2">
              <span className="min-w-0"><span className="block truncate font-medium">{t.subject}</span>
                <span className="text-xs text-dim">{t.category} · {t.email} · updated {fmtTime(t.updated_at)}{t.assignee_id ? ' · assigned' : ''}</span></span>
              <StatusBadge s={t.status} /></Link></li>
          ))}
        </ul>) : <p className="card p-6 text-sm text-muted">No tickets{s ? ` with status “${s}”` : ''}.</p>}
      <Pagination basePath="/admin/tickets" params={{ status: s }} page={page} pageSize={SIZE} total={total} label="tickets" />
    </>
  );
}

export default function Tickets({ searchParams }: { searchParams: SP }) {
  return (<><PageTitle title="Support tickets" /><Suspense fallback={<Skeleton h="h-80" />}><List searchParams={searchParams} /></Suspense></>);
}
