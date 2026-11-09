import Link from 'next/link';
import { Suspense } from 'react';
import { Logo } from '@/components/logo';
import { logout } from '@/app/actions/auth';
import { load, type Me } from '@/lib/data';
import { NavLink } from './nav-link';
import { LogOutIcon } from '@/components/icons';

async function Who({ next }: { next: string }) {
  const me = await load<Me>('/me', next);
  return (
    <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-sm md:block md:p-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-muted" title={me.email ?? ''}>{me.email ?? 'Local account'}</p>
        {me.role === 'admin' && <Link href="/admin" className="inline-flex min-h-9 items-center text-sm text-brand hover:underline md:mt-1">Admin console</Link>}
      </div>
      <form action={logout} className="shrink-0 md:mt-2 md:border-t md:border-line md:pt-2">
        <button className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-muted hover:bg-card hover:text-fg md:-mx-2 md:w-[calc(100%+1rem)]"><LogOutIcon /> Sign out</button>
      </form>
    </div>
  );
}

export function AppShell({ nav, base, children }: { nav: [string, string][]; base: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[240px_1fr]">
      <aside className="flex flex-col border-b border-line bg-bg2 md:sticky md:top-0 md:h-dvh md:border-b-0 md:border-r">
        <div className="flex items-center justify-between p-4"><Link href="/" aria-label="TrustCode home" className="inline-flex min-h-11 items-center"><Logo /></Link>
          {base === '/admin' && <span className="rounded bg-brand/15 px-2 py-0.5 text-xs text-brand">Admin</span>}</div>
        <nav aria-label="Account" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible">
          <Suspense fallback={nav.map(([href, label]) => <Link key={href} href={href} className="flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm text-muted">{label}</Link>)}>
            {nav.map(([href, label]) => <NavLink key={href} href={href} exact={href === base}>{label}</NavLink>)}
          </Suspense>
        </nav>
        <Suspense fallback={<div className="h-20 border-t border-line" />}><Who next={base} /></Suspense>
      </aside>
      <main id="main" className="min-w-0 p-5 md:p-10">{children}</main>
    </div>
  );
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return <header className="mb-8"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{children && <p className="mt-1 text-sm text-muted">{children}</p>}</header>;
}

export function Skeleton({ h = 'h-40' }: { h?: string }) { return <div className={`card ${h} animate-pulse`} aria-busy="true" />; }

export function StatusBadge({ s }: { s: string }) {
  const c = s === 'open' ? 'bg-info/15 text-info' : s === 'pending' ? 'bg-warn/15 text-warn' : s === 'resolved' || s === 'done' ? 'bg-ok/15 text-ok'
    : s === 'failed' || s === 'suspended' ? 'bg-err/15 text-err' : 'bg-card2 text-muted';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{s}</span>;
}
