import { Suspense } from 'react';
import { PageTitle, Skeleton } from '@/components/app/shell';
import { load } from '@/lib/data';

type Overview = { users_total: number; users_new_7d: number; users_suspended: number; active_users_30d: number; verifications_this_month: number; tickets_open: number; billing_live: boolean };

async function Stats() {
  const o = await load<Overview>('/admin/overview', '/admin');
  const tiles: [string, number][] = [['Users', o.users_total], ['New (7 days)', o.users_new_7d], ['Active (30 days)', o.active_users_30d],
    ['Verifications this month', o.verifications_this_month], ['Open tickets', o.tickets_open], ['Suspended', o.users_suspended]];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(([l, v]) => <div key={l} className="card p-5"><p className="text-sm text-muted">{l}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{v}</p></div>)}
      </div>
      <p className="mt-6 text-sm text-dim">Billing: {o.billing_live ? 'live' : 'not enabled — all users are on the Free plan. Revenue metrics will appear once a payment provider is connected.'}</p>
    </>
  );
}

export default function AdminHome() {
  return (<><PageTitle title="Overview">Live counts from the TrustCode API.</PageTitle><Suspense fallback={<Skeleton h="h-60" />}><Stats /></Suspense></>);
}
