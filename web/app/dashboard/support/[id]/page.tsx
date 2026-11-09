import Link from 'next/link';
import { Suspense } from 'react';
import { Skeleton } from '@/components/app/shell';
import { TicketThread } from '@/components/app/ticket-thread';
import { ReplyForm } from '@/components/app/forms';
import { load, type Ticket } from '@/lib/data';

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await load<Ticket>(`/support/tickets/${encodeURIComponent(id)}`, `/dashboard/support/${id}`);
  return (<><TicketThread t={t} /><div className="mt-6"><ReplyForm id={t.id} closed={t.status === 'closed'} /></div></>);
}

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="max-w-3xl">
      <Link href="/dashboard/support" className="text-sm text-brand">← All tickets</Link>
      <div className="mt-4"><Suspense fallback={<Skeleton h="h-64" />}><Detail params={params} /></Suspense></div>
    </div>
  );
}
