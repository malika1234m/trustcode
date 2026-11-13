import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, PageHero } from '@/components/site';
import { INSTALL_LABEL, INSTALL_URL } from '@/lib/config';
import { getPlans, type Plan } from '@/lib/plans';
import { CheckIcon, MinusIcon } from '@/components/icons';

export const metadata: Metadata = { title: 'Pricing', description: 'Analysis on your computer is free, not metered and needs no account. Plans apply to the optional TrustCode server.', alternates: { canonical: '/pricing' } };

const yes = <><CheckIcon className="h-4 w-4 text-ok" label="Included" /></>;
const no = <><MinusIcon className="h-4 w-4 text-dim" label="Not included" /></>;
const ROWS: [string, (p: Plan) => React.ReactNode][] = [
  ['Server verifications per month', (p) => (p.limits.verifications_per_month == null ? 'Unlimited' : String(p.limits.verifications_per_month))],
  ['Languages', (p) => (p.features.languages as string[]).map((l) => l[0].toUpperCase() + l.slice(1)).join(', ')],
  ['Security, lint, syntax & dependency checks', (p) => (p.features.syntax_lint_security_dependencies ? yes : no)],
  ['Sandboxed unit tests', (p) => String(p.features.sandboxed_tests)],
  ['Explanation levels', (p) => (p.features.explanation_levels ? yes : no)],
  ['Server history retention', (p) => `${p.limits.history_days} days`],
  ['AI-worded explanations', (p) => (p.features.llm_explanations ? yes : no)],
  ['Support', (p) => String(p.features.support)],
];

export default async function Pricing() {
  const data = await getPlans();
  return (
    <>
      <PageHero eyebrow="Pricing" title="Free on your computer">Analysis on your computer is free, is not metered and needs no account. The plans below apply only to the optional TrustCode server. Paid plans are planned: no payment provider is connected, no prices are set and every account is Free.</PageHero>
      <Container>
        {!data ? (
          <p className="card p-6 text-center text-muted">Plan details are temporarily unavailable. Please try again shortly.</p>
        ) : (
          <>
            <div className="grid gap-5 md:grid-cols-3">
              {data.plans.map((p) => (
                <div key={p.id} className={`card relative flex flex-col p-7 ${p.status === 'available' ? 'ring-1 ring-brand/60' : ''}`}>
                  {p.status === 'available' && <span className="absolute -top-3 left-7 rounded-full bg-gradient-to-r from-brand to-brand2 px-3 py-0.5 text-xs font-semibold text-white">Available now</span>}
                  <h2 className="text-lg font-semibold">{p.name}</h2>
                  <p className="mt-1 text-sm text-muted">{p.tagline}</p>
                  <p className="mt-5 text-4xl font-semibold">{p.status === 'available' ? '$0' : <span className="text-2xl text-muted">Planned</span>}</p>
                  <p className="mt-1 text-xs text-dim">{p.status === 'available' ? 'No credit card required' : 'Pricing not yet announced'}</p>
                  <ul className="mt-6 flex-1 space-y-2 text-sm text-muted">
                    {ROWS.map(([label, fn]) => <li key={label} className="flex items-center gap-2"><span className="text-fg">{fn(p)}</span><span>{label}</span></li>)}
                  </ul>
                  {p.status === 'available'
                    ? <a href={INSTALL_URL} className="btn btn-primary mt-7">{INSTALL_LABEL}</a>
                    : <Link href="/contact?category=feature" className="btn btn-ghost mt-7">Tell us you’re interested</Link>}
                </div>
              ))}
            </div>
            <div className="card mt-10 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="sr-only">Plan comparison</caption>
                <thead><tr className="border-b border-line"><th className="p-4 font-medium text-muted">Feature</th>{data.plans.map((p) => <th key={p.id} className="p-4 font-semibold">{p.name}</th>)}</tr></thead>
                <tbody>{ROWS.map(([label, fn]) => <tr key={label} className="border-b border-line/60 last:border-0"><td className="p-4 text-muted">{label}</td>{data.plans.map((p) => <td key={p.id} className="p-4">{fn(p)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </>
        )}
        <div className="mx-auto mt-14 max-w-3xl space-y-4">
          {[
            ['Will the Free plan stay?', 'Yes. A free tier is part of the plan; limits may change with notice.'],
            ['Do I need an account?', 'No. The Security, Verify and Session tabs run on your computer without one. An account is only for server analysis, if you choose it, or a paid plan once plans are on sale.'],
            ['What happens at the monthly limit?', 'The limit applies to server analysis only; local analysis is not metered. On the server, new verifications pause until the next month and results you already have stay available.'],
            ['How will payment work?', 'When paid plans launch, checkout will be handled by a Merchant of Record that takes care of payments, invoices and sales tax. TrustCode never stores card details.'],
          ].map(([q, a]) => <div key={q} className="card p-5"><h3 className="font-semibold">{q}</h3><p className="mt-1 text-sm text-muted">{a}</p></div>)}
        </div>
      </Container>
    </>
  );
}
