import type { Metadata } from 'next';
import { Container, PageHero } from '@/components/site';

export const metadata: Metadata = { title: 'About', description: 'Why TrustCode exists and the principles behind it.', alternates: { canonical: '/about' } };

export default function About() {
  return (
    <>
      <PageHero eyebrow="About" title="Built so developers trust AI code for the right reasons" />
      <Container className="prose-tc max-w-3xl">
        <p>AI coding tools now write a large share of the code developers ship, faster than anyone can review it line by line. A confident-sounding answer is not evidence. TrustCode checks the code you and your AI agents write, right inside VS Code, and shows the evidence for every finding — where it is, why it matters and what to do next — together with a clear list of what was not checked.</p>
        <h2>Principles</h2>
        <ul><li><strong>Evidence over verdicts.</strong> No overall “safe” score — ever.</li><li><strong>Honest limits.</strong> “Not tested” is never shown as “passed”.</li><li><strong>You decide.</strong> TrustCode never edits your files.</li><li><strong>Private by default.</strong> Analysis runs on your computer. Your code is never uploaded and no account is needed.</li></ul>
      </Container>
    </>
  );
}
