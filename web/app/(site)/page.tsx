import Link from 'next/link';
import { Container } from '@/components/site';
import { LogoMark } from '@/components/logo';
import {
  AlertIcon, ArrowRightIcon, ChartIcon, CheckIcon, CodeIcon, DownloadIcon, FlaskIcon, KeyIcon, LayersIcon, ListIcon, LockIcon,
  MinusIcon, PackageIcon, PlayIcon, RocketIcon, SearchIcon, SelectIcon, ZapIcon,
} from '@/components/icons';
import { Inspector } from '@/components/landing/inspector';
import { HeroVisual } from '@/components/landing/hero-visual';
import { TiltCard } from '@/components/landing/tilt-card';
import { Reveal } from '@/components/landing/reveal-motion';
import { INSTALL_LABEL, INSTALL_URL } from '@/lib/config';
import { getPlans } from '@/lib/plans';
import { releases } from '@/lib/changelog';

const STRIP = [
  [ZapIcon, 'Faster reviews', 'with evidence'],
  [AlertIcon, 'Catch risky code', 'before it ships'],
  [SearchIcon, 'See every gap', 'nothing hidden'],
  [LockIcon, 'Your code, your call', 'sent only on confirm'],
] as const;

const FEATURES = [
  [AlertIcon, 'Security patterns', '21 rules mapped to CWE and OWASP.', '/features'],
  [CodeIcon, 'Static analysis', 'Broken names and typos, before you run.', '/features'],
  [PackageIcon, 'Dependency check', 'Flags packages that don’t exist.', '/features'],
  [FlaskIcon, 'Sandboxed tests', 'Your tests in an isolated container.', '/docs/self-hosting'],
  [ListIcon, 'Not-verified list', 'Every gap marked, never hidden.', '/docs/reading-results'],
  [LayersIcon, 'Three explanation levels', 'Beginner to expert. Same evidence.', '/features'],
] as const;

const STEPS = [
  [DownloadIcon, 'Download', 'Get the .vsix release'],
  [CodeIcon, 'Install', 'Install from VSIX in VS Code'],
  [KeyIcon, 'Sign in', 'One click, in your browser'],
  [SelectIcon, 'Verify', 'Select code, see evidence'],
] as const;

const PRINCIPLES = ['No overall safety score', 'Unchecked lines are marked', 'Code leaves only with your OK', 'Unsupported languages are refused'];

const FAQ = [
  ['How do I install TrustCode?', 'Download the .vsix from the GitHub release, then in VS Code choose Extensions › … › Install from VSIX. A Marketplace listing is in preparation.'],
  ['Is it free to use?', 'Yes. The Free plan includes 300 verifications a month. Nothing is charged today.'],
  ['How does verification work?', 'Independent tools (parsers, Ruff/Pyflakes, Semgrep, registry lookups and, self-hosted, a test sandbox) each report what they found. TrustCode shows the evidence and lists what none of them covered.'],
  ['Is my code stored?', 'No. Code is sent only after you confirm and deleted when analysis finishes. Results expire after 24 hours unless you keep history.'],
  ['Where can I get support?', 'Open a ticket on the contact page or from your dashboard.'],
] as const;

function SectionPill({ children }: { children: React.ReactNode }) {
  return <span className="pill">{children}</span>;
}

