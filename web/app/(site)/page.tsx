import Link from 'next/link';
import { Container } from '@/components/site';
import {
  ArrowRightIcon, CheckIcon, CodeIcon, DatabaseIcon, FolderIcon, GlobeIcon, KeyIcon, MinusIcon, PackageIcon, PlayIcon,
  RefreshIcon, ServerIcon, ShieldIcon, LockIcon,
} from '@/components/icons';
import { HeroVisual } from '@/components/landing/hero-visual';
import { ProjectScanDemo } from '@/components/landing/project-scan-demo';
import { CapabilityBadge, StatusBadge } from '@/components/landing/badges';
import { Reveal } from '@/components/landing/reveal-motion';
import { WorkspaceScan } from '@/components/visuals/workspace-scan';
import { AgentHub } from '@/components/visuals/agent-hub';
import { Pipeline } from '@/components/visuals/pipeline';
import { INSTALL_URL } from '@/lib/config';
import { getPlans } from '@/lib/plans';
import type { Status } from '@/lib/capabilities';

type Icon = (p: { className?: string }) => React.ReactNode;

const HIGHLIGHTS: [Icon, string, string][] = [
  [FolderIcon, 'Full-project scanning', 'Whole-workspace scan'],
  [RefreshIcon, 'AI-agent monitoring', 'Workspace change tracking'],
  [ShieldIcon, 'Security detection', 'Security pattern rules'],
  [ServerIcon, 'Pre-deployment checks', 'Pre-commit checks'],
];

// Each risk tile: a one-line code sample with the risky part marked, and the status of the check behind it.
const RISKS: { icon: Icon; title: string; line: string; code: [string, string, string]; status: Status }[] = [
  { icon: KeyIcon, title: 'Exposed secrets', line: 'Keys and tokens in code.', code: ['STRIPE_KEY = ', '"sk_live_51Hx…"', ''], status: 'available' },
  { icon: DatabaseIcon, title: 'SQL injection', line: 'User input inside queries.', code: ['db.execute(f"…WHERE id=', '{user_id}', '")'], status: 'available' },
  { icon: CodeIcon, title: 'Cross-site scripting', line: 'Unsafe HTML rendering.', code: ['el.innerHTML = ', 'req.query.q', ''], status: 'in-development' },
  { icon: LockIcon, title: 'API vulnerabilities', line: 'JWT, CORS and auth gaps.', code: ['cors({ origin: ', "'*'", ', credentials: true })'], status: 'in-development' },
  { icon: PackageIcon, title: 'Dependency risks', line: 'Packages that don’t exist.', code: ["import retry from ", "'axios-retry-helper'", ''], status: 'available' },
  { icon: GlobeIcon, title: 'Configuration problems', line: 'Docker, cloud and CI.', code: ['FROM node:latest  ', 'USER root', ''], status: 'planned' },
];

function Title({ id, children, center = false }: { id: string; children: React.ReactNode; center?: boolean }) {
  return <h2 id={id} className={`text-[2.1rem] font-bold leading-[1.08] tracking-[-0.025em] sm:text-5xl ${center ? 'text-center' : ''}`}>{children}</h2>;
}

