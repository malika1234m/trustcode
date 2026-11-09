'use client';
import { useRef, useState } from 'react';
import { CheckIcon, AlertIcon } from '@/components/icons';

type Feature = { id: string; title: string; problem: string; how: string; benefit: string; preview: React.ReactNode };

const Mono = ({ children }: { children: React.ReactNode }) => <code className="font-mono text-[13px]">{children}</code>;

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line2 bg-bg2">
      <figcaption className="border-b border-line px-4 py-2 text-xs text-dim">{title}</figcaption>
      <div className="p-4 text-[13px] leading-relaxed">{children}</div>
    </figure>
  );
}

const LEVELS = {
  beginner: 'The query is made by pasting the username straight into the SQL text. Someone could type SQL into the username and change what the query does. Let the database insert the value for you with a placeholder (?).',
  intermediate: 'User input is interpolated into the SQL string, which allows SQL injection. Use a parameterised query: conn.execute("… WHERE username = ?", (username,)).',
  advanced: 'f-string interpolation of untrusted input into a SQL statement (CWE-89, OWASP A03). Bind parameters instead of formatting the query.',
} as const;

function LevelsPreview() {
  const [level, setLevel] = useState<keyof typeof LEVELS>('beginner');
  return (
    <Frame title="Same finding, three wordings">
      <div role="radiogroup" aria-label="Explanation level" className="mb-3 inline-flex rounded-lg border border-line2 p-0.5">
        {(Object.keys(LEVELS) as (keyof typeof LEVELS)[]).map((l) => (
          <button key={l} role="radio" aria-checked={level === l} onClick={() => setLevel(l)}
                  className={`min-h-9 rounded-md px-3 text-[13px] capitalize transition-colors ${level === l ? 'bg-brand text-[var(--brand-ink)]' : 'text-muted hover:text-fg'}`}>{l}</button>
        ))}
      </div>
      <p key={level} className="enter text-fg">{LEVELS[level]}</p>
      <div className="mt-3 rounded-lg border border-line bg-card p-3 text-xs text-muted">
        Evidence (unchanged at every level): Semgrep rule <Mono>SEC-1</Mono>, line 4, CWE-89.
      </div>
    </Frame>
  );
}

