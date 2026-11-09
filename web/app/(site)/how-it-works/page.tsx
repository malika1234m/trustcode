import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, PageHero } from '@/components/site';
import { INSTALL_LABEL, INSTALL_URL } from '@/lib/config';

export const metadata: Metadata = { title: 'How it works', description: 'From installing the VS Code extension to verifying your first AI-generated snippet.', alternates: { canonical: '/how-it-works' } };

const STEPS = [
  ['Install the extension', 'Download TrustCode for VS Code (Marketplace listing coming soon). It appears as a shield icon in the activity bar.'],
  ['Sign in with your browser', 'Click “Sign In with browser”. Log in or create a free account on this website; your browser returns you to VS Code. Your password is never entered in the editor. Prefer to keep code on your machine? Choose local mode and run your own backend.'],
  ['Select AI-generated code', 'Select Python, JavaScript or TypeScript in the editor, then right-click → “TrustCode: Verify Selected Code”.'],
  ['Describe the task (optional)', 'Tell TrustCode what the code should do and paste unit tests that import the selection as solution. On a self-hosted server the tests run in a sandbox.'],
  ['Confirm and verify', 'A consent dialog shows exactly what will be sent and where. Independent checks run; results usually arrive within a few seconds.'],
  ['Read the evidence', 'A headline summarises findings and gaps. Each finding shows where, why it matters, the raw tool evidence and the next step; “Not verified” lists what no check covered.'],
  ['Decide', 'Accept, modify or reject with a confidence rating. TrustCode never edits your files.'],
];

export default function HowItWorks() {
  return (
    <>
      <PageHero eyebrow="How it works" title="From install to an informed decision" />
      <Container className="max-w-3xl">
        <ol className="relative space-y-8 border-l border-line pl-8">
          {STEPS.map(([t, d], i) => (
            <li key={t}>
              <span className="absolute -left-4 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand2 text-sm font-bold text-white">{i + 1}</span>
              <h2 className="text-lg font-semibold">{t}</h2><p className="mt-1 leading-7 text-muted">{d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-12 flex flex-wrap gap-3"><a href={INSTALL_URL} className="btn btn-primary">{INSTALL_LABEL}</a><Link href="/docs/getting-started" className="btn btn-ghost">Getting started guide</Link></div>
      </Container>
    </>
  );
}
