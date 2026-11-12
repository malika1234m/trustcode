import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, PageHero } from '@/components/site';
import { StatusBadge } from '@/components/landing/badges';
import { ROADMAP, STATUS_HELP, type Status } from '@/lib/capabilities';

export const metadata: Metadata = {
  title: 'Roadmap',
  description: 'What TrustCode can do today, what is in development and what is coming soon.',
  alternates: { canonical: '/roadmap' },
};

export default function RoadmapPage() {
  return (
    <>
      <PageHero title="Roadmap and availability">A feature is marked Available only once it has shipped and been tested.</PageHero>
      <Container className="py-14">
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          {(['available', 'in-development', 'planned'] as Status[]).map((s) => <li key={s} className="flex items-center gap-2"><StatusBadge status={s} />{STATUS_HELP[s]}</li>)}
        </ul>
        <div className="mt-10 gap-x-12 lg:columns-2">
          {ROADMAP.map((g) => (
            <section key={g.group} aria-labelledby={`g-${g.group}`} className="mb-12 break-inside-avoid">
              <h2 id={`g-${g.group}`} className="text-xl font-semibold">{g.group}</h2>
              <ul className="mt-3 divide-y divide-line/70 border-y border-line/70">
                {g.items.map((c) => (
                  <li key={c.name} className="flex items-start justify-between gap-4 py-3.5">
                    <div className="min-w-0"><p className="font-medium">{c.name}</p><p className="mt-0.5 text-sm text-muted">{c.detail}</p></div>
                    <StatusBadge status={c.status} className="mt-0.5 shrink-0" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <Link href="/changelog" className="inline-flex min-h-11 items-center text-sm font-medium text-brand hover:underline">Release notes</Link>
      </Container>
    </>
  );
}