const FEATURES: Feature[] = [
  {
    id: 'security', title: 'Security patterns',
    problem: 'AI assistants reproduce insecure patterns they have seen: string-built SQL, shell commands from input, eval, weak hashes, hard-coded secrets.',
    how: '21 Semgrep rules for Python, JavaScript and TypeScript, each mapped to a CWE and an OWASP category.',
    benefit: '21 rules. Exact line, CWE, and a fix.',
    preview: (
      <Frame title="find_user.py, line 4">
        <pre className="overflow-x-auto rounded-lg bg-card p-3 font-mono text-[13px]">{`query = f"SELECT … WHERE username = '{username}'"`}</pre>
        <div className="mt-3 flex gap-2 rounded-lg border border-warn/40 bg-warn/5 p-3">
          <AlertIcon className="mt-0.5 h-4 w-4 text-warn" />
          <div><p className="font-medium text-fg">SQL injection risk</p><p className="text-muted">Rule SEC-1, CWE-89, OWASP A03 Injection. Use a parameterised query.</p></div>
        </div>
      </Frame>
    ),
  },
  {
    id: 'lint', title: 'Static analysis',
    problem: 'Generated code often references names that do not exist, or leaves dead code behind.',
    how: 'Python runs through Ruff (Pyflakes when Ruff is unavailable). Every language gets a real parser for syntax: tree-sitter for JavaScript and TypeScript.',
    benefit: 'Broken names and typos, caught before you run.',
    preview: (
      <Frame title="fetch.py">
        <pre className="overflow-x-auto rounded-lg bg-card p-3 font-mono text-[13px]">{`resp = requests.get(url, timeout=5)\nreturn reponse.json()`}</pre>
        <p className="mt-3 flex items-center gap-2 text-fg"><AlertIcon className="h-4 w-4 text-warn" />Line 2: undefined name <Mono>reponse</Mono> (F821)</p>
      </Frame>
    ),
  },
  {
    id: 'deps', title: 'Dependency check',
    problem: 'Assistants sometimes invent package names. Attackers register look-alike names for exactly this reason.',
    how: 'Every import is looked up on PyPI or npm. Standard-library modules and relative imports are recognised.',
    benefit: 'Made-up packages flagged before you install.',
    preview: (
      <Frame title="Imports in the selection">
        <ul className="space-y-2">
          <li className="flex items-center gap-2"><CheckIcon className="h-4 w-4 text-ok" /><Mono>requests</Mono><span className="text-muted">found on PyPI</span></li>
          <li className="flex items-center gap-2"><CheckIcon className="h-4 w-4 text-ok" /><Mono>json</Mono><span className="text-muted">standard library</span></li>
          <li className="flex items-center gap-2"><AlertIcon className="h-4 w-4 text-warn" /><Mono>fastjsonx</Mono><span className="text-fg">not found on PyPI, possibly hallucinated</span></li>
        </ul>
      </Frame>
    ),
  },
  {
    id: 'tests', title: 'Sandboxed tests',
    problem: 'Code can look right and still fail on an edge case.',
    how: 'On a self-hosted server, the tests you paste run in an isolated container: no network, a separate user, capped output. The hosted service never executes code.',
    benefit: 'Your tests, run in an isolated sandbox.',
    preview: (
      <Frame title="Supplied tests, last_items.py">
        <ul className="space-y-2">
          <li className="flex items-center gap-2"><CheckIcon className="h-4 w-4 text-ok" /><Mono>test_three</Mono><span className="text-muted">passed</span></li>
          <li className="flex items-center gap-2"><AlertIcon className="h-4 w-4 text-warn" /><Mono>test_zero</Mono><span className="text-fg">failed: expected [], got [1, 2, 3]</span></li>
        </ul>
        <p className="mt-3 text-xs text-dim">Self-hosted servers only. The hosted service runs static checks.</p>
      </Frame>
    ),
  },
  {
    id: 'gaps', title: 'The “not verified” list',
    problem: 'A clean result can be mistaken for “this code is correct”.',
    how: 'Every result ends with what no check covered: runtime behaviour without tests, whether the code matches your task, languages a tool cannot read.',
    benefit: '“No findings” never reads as “safe”.',
    preview: (
      <Frame title="is_leap.py: all checks passed">
        <p className="font-medium text-fg">Not verified</p>
        <ul className="mt-2 space-y-2">
          {['Whether the logic matches the task: the century rule is not covered by any check', 'Runtime behaviour: no tests were supplied'].map((t) => (
            <li key={t} className="flex gap-2 text-muted"><span className="hatch mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm border border-line2" aria-hidden="true" />{t}</li>
          ))}
        </ul>
      </Frame>
    ),
  },
  {
    id: 'levels', title: 'Explanations at your level',
    problem: 'One wording does not fit a student and a senior engineer.',
    how: 'Beginner, intermediate and advanced explanations. TrustCode can suggest a level from your decisions, but never changes it on its own.',
    benefit: 'Beginner to expert wording. Same evidence.',
    preview: <LevelsPreview />,
  },
];

export function FeatureShowcase() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const f = FEATURES[active];
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = FEATURES.length;
    const to = ['ArrowDown', 'ArrowRight'].includes(e.key) ? (i + 1) % n : ['ArrowUp', 'ArrowLeft'].includes(e.key) ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault(); setActive(to); refs.current[to]?.focus();
  };
  return (
    <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
      <div role="tablist" aria-label="Features" aria-orientation="vertical" className="scroll-fade scroll-fade-lg-off -mx-5 flex gap-1 overflow-x-auto pl-5 lg:mx-0 lg:flex-col lg:overflow-visible lg:pl-0">
        {FEATURES.map((x, i) => (
          <button key={x.id} ref={(el) => { refs.current[i] = el; }} role="tab" id={`ft-${x.id}`} aria-selected={i === active} aria-controls="ft-panel" tabIndex={i === active ? 0 : -1}
                  onClick={() => setActive(i)} onKeyDown={(e) => onKey(e, i)}
                  className={`relative flex min-h-12 shrink-0 items-center whitespace-nowrap rounded-lg px-4 text-left text-[15px] transition-colors lg:whitespace-normal ${i === active ? 'bg-card text-fg' : 'text-muted hover:bg-card/60 hover:text-fg'}`}>
            <span aria-hidden="true" className={`absolute left-0 top-2 bottom-2 hidden w-0.5 rounded-full bg-brand transition-opacity lg:block ${i === active ? 'opacity-100' : 'opacity-0'}`} />
            {x.title}
          </button>
        ))}
      </div>
      <div id="ft-panel" role="tabpanel" aria-labelledby={`ft-${f.id}`} key={f.id} className="enter grid gap-8 md:grid-cols-[0.8fr_1.2fr] md:items-center">
        <div>
          <h3 className="text-3xl font-semibold">{f.title}</h3>
          <p className="mt-3 text-lg leading-relaxed text-muted">{f.benefit}</p>
        </div>
        {f.preview}
      </div>
    </div>
  );
}
