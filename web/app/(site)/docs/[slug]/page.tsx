import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Container } from '@/components/site';
import { DOCS, docBySlug } from '@/lib/docs';

export function generateStaticParams() { return DOCS.map((d) => ({ slug: d.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = docBySlug((await params).slug);
  return d ? { title: d.title, description: d.summary, alternates: { canonical: `/docs/${d.slug}` } } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const doc = docBySlug((await params).slug);
  if (!doc) notFound();
  return (
    <Container className="grid gap-8 py-10 md:grid-cols-[220px_1fr] md:gap-10 md:py-14">
      {/* Phones: the page list folds into one row so the article starts near the top. */}
      <details className="group rounded-xl border border-line bg-card/60 md:hidden">
        <summary className="flex min-h-12 items-center justify-between gap-3 px-4 text-sm">
          <span><span className="text-dim">Docs · </span><span className="font-medium text-fg">{doc.title}</span></span>
          <span aria-hidden="true" className="text-brand transition-transform group-open:rotate-180">▾</span>
        </summary>
        <ul className="border-t border-line p-2 text-sm">{DOCS.map((d) => (
          <li key={d.slug}><Link href={`/docs/${d.slug}`} aria-current={d.slug === doc.slug ? 'page' : undefined}
            className={`flex min-h-11 items-center rounded-md px-3 ${d.slug === doc.slug ? 'bg-card2 text-fg' : 'text-muted hover:text-fg'}`}>{d.title}</Link></li>))}
        </ul>
      </details>
      <nav aria-label="Documentation" className="hidden text-sm md:block">
        <ul className="space-y-1">{DOCS.map((d) => (
          <li key={d.slug}><Link href={`/docs/${d.slug}`} aria-current={d.slug === doc.slug ? 'page' : undefined}
            className={`block rounded-md px-3 py-1.5 ${d.slug === doc.slug ? 'bg-card2 text-fg' : 'text-muted hover:text-fg'}`}>{d.title}</Link></li>))}
        </ul>
      </nav>
      <article className="prose-tc min-w-0 max-w-3xl">
        <p className="text-sm text-dim">{doc.section}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="mt-2 text-lg">{doc.summary}</p>
        {doc.body}
        <p className="mt-10 text-sm">Still stuck? <Link href="/contact">Contact support</Link>.</p>
      </article>
    </Container>
  );
}
