import type { Metadata } from 'next';
import { Container, PageHero } from '@/components/site';
import { GITHUB_URL } from '@/lib/config';

export const metadata: Metadata = { title: 'About', description: 'Why TrustCode exists and how it is built.', alternates: { canonical: '/about' } };

export default function About() {
  return (
    <>
      <PageHero eyebrow="About" title="Built so developers trust AI code for the right reasons" />
      <Container className="prose-tc max-w-3xl">
        <p>TrustCode started as a research project on how developers decide whether to accept code written by AI assistants. Research shows that persuasive explanations and confidence scores can make people accept more incorrect code — not less. TrustCode takes the opposite approach: real evidence from independent tools, a clear statement of what each tool can and cannot tell you, and a list of what was not verified.</p>
        <h2>Principles</h2>
        <ul><li><strong>Evidence over verdicts.</strong> No overall “safe” score — ever.</li><li><strong>Honest limits.</strong> “Not tested” is never shown as “passed”.</li><li><strong>You decide.</strong> TrustCode never edits your files.</li><li><strong>Privacy by default.</strong> Code is sent only with consent and deleted after analysis.</li></ul>
        <h2>Open source</h2><p>The extension, backend and verification engine are developed in the open on <a href={GITHUB_URL}>GitHub</a>.</p>
      </Container>
    </>
  );
}
