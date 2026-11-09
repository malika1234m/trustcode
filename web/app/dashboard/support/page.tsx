import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageTitle, Skeleton, StatusBadge } from '@/components/app/shell';
import { ContactForm } from '@/components/forms/contact-form';
import { load, fmtDate, type Ticket } from '@/lib/data';
import { Pagination, pageFrom } from '@/components/app/pagination';

const SIZE = 10;
type SP = Promise<{ page?: string }>;

export const metadata: Metadata = { title: 'Support' };

async function Tickets({ searchParams }: { searchParams: SP }) {
  const page = pageFrom((await searchParams).page);
  const { items, total } = await load<{ items: Ticket[]; total: number }>(`/support/tickets?limit=${SIZE}&offset=${(page - 1) * SIZE}`, '/dashboard/support');
  if (!items.length && page === 1) return <p className="card p-6 text-sm text-muted">No tickets yet.</p>;
  return (
    <>
    <ul className="card divide-y divide-line">
      {items.map((t) => (
        <li key={t.id}><Link href={`/dashboard/support/${t.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-card2">
          <span className="min-w-0"><span className="block truncate font-medium">{t.subject}</span><span className="text-xs text-dim">{t.category} · {fmtDate(t.created_at)}</span></span>
          <StatusBadge s={t.status} /></Link></li>
      ))}
    </ul>
    <Pagination basePath="/dashboard/support" page={page} pageSize={SIZE} total={total} label="tickets" />
    </>
  );
}

export default function Support({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageTitle title="Support">Questions, bugs and account help. Replies appear here.</PageTitle>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section aria-label="Your tickets"><Suspense fallback={<Skeleton />}><Tickets searchParams={searchParams} /></Suspense></section>
        <section aria-label="New ticket"><ContactForm signedIn /></section>
      </div>
    </>
  );
}
