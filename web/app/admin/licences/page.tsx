import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageTitle, Skeleton, StatusBadge } from '@/components/app/shell';
import { LicencePolicyForm } from '@/components/app/forms';
import { adminLicenceDevice } from '@/app/actions/account';
import { load, fmtDate, fmtTime } from '@/lib/data';
import { Pagination, pageFrom } from '@/components/app/pagination';

export const metadata: Metadata = { title: 'Licences' };
type D = { id: string; name: string; platform: string | null; status: string; activated_at: string; last_validated_at: string | null; user_id: string; email: string | null; suspended: boolean };
type Ev = { event: string; detail: string | null; device: string | null; user_id: string | null; created_at: string };
type SP = Promise<{ q?: string; page?: string; status?: string; user?: string }>;
const ID = /^[a-f0-9]{32}$/;

function DeviceAction({ d }: { d: { id: string; status: string; name: string } }) {
  if (d.status === 'deactivated') return null;
  const revoke = d.status !== 'revoked';
  return (
    <form action={adminLicenceDevice}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="action" value={revoke ? 'revoke' : 'restore'} />
      <button aria-label={`${revoke ? 'Revoke' : 'Restore'} ${d.name}`}
        className={`min-h-9 rounded-lg border px-3 text-xs font-medium ${revoke ? 'border-err/40 text-err hover:bg-err/10' : 'border-ok/40 text-ok hover:bg-ok/10'}`}>{revoke ? 'Revoke' : 'Restore'}</button></form>
  );
}

function EventTable({ items, empty }: { items: Ev[]; empty: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-xs text-dim"><tr>{['When', 'Event', 'Detail', 'Account'].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{items.map((e, i) => (
          <tr key={i}><td className="whitespace-nowrap p-3">{fmtTime(e.created_at)}</td><td className="p-3">{e.event.replace(/_/g, ' ')}</td>
            <td className="p-3 text-muted">{e.detail ?? '—'}</td>
            <td className="p-3">{e.user_id ? <Link href={`/admin/licences?user=${e.user_id}`} className="font-mono text-xs">{e.user_id.slice(0, 8)}</Link> : '—'}</td></tr>))}
        </tbody>
      </table>
      {!items.length && <p className="p-6 text-center text-sm text-muted">{empty}</p>}
    </div>
  );
}

async function Account({ id }: { id: string }) {
  const a = await load<{ user: { id: string; email: string | null; suspended: boolean }; plan: { name: string }; subscription_state: string;
    policy: { offline_grace_days: number; max_devices: number; override: { offline_grace_days: number | null; max_devices: number | null } };
    devices: Omit<D, 'user_id' | 'email' | 'suspended'>[]; events: Ev[] }>(`/admin/licences/users/${id}`, '/admin/licences');
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/admin/licences">← All devices</Link></p>
      <div className="card p-6">
        <h2 className="text-lg font-semibold">{a.user.email ?? a.user.id}</h2>
        <p className="mt-1 text-sm text-muted">{a.plan.name} plan ({a.subscription_state.replace(/_/g, ' ')}) · offline up to {a.policy.offline_grace_days} days · up to {a.policy.max_devices} devices
          {a.user.suspended && <> · <StatusBadge s="suspended" /></>}</p>
        <ul className="mt-4 divide-y divide-line">{a.devices.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{d.name} <StatusBadge s={d.status} /></p>
            <p className="text-xs text-dim">{d.platform ?? '—'} · activated {fmtDate(d.activated_at)} · last checked {d.last_validated_at ? fmtTime(d.last_validated_at) : 'never'}</p></div>
            <DeviceAction d={d} /></li>))}</ul>
        {!a.devices.length && <p className="mt-4 text-sm text-muted">No devices.</p>}
      </div>
      <LicencePolicyForm user={a.user.id} grace={a.policy.override.offline_grace_days} devices={a.policy.override.max_devices} />
      <h2 className="text-lg font-semibold">Validation history</h2>
      <EventTable items={a.events} empty="No licence activity yet." />
    </div>
  );
}

