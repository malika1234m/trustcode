import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Container, PageHero } from '@/components/site';
import { LEGAL } from '@/lib/legal';

export function generateStaticParams() { return Object.keys(LEGAL).map((slug) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = LEGAL[(await params).slug];
  return d ? { title: d.title, alternates: { canonical: `/legal/${(await params).slug}` } } : {};
}
export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const d = LEGAL[(await params).slug];
  if (!d) notFound();
  return (<><PageHero eyebrow="Legal" title={d.title} /><Container className="prose-tc max-w-3xl space-y-3">{d.body}</Container></>);
}
