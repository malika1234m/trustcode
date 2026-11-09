import type { Metadata } from 'next';
import { Container, PageHero } from '@/components/site';

export const metadata: Metadata = { title: 'Features', description: 'Every TrustCode check explained: security patterns, static analysis, dependency checks, sandboxed tests, the “not verified” list and adaptive explanations.', alternates: { canonical: '/features' } };

const F = [
  { t: 'Security patterns (Semgrep)', p: 'Insecure patterns in AI code go unnoticed because the code looks fine.', how: '21 frozen Semgrep rules covering SQL and command injection, eval / new Function, unsafe deserialisation, weak hashing, insecure randomness, hard-coded secrets, TLS verification, path traversal, prototype pollution and runtime tampering. Each finding links to CWE / OWASP and says how confident the rule is (some, like “insecure randomness”, often raise false alarms).', plan: 'Free', status: 'Available' },
  { t: 'Syntax & structure', p: 'Snippets are often incomplete or in the wrong language.', how: 'Python is parsed with Python’s own parser; JavaScript and TypeScript with tree-sitter grammars. Partial selections (starting inside a comment or mid-block) and TypeScript type-declaration files are recognised and explained instead of reported as bare errors.', plan: 'Free', status: 'Available' },
  { t: 'Static analysis', p: 'Undefined names and leftover code hide real bugs.', how: 'ruff (with a pyflakes fallback) checks Python for undefined names, unused imports/variables and common bug patterns. No linter is configured for JavaScript/TypeScript yet — the panel says so.', plan: 'Free', status: 'Available (Python)' },
  { t: 'Dependency existence', p: 'AI assistants can invent package names; look-alike packages are a supply-chain risk.', how: 'Imports are extracted statically. Standard-library modules are recognised offline; third-party packages are looked up on PyPI or npm when registry checks are enabled, otherwise marked “needs review” — never “OK”.', plan: 'Free', status: 'Available' },
  { t: 'Sandboxed unit tests', p: 'Code that “looks right” can fail on the first edge case.', how: 'Your tests run in a throw-away Docker container: no network, read-only filesystem, separate unprivileged user, CPU/memory/process limits and timeouts. Lines and functions the tests never executed are listed as not verified.', plan: 'Self-hosted', status: 'Self-hosted only — the hosted service never executes code' },
  { t: '“Not verified” list', p: 'Passing checks are easily mistaken for proof of correctness.', how: 'Every result lists what no check covered: untested functions and lines, the match with your task description, and assumptions. There is deliberately no overall “safe” score.', plan: 'Free', status: 'Available' },
  { t: 'Explanations at your level', p: 'Raw tool output is hard to act on.', how: 'Each finding answers: what, where, detected by, why it matters, evidence, what could not be verified, and next step — in beginner, intermediate or advanced wording. The evidence is identical at every level.', plan: 'Free', status: 'Available' },
  { t: 'In-editor hints & Go to line', p: 'Findings are useless if you cannot find the line.', how: 'Findings appear as editor hints (never “errors” — they are evidence, not verdicts) and in the Problems panel; “Go to line” jumps to the exact line of the original selection.', plan: 'Free', status: 'Available' },
  { t: 'Decisions & history', p: 'You need a record of what you accepted and why.', how: 'Accept, modify or reject with a confidence rating and optional note. History keeps results for 24 hours by default, or 30 days if you opt in.', plan: 'Free', status: 'Available' },
  { t: 'Privacy controls', p: 'Code is sensitive.', how: 'Nothing is sent before you confirm; code is deleted after analysis; library code (node_modules, site-packages) asks before sending; account and data deletion are one click away.', plan: 'Free', status: 'Available' },
  { t: 'AI-worded explanations', p: 'Some users prefer natural-language explanations.', how: 'Optional LLM wording that may only re-word existing findings, is validated against the evidence and falls back to standard explanations. Off by default.', plan: 'Pro (planned)', status: 'Planned on the hosted service' },
];

export default function Features() {
  return (
    <>
      <PageHero eyebrow="Features" title="Every check, and what it can’t tell you">Each feature below is implemented in the current release unless marked planned.</PageHero>
      <Container className="grid gap-5 pb-10 md:grid-cols-2">
        {F.map((f) => (
          <article key={f.t} className="card p-7">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{f.t}</h2>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs ${f.status.startsWith('Available') ? 'border-ok/40 text-ok' : 'border-line2 text-muted'}`}>{f.status}</span>
            </div>
            <p className="mt-3 text-sm"><span className="font-medium text-fg">Problem: </span><span className="text-muted">{f.p}</span></p>
            <p className="mt-2 text-sm leading-6 text-muted">{f.how}</p>
            <p className="mt-4 text-xs text-dim">Plan: {f.plan}</p>
          </article>
        ))}
      </Container>
    </>
  );
}
