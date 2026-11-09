import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, PageHero } from '@/components/site';
import { DOCS } from '@/lib/docs';

export const metadata: Metadata = { title: 'Documentation', description: 'Guides for installing, configuring and using TrustCode.', alternates: { canonical: '/docs' } };

export default function Docs() {
  const sections = [...new Set(DOCS.map((d) => d.section))];
  return (
    <>
      <PageHero eyebrow="Documentation" title="Learn TrustCode" />
      <Container className="max-w-5xl space-y-12">
        {sections.map((s) => (
          <section key={s}>
            <h2 className="text-sm font-semibold uppercase tracking-[.15em] text-dim">{s}</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {DOCS.filter((d) => d.section === s).map((d) => (
                <Link key={d.slug} href={`/docs/${d.slug}`} className="card p-5 transition hover:border-brand">
                  <h3 className="font-semibold">{d.title}</h3><p className="mt-1 text-sm text-muted">{d.summary}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </Container>
    </>
  );
}
