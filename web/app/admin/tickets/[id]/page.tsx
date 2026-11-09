import Link from 'next/link';
import { Suspense } from 'react';
import { Skeleton } from '@/components/app/shell';
import { TicketThread } from '@/components/app/ticket-thread';
import { ReplyForm } from '@/components/app/forms';
import { adminTicketUpdate } from '@/app/actions/account';
import { load, type Ticket } from '@/lib/data';

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Admin-only list first so non-admins get 404 here even for their own ticket id.
  await load('/admin/overview', `/admin/tickets/${id}`);
  const t = await load<Ticket>(`/support/tickets/${encodeURIComponent(id)}`, `/admin/tickets/${id}`);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <div><TicketThread t={t} /><div className="mt-6"><ReplyForm id={t.id} closed={t.status === 'closed'} /></div></div>
      <aside className="card h-fit space-y-4 p-5">
        <form action={adminTicketUpdate}><input type="hidden" name="id" value={t.id} />
          <label className="label mt-0" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={t.status} className="input">{['open', 'pending', 'resolved', 'closed'].map((s) => <option key={s}>{s}</option>)}</select>
          <button className="btn btn-primary mt-3 w-full">Update</button></form>
        {!t.assignee_id && <form action={adminTicketUpdate}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="assign" value="1" />
          <button className="btn btn-ghost w-full">Assign to me</button></form>}
        {t.assignee_id && <p className="text-xs text-dim">Assigned.</p>}
      </aside>
    </div>
  );
}

export default function AdminTicket({ params }: { params: Promise<{ id: string }> }) {
  return (<><Link href="/admin/tickets" className="text-sm text-brand">← All tickets</Link>
    <div className="mt-4"><Suspense fallback={<Skeleton h="h-64" />}><Detail params={params} /></Suspense></div></>);
}
