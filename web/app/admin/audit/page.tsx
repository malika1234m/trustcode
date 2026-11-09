import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageTitle, Skeleton } from '@/components/app/shell';
import { load, fmtTime } from '@/lib/data';

export const metadata: Metadata = { title: 'Audit log' };
type A = { action: string; user_id: string | null; created_at: string; request_id: string | null };

async function Log() {
  const { items } = await load<{ items: A[] }>('/admin/audit?limit=100', '/admin/audit');
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-xs uppercase tracking-wide text-dim"><tr>{['When', 'Action', 'User', 'Request'].map((h) => <th key={h} className="p-4 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">
          {items.map((a, i) => <tr key={i}><td className="whitespace-nowrap p-4 tabular-nums">{fmtTime(a.created_at)}</td><td className="p-4 font-mono text-xs">{a.action}</td>
            <td className="p-4 font-mono text-xs text-dim">{a.user_id ?? '—'}</td><td className="p-4 font-mono text-xs text-dim">{a.request_id ?? '—'}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

export default function Audit() {
  return (<><PageTitle title="Audit log">Security-relevant events. No code or message content is recorded here.</PageTitle><Suspense fallback={<Skeleton h="h-80" />}><Log /></Suspense></>);
}
