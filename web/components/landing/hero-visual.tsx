'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { LogoMark } from '@/components/logo';
import { AlertIcon, FileIcon, KeyIcon } from '@/components/icons';

const HeroScene = dynamic(() => import('./hero-scene'), { ssr: false, loading: () => null });

function canUse3D() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

/** CSS-only stand-in for the WebGL backdrop (no WebGL, or reduced motion). */
function StaticRings() {
  return (
    <svg aria-hidden="true" viewBox="0 0 600 500" className="absolute inset-0 h-full w-full" fill="none">
      <ellipse cx="320" cy="250" rx="270" ry="95" transform="rotate(-18 320 250)" stroke="url(#r1)" strokeWidth="2" />
      <ellipse cx="320" cy="250" rx="300" ry="120" transform="rotate(-24 320 250)" stroke="url(#r2)" strokeWidth="1.2" opacity=".7" />
      <defs>
        <linearGradient id="r1" x1="0" x2="1"><stop stopColor="#38E1FF" stopOpacity="0" /><stop offset=".5" stopColor="#38E1FF" /><stop offset="1" stopColor="#A97CFF" stopOpacity=".2" /></linearGradient>
        <linearGradient id="r2" x1="1" x2="0"><stop stopColor="#A97CFF" stopOpacity="0" /><stop offset=".5" stopColor="#A97CFF" /><stop offset="1" stopColor="#5B8CFF" stopOpacity=".2" /></linearGradient>
      </defs>
    </svg>
  );
}

// Demonstration data only (the card is tagged as such).
const FILES: { name: string; tag?: 'M' | 'A'; sev?: 'err' | 'warn' | 'info'; delay?: number }[] = [
  { name: 'src/api/users.ts', tag: 'M', sev: 'warn', delay: 0.6 },
  { name: 'src/api/orders.ts', tag: 'M' },
  { name: 'src/auth/session.ts', tag: 'M', sev: 'info', delay: 1.4 },
  { name: 'src/jobs/export.ts', tag: 'A', sev: 'warn', delay: 1.9 },
  { name: 'src/lib/db.ts' },
  { name: '.env.production', tag: 'A', sev: 'err', delay: 2.6 },
  { name: 'Dockerfile', tag: 'M' },
  { name: 'package.json', tag: 'M' },
];
const SEV_VAR = { err: 'var(--err)', warn: 'var(--warn)', info: 'var(--info)' } as const;

