import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, PageHero } from '@/components/site';
import { ContactForm } from '@/components/forms/contact-form';

export const metadata: Metadata = { title: 'Contact & support', description: 'Questions, bug reports, feature requests and account help.', alternates: { canonical: '/contact' } };

export default function Contact() {
  return (
    <>
      <PageHero eyebrow="Support" title="How can we help?">Signed-in users can track replies in the <Link href="/dashboard/support" className="text-brand">dashboard</Link>.</PageHero>
      <Container className="grid max-w-5xl gap-8 md:grid-cols-[1fr_1.4fr]">
        <div className="space-y-4">
          {[['Docs first', 'Most answers are in the documentation and troubleshooting guide.', '/docs/troubleshooting'], ['Report a bug', 'Include the TrustCode version, what you selected (or a similar example) and what you expected.', null], ['Account & privacy', 'Sign-in problems, data deletion or privacy questions.', null]].map(([t, d, h]) => (
            <div key={t as string} className="card p-5"><h2 className="font-semibold">{t}</h2><p className="mt-1 text-sm text-muted">{d}</p>{h && <Link href={h} className="mt-1 inline-flex min-h-11 items-center text-sm text-brand hover:underline">Open the troubleshooting guide</Link>}</div>
          ))}
        </div>
        <ContactForm />
      </Container>
    </>
  );
}
