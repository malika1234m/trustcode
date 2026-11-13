import type { Metadata } from 'next';
import Link from 'next/link';
import { Container, PageHero } from '@/components/site';
import { INSTALL_LABEL, INSTALL_URL } from '@/lib/config';

export const metadata: Metadata = { title: 'How it works', description: 'Create a free account, install the VS Code extension, set up the local engine once, and verify AI-generated code on your computer.', alternates: { canonical: '/how-it-works' } };

const STEPS = [
  ['Create a free account', 'Register on this website. TrustCode is free; the account confirms who is using it.'],
  ['Install the extension', 'Download trustcode-1.2.0.vsix from the GitHub release and run “Extensions: Install from VSIX…” in VS Code. It is not on the Marketplace. A shield icon appears in the activity bar. Sign in from the TrustCode panel.'],
  ['Set up the local engine once', 'The first time, TrustCode asks, then creates a private Python environment in VS Code’s storage and downloads the analysis tools from PyPI (about 300 MB, needs Python 3.11 or newer).'],
  ['Select AI-generated code', 'Select Python, JavaScript or TypeScript in the editor, then right-click → “TrustCode: Verify Selected Code”.'],
  ['Describe the task (optional)', 'Tell TrustCode what the code should do and paste unit tests that import the selection as solution. With Docker running, the tests run in a sandbox on your computer.'],
  ['Verify', 'Security, secret, code, type and dependency checks run on your computer. Nothing is uploaded.'],
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