async function Pricing() {
  const data = await getPlans();
  if (!data) return <p className="text-muted">Free plan: 300 verifications a month. <Link href="/pricing" className="text-brand underline underline-offset-4">Plan details</Link></p>;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {data.plans.map((p, i) => {
        const live = p.status === 'available';
        const v = p.limits.verifications_per_month;
        return (
          <Reveal key={p.id} delay={i * 0.08} className="h-full">
            <div className={`relative flex h-full flex-col rounded-2xl p-6 ${live ? 'neon-frame' : 'glass'}`}>
              {live && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[linear-gradient(90deg,#4F7BFF,#A97CFF)] px-3 py-0.5 text-xs font-semibold text-white">Available now</span>}
              <h3 className="text-xl font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm text-muted">{p.tagline}</p>
              <p className="mt-5 text-4xl font-semibold">{live ? '$0' : <span className="text-2xl text-muted">Planned</span>}{live && <span className="text-base font-normal text-dim"> / month</span>}</p>
              <ul className="mt-5 flex-1 space-y-2 text-sm text-muted">
                <li className="flex gap-2"><CheckIcon className="mt-0.5 h-4 w-4 text-ok" />{v == null ? 'Unlimited verifications' : `${v} verifications a month`}</li>
                <li className="flex gap-2"><CheckIcon className="mt-0.5 h-4 w-4 text-ok" />History up to {p.limits.history_days} days</li>
                <li className="flex gap-2">{p.features.llm_explanations ? <CheckIcon className="mt-0.5 h-4 w-4 text-ok" /> : <MinusIcon className="mt-0.5 h-4 w-4 text-dim" />}AI-worded explanations</li>
              </ul>
              {live ? <Link href="/register" className="btn btn-neon mt-6">Get started free</Link>
                    : <Link href="/contact" className="btn btn-ghost mt-6">Tell us you’re interested</Link>}
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}

export default function Home() {
  const latest = releases()[0];
  return (
    <div className="streaks">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <Container className="relative grid items-center gap-10 pb-16 pt-10 md:pt-14 lg:grid-cols-[1fr_1.15fr]">
          <div>
            <a href={INSTALL_URL} className="pill transition-colors hover:border-brand"><CodeIcon className="h-3.5 w-3.5" />Free VS Code extension<ArrowRightIcon className="h-3.5 w-3.5" /></a>
            <h1 className="mt-6 text-[2.9rem] font-bold leading-[1.02] tracking-[-0.025em] md:text-[4.4rem]">
              Evidence for every line your <span className="text-neon">AI writes.</span>
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-muted md:text-xl">Check, understand and decide on AI-generated code with confidence.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={INSTALL_URL} className="btn btn-neon !min-h-14 !px-6"><CodeIcon className="h-5 w-5" />{INSTALL_LABEL}</a>
              <Link href="#demo" className="btn btn-ghost !min-h-14 !px-6"><PlayIcon className="h-5 w-5" />Try the demo</Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              <li className="flex items-center gap-2"><ZapIcon className="h-4 w-4 text-warn" />Real checks</li>
              <li className="flex items-center gap-2"><CheckIcon className="h-4 w-4 text-ok" />Clear evidence</li>
              <li className="flex items-center gap-2"><ChartIcon className="h-4 w-4 text-brand" />Gaps marked</li>
            </ul>
          </div>
          <HeroVisual />
        </Container>

        <Container className="relative pb-6">
          <Reveal>
            <div className="glass grid gap-6 rounded-2xl p-6 sm:grid-cols-2 lg:grid-cols-[1.2fr_repeat(4,1fr)] lg:divide-x lg:divide-white/[.07]">
              <div><p className="text-xl font-semibold">Built for developers</p><p className="mt-1 text-sm text-muted">A careful way to build with AI.</p></div>
              {STRIP.map(([Icon, t, d]) => (
                <div key={t} className="flex flex-col items-center text-center lg:px-4">
                  <Icon className="h-7 w-7 text-[var(--neon-cyan)] drop-shadow-[0_0_10px_rgba(56,225,255,.6)]" />
                  <p className="mt-3 font-semibold">{t}</p><p className="text-sm text-muted">{d}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </Container>
      </section>

      <section id="features" className="scroll-mt-20 py-20 md:py-28">
        <Container className="grid gap-12 lg:grid-cols-[1fr_1.6fr] lg:items-center">
          <Reveal>
            <SectionPill><LogoMark className="h-3.5 w-3.5" />Features</SectionPill>
            <h2 className="mt-5 text-4xl font-bold leading-tight tracking-[-0.02em] md:text-5xl">Everything you need to check <span className="text-neon">AI</span> in your code.</h2>
            <p className="mt-5 max-w-md text-lg text-muted">Independent checks. Real evidence. Every gap visible.</p>
            <Link href="/features" className="btn btn-neon mt-8">Explore all features<ArrowRightIcon className="h-4 w-4" /></Link>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {FEATURES.map(([Icon, t, d, href], i) => (
              <Reveal key={t} delay={(i % 3) * 0.06}>
                <TiltCard href={href} className="h-full">
                  <Icon className="h-8 w-8 text-[var(--neon-cyan)] drop-shadow-[0_0_10px_rgba(56,225,255,.55)]" />
                  <span className="mt-4 block font-semibold">{t}</span>
                  <span className="mt-1 block pr-10 text-sm text-muted">{d}</span>
                  <span aria-hidden="true" className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-brand transition-colors group-hover:border-brand group-hover:bg-brand/15"><ArrowRightIcon className="h-4 w-4" /></span>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section id="demo" aria-labelledby="demo-title" className="scroll-mt-20 pb-20 md:pb-28">
        <Container>
          <Reveal className="mb-8 text-center">
            <SectionPill><PlayIcon className="h-3.5 w-3.5" />Live demo</SectionPill>
            <h2 id="demo-title" className="mt-4 text-3xl font-bold tracking-[-0.02em] md:text-4xl">Pick an example. Press verify.</h2>
          </Reveal>
          <Reveal><Inspector /></Reveal>
        </Container>
      </section>

      <section id="how-it-works" className="relative scroll-mt-20 overflow-hidden pb-6 pt-16 md:pb-10 md:pt-24">
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-64 -translate-y-1/2 bg-[radial-gradient(50%_60%_at_50%_50%,rgba(91,140,255,.12),transparent)]" />
        <Container className="relative">
          <Reveal className="text-center">
            <SectionPill><ZapIcon className="h-3.5 w-3.5" />Simple process</SectionPill>
            <h2 className="mt-4 text-3xl font-bold tracking-[-0.02em] md:text-4xl">Get started in just a few steps</h2>
          </Reveal>
          <div className="mt-14 grid items-center gap-10 lg:grid-cols-[10rem_1fr_10rem]">
            <div aria-hidden="true" className="mx-auto hidden [perspective:800px] lg:block">
              <div className="float-3d flex h-32 w-32 items-center justify-center rounded-3xl border border-brand/40 bg-[linear-gradient(145deg,#1B2A55,#0C1322)] shadow-[0_0_60px_-10px_rgba(91,140,255,.7)]">
                <CodeIcon className="h-14 w-14 text-[var(--neon-blue)] drop-shadow-[0_0_14px_rgba(91,140,255,.9)]" />
              </div>
            </div>
            <ol className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
              {STEPS.map(([Icon, t, d], i) => (
                <Reveal key={t} delay={i * 0.1}>
                  <li className="relative flex flex-col items-center text-center">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,#4F7BFF,#A97CFF)] text-sm font-semibold text-white shadow-[0_0_20px_rgba(120,110,255,.6)]">{i + 1}</span>
                      <Icon className="h-8 w-8 text-[var(--neon-cyan)]" />
                    </div>
                    <h3 className="mt-4 font-semibold">{t}</h3>
                    <p className="mt-1 text-sm text-muted">{d}</p>
                    {i < STEPS.length - 1 && <ArrowRightIcon className="absolute -right-5 top-2 hidden h-5 w-5 text-dim md:block" />}
                  </li>
                </Reveal>
              ))}
            </ol>
            <div aria-hidden="true" className="mx-auto hidden [perspective:800px] lg:block">
              <div className="float-3d flex h-32 w-32 items-center justify-center rounded-3xl border border-[var(--neon-cyan)]/40 bg-[linear-gradient(145deg,#132B3A,#0C1322)] shadow-[0_0_60px_-10px_rgba(56,225,255,.6)] [animation-delay:-3s]">
                <LogoMark className="h-16 w-16 drop-shadow-[0_0_14px_rgba(79,209,181,.8)]" />
              </div>
            </div>
          </div>
        </Container>
      </section>

      <section id="pricing" className="scroll-mt-20 py-16 md:py-24">
        <Container className="grid gap-12 lg:grid-cols-[1fr_2.4fr] lg:items-center">
          <Reveal>
            <SectionPill>Pricing</SectionPill>
            <h2 className="mt-4 text-4xl font-bold leading-tight tracking-[-0.02em]">Simple, transparent pricing.</h2>
            <p className="mt-4 text-muted">Start free. Paid plans are planned; nothing is charged today.</p>
            <Link href="/pricing" className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-brand hover:underline">Compare plans<ArrowRightIcon className="h-4 w-4" /></Link>
          </Reveal>
          <Pricing />
        </Container>
      </section>

      <section id="faq" className="scroll-mt-20 pb-24">
        <Container className="grid gap-5 lg:grid-cols-[1fr_1.3fr_1fr]">
          <Reveal className="h-full">
            <div className="glass flex h-full flex-col rounded-2xl p-6">
              <LogoMark className="h-10 w-10" />
              <h2 className="mt-4 text-xl font-semibold">Our principles</h2>
              <ul className="mt-4 flex-1 space-y-3 text-sm">
                {PRINCIPLES.map((p) => <li key={p} className="flex gap-2"><CheckIcon className="mt-0.5 h-4 w-4 text-ok" />{p}</li>)}
              </ul>
              {latest && <Link href="/changelog" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-fg"><span className="h-1.5 w-1.5 rounded-full bg-ok" />New in {latest.version}</Link>}
            </div>
          </Reveal>
          <Reveal delay={0.08} className="h-full">
            <div className="glass h-full rounded-2xl p-6">
              <SectionPill>FAQ</SectionPill>
              <h2 className="mt-3 text-2xl font-semibold">Got questions?</h2>
              <div className="mt-3 divide-y divide-white/[.07]">
                {FAQ.map(([q, a]) => (
                  <details key={q} className="group">
                    <summary className="flex min-h-12 list-none items-center gap-3 text-[15px] [&::-webkit-details-marker]:hidden">
                      <CheckIcon className="h-4 w-4 shrink-0 text-brand transition-transform group-open:rotate-90" />{q}
                    </summary>
                    <p className="pb-3 pl-7 text-sm leading-relaxed text-muted">{a}</p>
                  </details>
                ))}
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.16} className="h-full">
            <div className="neon-frame relative flex h-full flex-col items-center justify-center overflow-hidden rounded-2xl p-8 text-center">
              <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(91,140,255,.35),transparent)]" />
              <RocketIcon className="relative h-10 w-10 text-[var(--neon-cyan)] drop-shadow-[0_0_14px_rgba(56,225,255,.8)]" />
              <h2 className="relative mt-4 text-2xl font-semibold">Ready to build with confidence?</h2>
              <a href={INSTALL_URL} className="btn btn-neon relative mt-6">{INSTALL_LABEL}<ArrowRightIcon className="h-4 w-4" /></a>
              <Link href="/docs/getting-started" className="relative mt-3 inline-flex min-h-11 items-center text-sm text-muted hover:text-fg">Setup guide</Link>
            </div>
          </Reveal>
        </Container>
      </section>
    </div>
  );
}
