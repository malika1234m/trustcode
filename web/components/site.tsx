import Link from 'next/link';
import { Suspense } from 'react';
import { SiteHeaderClient } from './site-header';
import { GITHUB_URL } from '@/lib/config';
import { Logo } from './logo';

/** Static fallback while the interactive header hydrates (it reads the URL, so it streams under Cache Components). */
function HeaderFallback() {
  return (
    <header className="sticky top-0 z-40 border-b border-transparent">
      <div className="mx-auto flex h-16 wrap items-center justify-between"><Link href="/" aria-label="TrustCode home" className="inline-flex min-h-11 items-center"><Logo /></Link></div>
    </header>
  );
}

export function SiteHeader() {
  return <Suspense fallback={<HeaderFallback />}><SiteHeaderClient /></Suspense>;
}

const FOOT = {
  Product: [['Features', '/features'], ['Security checks', '/#security'], ['How it works', '/how-it-works'], ['Roadmap', '/roadmap'], ['Pricing', '/pricing'], ['Changelog', '/changelog']],
  Resources: [['Documentation', '/docs'], ['Getting started', '/docs/getting-started'], ['Troubleshooting', '/docs/troubleshooting'], ['Support', '/contact']],
  Company: [['About', '/about'], ['Contact', '/contact'], ['GitHub', GITHUB_URL]],
  Legal: [['Privacy', '/legal/privacy'], ['Terms', '/legal/terms'], ['Acceptable use', '/legal/acceptable-use'], ['Refunds', '/legal/refunds']],
};

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-bg2">
      <div className="mx-auto grid wrap gap-10 py-14 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">Project-wide security checks in VS Code for code written by you or your AI agent. Evidence for every finding, and a clear list of what was not checked.</p>
        </div>
        {Object.entries(FOOT).map(([title, links]) => (
          <div key={title}>
            <h2 className="text-sm font-semibold">{title}</h2>
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {links.map(([l, h]) => <li key={l}>{h.startsWith('http') ? <a href={h} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center hover:text-fg">{l}<span className="sr-only"> (opens in a new tab)</span></a> : <Link href={h} className="inline-flex min-h-9 items-center hover:text-fg">{l}</Link>}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto wrap border-t border-line py-6 text-xs leading-relaxed text-dim">© <Year /> TrustCode. TrustCode reports evidence from automated checks; it does not guarantee that code is correct or secure.</div>
    </footer>
  );
}

export function PageHero({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <section className="glow relative overflow-hidden border-b border-line">
      <div className="mx-auto wrap pb-12 pt-16 md:pt-20">
        {eyebrow && <p className="text-sm font-medium text-brand">{eyebrow}</p>}
        <h1 className="mt-2 max-w-3xl text-4xl font-semibold leading-[1.1] md:text-[3.25rem]">{title}</h1>
        {children && <div className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{children}</div>}
      </div>
      <div aria-hidden="true" className="hatch h-2 w-full opacity-60" />
    </section>
  );
}

export function Container({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`wrap ${className}`}>{children}</div>;
}

async function Year() {
  'use cache';
  return <>{new Date().getFullYear()}</>;
}
