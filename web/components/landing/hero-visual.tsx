'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { LogoMark } from '@/components/logo';
import { AlertIcon, CheckIcon, MinusIcon } from '@/components/icons';
import { SCENARIOS } from '@/lib/scenarios';

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

/** The floating product card: a faithful, static rendering of the TrustCode panel for one benchmark example. */
function Showcase() {
  const sc = SCENARIOS[0];
  const counts = { issue: 0, clean: 0, not_tested: 0, review: 0 };
  Object.values(sc.checks).forEach((c) => { counts[c.status] += 1; });
  return (
    <div className="neon-frame grid grid-cols-[7.5rem_1fr] overflow-hidden rounded-2xl text-[12px] sm:grid-cols-[8.5rem_1fr_1.15fr]">
      <div className="border-r border-white/5 bg-[#0A1020]/80 p-3">
        <div className="mb-4 flex items-center gap-2 font-semibold text-fg"><LogoMark className="h-4 w-4" />TrustCode</div>
        {['Overview', 'Findings', 'History', 'Account'].map((t, i) => (
          <div key={t} className={`mb-1 rounded-md px-2 py-1.5 ${i === 0 ? 'bg-brand/20 text-fg shadow-[inset_2px_0_0_var(--brand)]' : 'text-muted'}`}>{t}</div>
        ))}
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-warn/15 text-warn shadow-[0_0_24px_rgba(242,181,68,.45)]"><AlertIcon className="h-5 w-5" /></span>
          <div><p className="text-[13px] font-semibold text-fg">1 issue detected</p><p className="text-dim">{sc.file}</p></div></div>
        <div className="mt-1 space-y-1.5">
          {[['Syntax', 'clean'], ['Security', 'issue'], ['Dependencies', 'clean'], ['Tests', 'not_tested']].map(([t, s]) => (
            <div key={t} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${s === 'issue' ? 'border-warn/40 bg-warn/5' : 'border-white/5 bg-white/[.02]'}`}>
              {s === 'clean' ? <CheckIcon className="h-3.5 w-3.5 text-ok" /> : s === 'issue' ? <AlertIcon className="h-3.5 w-3.5 text-warn" /> : <MinusIcon className="h-3.5 w-3.5 text-dim" />}
              <span className="text-fg">{t}</span>
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1.5 text-center">
          {[[counts.issue, 'issue', 'text-warn'], [counts.clean, 'clean', 'text-ok'], [sc.notVerified.length, 'not verified', 'text-brand']].map(([n, l, c]) => (
            <div key={l as string} className="rounded-md border border-white/5 bg-white/[.02] py-1.5"><span className={`block text-base font-semibold ${c}`}>{n}</span><span className="text-[10px] text-dim">{l}</span></div>
          ))}
        </div>
      </div>
      <div className="hidden border-l border-white/5 bg-[#0A1020]/60 sm:block">
        <div className="border-b border-white/5 px-3 py-2 font-mono text-muted">{sc.file}</div>
        <pre className="py-2 font-mono text-[11px] leading-6">
          {sc.code.map((l, i) => (
            <div key={i} className={`relative flex pr-2 ${sc.issueLines.includes(i + 1) ? 'bg-warn/10' : ''}`}>
              {sc.unverifiedLines.includes(i + 1) && !sc.issueLines.includes(i + 1) && <span className="hatch absolute inset-0" />}
              <span className="relative w-6 shrink-0 text-right text-dim">{i + 1}</span>
              <code className="relative ml-2 truncate whitespace-pre text-[#C9D3F5]">{l || ' '}</code>
            </div>
          ))}
        </pre>
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
    card.current.style.transform = `rotateY(${-16 + x * 10}deg) rotateX(${8 - y * 8}deg)`;
  };
  const onLeave = () => { if (card.current) card.current.style.transform = ''; };

  return (
    <div className="relative mx-auto aspect-[6/5] w-full max-w-[640px]" onPointerMove={onMove} onPointerLeave={onLeave}>
      {webgl ? <HeroScene /> : <StaticRings />}
      <div className="absolute inset-0 flex items-center justify-end pl-[6%] lg:pl-[24%] [perspective:1400px]">
        <div ref={card} className="w-full transition-transform duration-300 ease-out [transform:rotateY(-16deg)_rotateX(8deg)] [transform-style:preserve-3d] max-sm:[transform:rotateY(-8deg)_rotateX(4deg)]">
          <div aria-hidden="true" className="absolute -inset-6 -z-10 rounded-3xl bg-[radial-gradient(closest-side,rgba(91,140,255,.35),transparent)] blur-2xl" />
          <div aria-hidden="true"><Showcase /></div>
        </div>
      </div>
    </div>
  );
}