async function Pricing() {
  const data = await getPlans();
  if (!data) return <p className="text-center text-muted">The Free plan is available now. <Link href="/pricing" className="text-brand underline underline-offset-4">See plans</Link></p>;
  return (
    <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-3">
      {data.plans.map((p, i) => {
        const live = p.status === 'available';
        const v = p.limits.verifications_per_month;
        return (
          <Reveal key={p.id} delay={i * 0.08} className="h-full">
            <div className={`relative flex h-full flex-col rounded-2xl p-7 ${live ? 'neon-frame' : 'glass'}`}>
              {live && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[linear-gradient(90deg,#4F7BFF,#A97CFF)] px-3 py-0.5 text-xs font-semibold text-white">Available now</span>}
              <div className="flex items-center justify-between gap-3"><h3 className="text-xl font-semibold">{p.name}</h3>{!live && <StatusBadge status="planned" />}</div>
              <p className="mt-6 text-5xl font-bold tracking-tight">{live ? '$0' : <span className="text-2xl font-semibold text-muted">Price not set</span>}{live && <span className="text-base font-normal text-dim"> / month</span>}</p>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm text-muted">
                <li className="flex gap-2"><CheckIcon className="mt-0.5 h-4 w-4 text-ok" />{v == null ? 'Unlimited verifications' : `${v} verifications a month`}</li>
                <li className="flex gap-2"><CheckIcon className="mt-0.5 h-4 w-4 text-ok" />{p.limits.history_days}-day history</li>
                <li className="flex gap-2">{p.features.llm_explanations ? <CheckIcon className="mt-0.5 h-4 w-4 text-ok" /> : <MinusIcon className="mt-0.5 h-4 w-4 text-dim" />}AI-worded explanations</li>
              </ul>
              {live ? <Link href="/register" className="btn btn-neon mt-7">Get started free</Link>
                    : <Link href="/contact" className="btn btn-ghost mt-7">Tell us you’re interested</Link>}
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}

export default function Home() {
  return (
    <div className="streaks overflow-x-clip">
      {/* 1 — Hero */}
      <section className="relative">
        <Container className="relative grid items-center gap-8 pb-14 pt-10 md:pt-16 lg:grid-cols-[1fr_1.15fr]">
          <div>
            <p className="pill"><ShieldIcon className="h-3.5 w-3.5" />Project-wide AI code security</p>
            <h1 className="mt-6 text-[3rem] font-bold leading-[1] tracking-[-0.035em] sm:text-[4.2rem] lg:text-[4.6rem]">
              Your AI writes.<br /><span className="text-neon">TrustCode protects.</span>
            </h1>
            <p className="mt-6 text-xl text-muted">Every change. Every file. Every security risk.</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href={INSTALL_URL} className="btn btn-neon !min-h-14 !px-6"><CodeIcon className="h-5 w-5" />Download for VS Code</a>
              <Link href="#demo" className="btn btn-ghost !min-h-14 !px-6"><PlayIcon className="h-5 w-5" />Explore the demo</Link>
            </div>
          </div>
          <HeroVisual />
        </Container>

        {/* 2 — Highlights */}
        <Container className="relative pb-8">
          <Reveal>
            <ul id="features" className="glass grid scroll-mt-24 grid-cols-2 gap-y-8 rounded-2xl px-4 py-7 lg:grid-cols-4 lg:divide-x lg:divide-white/[.07]">
              {HIGHLIGHTS.map(([I, t, cap]) => (
                <li key={t} className="flex flex-col items-center gap-3 px-3 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--neon-cyan)]/30 bg-[var(--neon-cyan)]/[.07]">
                    <I className="glow-cyan h-6 w-6 text-[var(--neon-cyan)]" />
                  </span>
                  <span className="font-semibold">{t}</span>
                  <CapabilityBadge name={cap} />
                </li>
              ))}
            </ul>
          </Reveal>
        </Container>
      </section>

      {/* 3 — Project-wide */}
      <section aria-labelledby="project-title" className="py-20 md:py-24">
        <Container>
          <Reveal className="mb-12 flex flex-wrap items-end justify-between gap-6">
            <Title id="project-title">Beyond the<br className="hidden sm:block" /> selected line.</Title>
            <p className="max-w-xs text-lg text-muted">Your entire workspace, under security review.</p>
          </Reveal>
          <Reveal><WorkspaceScan /></Reveal>
        </Container>
      </section>

      {/* 4 — Agents */}
      <section aria-labelledby="agents-title" className="relative py-20 md:py-24">
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-[28rem] -translate-y-1/2 bg-[radial-gradient(45%_55%_at_50%_50%,rgba(169,124,255,.14),transparent)]" />
        <Container className="relative">
          <Reveal><Title id="agents-title" center>Every agent.<br /><span className="text-neon">One security layer.</span></Title></Reveal>
          <div className="mt-14"><AgentHub /></div>
          <p className="mx-auto mt-10 max-w-lg text-center text-xs text-dim">Works through workspace file monitoring. Not affiliated with these products.</p>
        </Container>
      </section>

      {/* 5 — Risks */}
      <section id="security" aria-labelledby="security-title" className="scroll-mt-20 py-20 md:py-24">
        <Container>
          <Reveal className="mb-12"><Title id="security-title">Find the risks<br className="hidden sm:block" /> before they ship.</Title></Reveal>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RISKS.map(({ icon: I, title, line, code, status }, i) => (
              <Reveal key={title} delay={(i % 3) * 0.06} className="h-full">
                <li className="tile flex h-full flex-col overflow-hidden">
                  <div aria-hidden="true" className="mono border-b border-white/[.06] bg-[#0A1020]/80 px-4 py-4 text-[12.5px]">
                    <span className="text-[#8C97AE]">{code[0]}</span>
                    <span className={`rounded px-1 ${status === 'planned' ? 'bg-white/[.06] text-muted' : 'bg-err/15 text-err underline decoration-wavy decoration-err/70 underline-offset-4'}`}>{code[1]}</span>
                    <span className="text-[#8C97AE]">{code[2]}</span>
                  </div>
                  <div className="flex flex-1 items-start gap-3.5 p-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,rgba(91,140,255,.25),rgba(169,124,255,.2))]"><I className="h-5 w-5 text-[#C8CCFF]" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{title}</h3><StatusBadge status={status} /></div>
                      <p className="mt-1 text-sm text-muted">{line}</p>
                    </div>
                  </div>
                </li>
              </Reveal>
            ))}
          </ul>
          <p className="mt-6 text-sm text-dim">Python, JavaScript and TypeScript today. <Link href="/roadmap" className="text-brand hover:underline">See the roadmap</Link></p>
        </Container>
      </section>

      {/* 6 — Demo */}
      <section id="demo" aria-labelledby="demo-title" className="scroll-mt-20 py-20 md:py-24">
        <Container>
          <Reveal className="mb-12 text-center">
            <Title id="demo-title" center>See TrustCode in action.</Title>
            <p className="mt-4 text-muted">A simulated scan with sample results. Nothing runs in your browser.</p>
          </Reveal>
          <Reveal><ProjectScanDemo /></Reveal>
        </Container>
      </section>

      {/* 7 — Workflow */}
      <section id="how-it-works" aria-labelledby="how-title" className="relative scroll-mt-20 overflow-hidden py-20 md:py-24">
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-64 -translate-y-1/2 bg-[radial-gradient(50%_60%_at_50%_50%,rgba(91,140,255,.14),transparent)]" />
        <Container className="relative">
          <Reveal className="mb-16"><Title id="how-title" center>From code to production.<br /><span className="text-neon">Securely.</span></Title></Reveal>
          <Pipeline />
        </Container>
      </section>

      {/* 8 — Pricing */}
      <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 py-20 md:py-24">
        <Container>
          <Reveal className="mb-14 text-center">
            <Title id="pricing-title" center>Start free.</Title>
            <p className="mt-4 text-muted">Nothing is charged today.</p>
          </Reveal>
          <Pricing />
        </Container>
      </section>

      {/* 9 — Final call to action */}
      <section aria-labelledby="cta-title" className="pb-28 pt-8">
        <Container>
          <div className="neon-frame relative overflow-hidden rounded-[28px] px-6 py-20 text-center sm:py-24">
            {/* eslint-disable-next-line @next/next/no-img-element -- decorative SVG, no optimisation needed */}
            <img src="/visuals/shield-glow.svg" alt="" aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 w-[760px] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-30" />
            <div className="relative">
              <h2 id="cta-title" className="text-4xl font-bold tracking-[-0.03em] sm:text-6xl">Ship code with confidence.</h2>
              <div className="mt-9 flex flex-wrap justify-center gap-3">
                <a href={INSTALL_URL} className="btn btn-neon !min-h-14 !px-8 text-base">Get TrustCode<ArrowRightIcon className="h-4 w-4" /></a>
                <Link href="/docs/getting-started" className="btn btn-ghost !min-h-14 !px-6">Setup guide</Link>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