async function Overview({ searchParams }: { searchParams: SP }) {
  const { q = '', page = '1', status = '' } = await searchParams;
  const p = pageFrom(page);
  const st = ['active', 'deactivated', 'revoked'].includes(status) ? status : '';
  const data = await load<{ configured: boolean; total: number; active_total: number; items: D[] }>(
    `/admin/licences?limit=25&offset=${(p - 1) * 25}${q ? `&q=${encodeURIComponent(q.slice(0, 254))}` : ''}${st ? `&status=${st}` : ''}`, '/admin/licences');
  const sus = await load<{ items: Ev[]; frequent_activations_7d: { user_id: string; activations: number }[] }>('/admin/licences/events?suspicious=true&limit=20', '/admin/licences');
  return (
    <div className="space-y-6">
      {!data.configured && <p className="card border-warn/40 p-4 text-sm text-warn">Licence signing is not configured on the server (TRUSTCODE_LICENCE_SIGNING_KEY). Devices cannot be activated.</p>}
      <p className="text-sm text-muted">{data.active_total} active devices.</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs text-dim"><tr>{['Account', 'Device', 'Activated', 'Last checked', 'Status', ''].map((h) => <th key={h} className="p-4 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{data.items.map((d) => (
            <tr key={d.id}>
              <td className="max-w-[14rem] truncate p-4"><Link href={`/admin/licences?user=${d.user_id}`}>{d.email ?? d.user_id}</Link></td>
              <td className="p-4">{d.name}<span className="block text-xs text-dim">{d.platform ?? '—'}</span></td>
              <td className="p-4">{fmtDate(d.activated_at)}</td><td className="p-4">{d.last_validated_at ? fmtTime(d.last_validated_at) : 'never'}</td>
              <td className="p-4"><StatusBadge s={d.suspended ? 'suspended' : d.status} /></td><td className="p-4 text-right"><DeviceAction d={d} /></td>
            </tr>))}
          </tbody>
        </table>
        {!data.items.length && <p className="p-6 text-center text-sm text-muted">No devices match.</p>}
      </div>
      <Pagination basePath="/admin/licences" params={{ q, status: st }} page={p} pageSize={25} total={data.total} label="devices" />
      <h2 className="text-lg font-semibold">Suspicious activity</h2>
      {!!sus.frequent_activations_7d.length && (
        <p className="text-sm text-warn">Frequent activations in the last 7 days: {sus.frequent_activations_7d.map((f, i) => (
          <span key={f.user_id}>{i ? ', ' : ''}<Link href={`/admin/licences?user=${f.user_id}`} className="font-mono text-xs">{f.user_id.slice(0, 8)}</Link> ({f.activations})</span>))}</p>)}
      <EventTable items={sus.items} empty="No rejected or refused licence requests." />
    </div>
  );
}

async function Body({ searchParams }: { searchParams: SP }) {
  const { user } = await searchParams;
  if (user && ID.test(user)) return <Account id={user} />;
  return (
    <>
      <form className="mb-5 flex max-w-xl flex-wrap gap-2" role="search">
        <input name="q" placeholder="Search email or user id" aria-label="Search accounts" className="input mt-0 min-w-0 flex-1" />
        <select name="status" aria-label="Device status" className="input mt-0 w-auto"><option value="">All</option><option value="active">Active</option><option value="deactivated">Signed out</option><option value="revoked">Revoked</option></select>
        <button className="btn btn-ghost">Search</button></form>
      <Overview searchParams={searchParams} />
    </>
  );
}

export default function Licences({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageTitle title="Licences">Devices signed in to accounts. Revoking a device stops its licence refreshing; it keeps paid features only until its current offline period ends. Every action is logged.</PageTitle>
      <Suspense fallback={<Skeleton h="h-80" />}><Body searchParams={searchParams} /></Suspense>
    </>
  );
}
