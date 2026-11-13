import Link from 'next/link';
import { Suspense } from 'react';
import { PageTitle, Skeleton } from '@/components/app/shell';
import { load, fmtDate, type Entitlements } from '@/lib/data';
import { INSTALL_URL, INSTALL_LABEL } from '@/lib/config';

const LANG: Record<string, string> = { python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript' };

async function Plan() {
  const e = await load<Entitlements>('/me/entitlements');
  const lim = e.limits.verifications_per_month;
  const used = e.usage.verifications_this_month;
  const pct = lim ? Math.min(100, Math.round((used / lim) * 100)) : 0;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <section className="card p-6 lg:col-span-2" aria-labelledby="usage">
        <div className="flex items-baseline justify-between"><h2 id="usage" className="font-semibold">Verifications this month</h2>
          <span className="text-xs text-dim">Resets {fmtDate(e.usage.resets_at)}</span></div>
        <p className="mt-4 text-4xl font-semibold tabular-nums">{used}<span className="text-lg text-dim">{lim ? ` / ${lim}` : ''}</span></p>
        {lim && <div className="mt-4 h-2 overflow-hidden rounded-full bg-card2" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={lim} aria-label="Monthly usage">
          <div className={`h-full rounded-full ${pct >= 90 ? 'bg-warn' : 'bg-gradient-to-r from-brand to-brand2'}`} style={{ width: `${pct}%` }} /></div>}
        <p className="mt-3 text-sm text-muted">{e.usage.remaining === null ? 'Unlimited.' : `${e.usage.remaining} remaining.`}</p>
      </section>
      <section className="card p-6" aria-labelledby="plan">
        <h2 id="plan" className="font-semibold">Plan</h2>
        <p className="mt-4 text-2xl font-semibold">{e.plan.name}</p>
        <ul className="mt-3 space-y-1 text-sm text-muted">
          <li>Up to {e.limits.max_code_chars.toLocaleString('en-GB')} characters per check</li>
          <li>History kept up to {e.limits.history_days} days</li>
          <li>{(e.features.languages ?? []).map((l) => LANG[l] ?? l).join(', ')}</li>
        </ul>
        <Link href="/pricing" className="mt-3 inline-flex min-h-11 items-center text-sm text-brand hover:underline">Compare plans</Link>
      </section>
    </div>
  );
}

export default function Overview() {
  return (
    <>
      <PageTitle title="Overview">Your plan, usage and quick links.</PageTitle>
      <Suspense fallback={<Skeleton h="h-52" />}><Plan /></Suspense>
      <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {[['Use it in VS Code', 'Analysis runs on your computer without an account. Sign in from the Account tab only for account features or server analysis.', INSTALL_URL, INSTALL_LABEL],
          ['Read your results', 'What each check means, and why “Not verified” matters.', '/docs/reading-results', 'Open guide'],
          ['Need help?', 'Open a support ticket and track replies here.', '/dashboard/support', 'Support']].map(([t, d, h, l]) => (
          <div key={t} className="card p-6"><h2 className="font-semibold">{t}</h2><p className="mt-1 text-sm text-muted">{d}</p>
            <a href={h} className="mt-2 inline-flex min-h-11 items-center text-sm text-brand hover:underline">{l}</a></div>
        ))}
      </div>
    </>
  );
}