function ScanDashboard() {
  return (
    <div className="neon-frame overflow-hidden rounded-2xl text-[12px]">
      <div className="flex items-center justify-between border-b border-white/[.06] px-4 py-2.5">
        <span className="flex items-center gap-2 font-semibold text-fg"><LogoMark className="h-4 w-4" />my-application</span>
        <span className="status status-planned !text-[10px]">Demonstration data</span>
      </div>
      <div className="grid grid-cols-[1.25fr_1fr]">
        {/* File list with a sweeping scan line */}
        <div className="relative overflow-hidden border-r border-white/[.06] py-2">
          <div aria-hidden="true" className="sweep pointer-events-none absolute inset-x-0 top-0 h-8 bg-[linear-gradient(180deg,transparent,rgba(56,225,255,.22),transparent)] [box-shadow:0_1px_0_rgba(56,225,255,.6)]" />
          {FILES.map((f) => (
            <div key={f.name} className={`flex items-center gap-2 px-3 py-[5px] ${f.sev ? 'flag-row' : ''}`}
                 style={f.sev ? ({ '--row': SEV_VAR[f.sev], animationDelay: `${(f.delay ?? 0) - 1.6}s` } as React.CSSProperties) : undefined}>
              <FileIcon className="h-3.5 w-3.5 text-dim" />
              <span className="mono truncate text-[#C9D3F5]">{f.name}</span>
              {f.sev && <span className="ml-auto h-2 w-2 shrink-0 rounded-[2px]" style={{ background: SEV_VAR[f.sev] }} />}
              {f.tag && <span className={`mono w-3 text-right text-[10px] ${f.sev ? '' : 'ml-auto'} ${f.tag === 'A' ? 'text-ok' : 'text-warn'}`}>{f.tag}</span>}
            </div>
          ))}
        </div>
        {/* Summary */}
        <div className="flex flex-col gap-2.5 p-3.5">
          <p className="font-semibold text-fg">Project scan</p>
          <div className="h-1 overflow-hidden rounded-full bg-white/[.07]"><div className="scan-bar h-full rounded-full bg-[linear-gradient(90deg,var(--neon-blue),var(--neon-cyan))]" /></div>
          <div className="grid grid-cols-2 gap-1.5">
            {[['128', 'files'], ['12', 'changed']].map(([n, l]) => (
              <div key={l} className="rounded-md border border-white/[.06] bg-white/[.02] px-2 py-1.5"><span className="block text-base font-semibold text-fg">{n}</span><span className="text-[10px] text-dim">{l}</span></div>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1 text-center">
            {[['1', 'var(--err)'], ['2', 'var(--warn)'], ['3', 'var(--info)'], ['2', 'var(--dim)']].map(([n, c], i) => (
              <div key={i} className="rounded-md py-1" style={{ background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
                <span className="block text-sm font-semibold" style={{ color: c }}>{n}</span>
              </div>
            ))}
          </div>
          <div className="pop rounded-md border border-err/40 bg-err/10 px-2 py-1.5" style={{ animationDelay: '1s' }}>
            <p className="flex items-center gap-1.5 font-semibold text-err"><KeyIcon className="h-3 w-3" />Exposed credential</p>
            <p className="mono text-[10px] text-muted">.env.production:3</p>
          </div>
          <div className="pop rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5" style={{ animationDelay: '1.3s' }}>
            <p className="flex items-center gap-1.5 font-semibold text-warn"><AlertIcon className="h-3 w-3" />SQL injection</p>
            <p className="mono text-[10px] text-muted">src/api/users.ts:42</p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-white/[.06] px-4 py-2 text-[11px] text-dim">
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />Local engine · Ruff · Pyflakes · mypy · Semgrep · tree-sitter
      </div>
    </div>
  );
}

export function HeroVisual() {
  const [webgl, setWebgl] = useState(false);
  const [reduce, setReduce] = useState(true);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setWebgl(canUse3D());   // eslint-disable-line react-hooks/set-state-in-effect
    setReduce(window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.matchMedia('(pointer: coarse)').matches);
  }, []);

  // Perspective tilt that follows the pointer (fine pointers only, motion allowed).
  const onMove = (e: React.PointerEvent) => {
    if (reduce || !card.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    card.current.style.transform = `rotateY(${-14 + x * 10}deg) rotateX(${7 - y * 8}deg)`;
  };
  const onLeave = () => { if (card.current) card.current.style.transform = ''; };

  return (
    <figure className="relative mx-auto w-full max-w-[640px] max-sm:mt-2 max-sm:py-6 sm:aspect-[6/5] 2xl:max-w-[780px]" onPointerMove={onMove} onPointerLeave={onLeave}>
      <figcaption className="sr-only">Illustration of a TrustCode project scan on the local engine, using demonstration data: 128 files, 12 changed, findings for an exposed credential and a SQL injection.</figcaption>
      {webgl ? <HeroScene /> : <StaticRings />}
      <div aria-hidden="true" className="relative flex items-center justify-end [perspective:1400px] sm:absolute sm:inset-0 sm:pl-[4%] lg:pl-[14%]">
        <div ref={card} className="relative w-full transition-transform duration-300 ease-out [transform:rotateY(-14deg)_rotateX(7deg)] [transform-style:preserve-3d] max-sm:[transform:rotateY(-6deg)_rotateX(3deg)]">
          <div className="absolute -inset-6 -z-10 rounded-3xl bg-[radial-gradient(closest-side,rgba(91,140,255,.35),transparent)] blur-2xl" />
          <ScanDashboard />
          {/* Floating chips */}
          <div className="drift absolute -left-6 -top-5 hidden rounded-xl border border-[var(--neon-cyan)]/40 bg-[#0C1424]/90 px-3 py-2 text-[11px] shadow-[0_0_30px_-6px_rgba(56,225,255,.6)] backdrop-blur sm:block [transform:translateZ(40px)]">
            <span className="flex items-center gap-2 text-fg"><span className="pulse-soft inline-block h-2 w-2 rounded-full bg-[var(--neon-cyan)]" />Runs on this computer</span>
          </div>
          <div className="drift absolute -bottom-5 -left-8 hidden rounded-xl border border-ok/40 bg-[#0C1424]/90 px-3 py-2 text-[11px] shadow-[0_0_30px_-8px_rgba(79,209,181,.6)] backdrop-blur sm:block [animation-delay:-3s]">
            <span className="flex items-center gap-2 text-fg"><LogoMark className="h-3.5 w-3.5" />Code never uploaded</span>
          </div>
        </div>
      </div>
    </figure>
  );
}
