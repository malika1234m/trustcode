import type { Metadata } from 'next';
import { Container, PageHero } from '@/components/site';

export const metadata: Metadata = {
  title: 'Features',
  description: 'What TrustCode checks in AI-written code, on your computer: security flaws, exposed secrets, broken code, made-up packages, risky changes — with evidence for every finding.',
  alternates: { canonical: '/features' },
};

// Outcomes, not internals: describe what each feature does for the developer. See DESIGN.md (website copy).
const F: { t: string; lead: string; more: string; status: string }[] = [
  { t: 'Catch security flaws in AI code', lead: 'Injection, unsafe deserialization, weak cryptography and risky APIs, found before they ship.',
    more: 'Each finding names the weakness, links it to its CWE and OWASP category, and shows how sure the check is.', status: 'Available' },
  { t: 'Find exposed keys and secrets', lead: 'API keys, private keys and passwords in code, configuration and .env files.',
    more: 'Matched values are masked wherever they are shown, so a finding never repeats the secret.', status: 'Available' },
  { t: 'Spot broken and unfinished code', lead: 'Undefined names, leftover code, type mistakes and syntax errors — even in a partial selection.',
    more: 'Deepest for Python; JavaScript and TypeScript get syntax and security checks.', status: 'Available' },
  { t: 'Catch made-up packages', lead: 'AI assistants sometimes import packages that do not exist, or look-alikes of real ones.',
    more: 'Third-party imports are flagged for review, and with registry lookups turned on, unknown names are reported.', status: 'Available' },
  { t: 'Watch what your AI agent changed', lead: 'Track a session and every file an agent creates or edits is checked, whichever tool made the change.',
    more: 'Works without Git. Checks run when edits settle, when a batch finishes or when the agent reports it is done.', status: 'Available' },
  { t: 'Scan the whole project', lead: 'Check every file, only what changed, or what you are about to commit or push.',
    more: 'Git hooks and a CI mode apply your own policy before changes reach production.', status: 'Available' },
  { t: 'Run your tests in isolation', lead: 'Supplied unit tests run in a throw-away sandbox on your computer.',
    more: 'Lines and functions the tests never reached are listed, so passing tests are not mistaken for full coverage.', status: 'Available — needs Docker' },
  { t: 'Know exactly what was checked', lead: 'Every result lists what was verified and what was not.',
    more: 'No overall score: you see the evidence and decide.', status: 'Available' },
  { t: 'Go straight to the line', lead: 'Findings appear in the editor and the Problems panel, at the exact range.',
    more: 'Step through findings one by one, and copy a ready-made fix prompt for your coding agent.', status: 'Available' },
  { t: 'Explanations at your level', lead: 'Beginner, intermediate or advanced wording for every finding.',
    more: 'The evidence is the same at every level; only the explanation changes.', status: 'Available' },
  { t: 'Private by design', lead: 'Runs on your computer. Your code is never uploaded.',
    more: 'No telemetry. Results, decisions and history stay in VS Code’s storage on your machine.', status: 'Available' },
  { t: 'AI-worded explanations', lead: 'Natural-language explanations of your findings.',
    more: 'Grounded in the same evidence, and off unless you turn it on.', status: 'Planned' },
];

export default function Features() {
  return (
    <>
      <PageHero eyebrow="Features" title="Everything TrustCode checks for you">Built to catch what AI coding tools get wrong, on your own computer, before it reaches your repository.</PageHero>
      <Container className="grid gap-5 pb-14 md:grid-cols-2 xl:grid-cols-3">
        {F.map((f) => (
          <article key={f.t} className="card flex flex-col p-7">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-lg font-semibold">{f.t}</h2>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs ${f.status.startsWith('Available') ? 'border-ok/40 text-ok' : 'border-line2 text-muted'}`}>{f.status}</span>
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-fg">{f.lead}</p>
            <p className="mt-2 text-sm leading-6 text-muted">{f.more}</p>
          </article>
        ))}
      </Container>
    </>
  );
}
