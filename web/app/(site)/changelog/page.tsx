import type { Metadata } from 'next';
import { Container, PageHero } from '@/components/site';
import { releases } from '@/lib/changelog';

export const metadata: Metadata = { title: 'Changelog', description: 'What changed in each TrustCode release.', alternates: { canonical: '/changelog' } };

export default function Changelog() {
  return (
    <>
      <PageHero eyebrow="Changelog" title="Release notes" />
      <Container className="max-w-3xl space-y-6">
        {releases().map((r) => (
          <section key={r.version} className="card p-7">
            <h2 className="text-xl font-semibold">Version {r.version}</h2>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-muted">{r.items.map((i) => <li key={i}>• {i}</li>)}</ul>
          </section>
        ))}
      </Container>
    </>
  );
}
