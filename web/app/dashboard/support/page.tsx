import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageTitle, Skeleton, StatusBadge } from '@/components/app/shell';
import { ContactForm } from '@/components/forms/contact-form';
import { load, fmtDate, type Ticket } from '@/lib/data';

export const metadata: Metadata = { title: 'Support' };

async function Tickets() {
  const { items } = await load<{ items: Ticket[] }>('/support/tickets', '/dashboard/support');
  if (!items.length) return <p className="card p-6 text-sm text-muted">No tickets yet.</p>;
  return (
    <ul className="card divide-y divide-line">
      {items.map((t) => (
        <li key={t.id}><Link href={`/dashboard/support/${t.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-card2">
          <span className="min-w-0"><span className="block truncate font-medium">{t.subject}</span><span className="text-xs text-dim">{t.category} · {fmtDate(t.created_at)}</span></span>
          <StatusBadge s={t.status} /></Link></li>
      ))}
    </ul>
  );
}

export default function Support() {
  return (
    <>
      <PageTitle title="Support">Questions, bugs and account help. Replies appear here.</PageTitle>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section aria-label="Your tickets"><Suspense fallback={<Skeleton />}><Tickets /></Suspense></section>
        <section aria-label="New ticket"><ContactForm signedIn /></section>
      </div>
    </>
  );
}
