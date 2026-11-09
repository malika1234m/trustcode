import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageTitle, Skeleton, StatusBadge } from '@/components/app/shell';
import { load, fmtTime } from '@/lib/data';

export const metadata: Metadata = { title: 'History' };
type Job = { id: string; status: string; language: string | null; code_lines: number; created_at: string; error: string | null };

async function Rows({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const q = cursor && /^[A-Za-z0-9_-]{1,64}$/.test(cursor) ? `&cursor=${cursor}` : '';
  const page = await load<{ items: Job[]; next_cursor: string | null }>(`/verifications?limit=25${q}`, '/dashboard/history');
  if (!page.items.length) return <div className="card p-10 text-center text-muted">No verifications {cursor ? 'on this page' : 'yet'}. Select code in VS Code and run <strong>TrustCode: Verify Selection</strong>.</div>;
  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-dim"><tr><th className="p-4 font-medium">When</th><th className="p-4 font-medium">Language</th><th className="p-4 font-medium">Lines</th><th className="p-4 font-medium">Status</th></tr></thead>
          <tbody className="divide-y divide-line">
            {page.items.map((j) => (
              <tr key={j.id}><td className="p-4 tabular-nums">{fmtTime(j.created_at)}</td><td className="p-4 capitalize">{j.language ?? '—'}</td>
                <td className="p-4 tabular-nums">{j.code_lines}</td><td className="p-4"><StatusBadge s={j.status} />{j.error && <span className="ml-2 text-xs text-dim">{j.error}</span>}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex gap-4 text-sm">
        {cursor && <Link href="/dashboard/history" className="text-brand">← Newest</Link>}
        {page.next_cursor && <Link href={`/dashboard/history?cursor=${page.next_cursor}`} className="text-brand">Older →</Link>}
      </div>
    </>
  );
}

export default function History({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  return (
    <>
      <PageTitle title="History">Results are kept for 24 hours, or 30 days if history is on in Settings. Your code itself is never stored.</PageTitle>
      <Suspense fallback={<Skeleton h="h-72" />}><Rows searchParams={searchParams} /></Suspense>
    </>
  );
}
