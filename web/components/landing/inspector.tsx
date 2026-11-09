'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CHECKS, SCENARIOS, type Scenario } from '@/lib/scenarios';
import { LogoMark } from '@/components/logo';
import { StatusIcon, STATUS_LABEL } from './status';

type Phase = { kind: 'idle' } | { kind: 'running'; step: number } | { kind: 'done' };
const STEP_MS = 420;

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Inspector() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const timers = useRef<number[]>([]);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const sc: Scenario = SCENARIOS[index];

  const clear = () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
  const run = useCallback(() => {
    clear();
    if (reducedMotion()) { setPhase({ kind: 'done' }); return; }
    CHECKS.forEach((_, i) => timers.current.push(window.setTimeout(() => setPhase({ kind: 'running', step: i }), 120 + i * STEP_MS)));
    timers.current.push(window.setTimeout(() => setPhase({ kind: 'done' }), 120 + CHECKS.length * STEP_MS));
  }, []);

  // The page's one unprompted motion: the first walkthrough runs once on load.
  useEffect(() => { const t = window.setTimeout(run, 700); return () => { window.clearTimeout(t); clear(); }; }, [run]);

  const select = (i: number) => { clear(); setIndex(i); setPhase({ kind: 'idle' }); };
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const n = SCENARIOS.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault(); select(to); tabs.current[to]?.focus();
  };

  const done = phase.kind === 'done';
  const reached = (i: number) => done || (phase.kind === 'running' && i < phase.step);
  const running = (i: number) => phase.kind === 'running' && i === phase.step;
  const markLines = done || (phase.kind === 'running' && phase.step >= 2);

  return (
    <div className="overflow-hidden rounded-2xl border border-line2 bg-card shadow-[0_40px_120px_-40px_rgba(0,0,0,.7)]">
      {/* window bar */}
      <div className="flex items-center gap-3 border-b border-line bg-bg2 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full bg-line2" /><span className="h-2.5 w-2.5 rounded-full bg-line2" /><span className="h-2.5 w-2.5 rounded-full bg-line2" /></span>
        <div role="tablist" aria-label="Example selections" className="scroll-fade -mb-2.5 flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {SCENARIOS.map((s, i) => (
            <button key={s.id} ref={(el) => { tabs.current[i] = el; }} role="tab" id={`tab-${s.id}`} aria-selected={i === index} aria-controls="inspector-panel"
                    tabIndex={i === index ? 0 : -1} onClick={() => select(i)} onKeyDown={(e) => onTabKey(e, i)}
                    className={`min-h-10 shrink-0 whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${i === index ? 'border-brand text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
              {s.tab}
            </button>
          ))}
        </div>
      </div>

      <div id="inspector-panel" role="tabpanel" aria-labelledby={`tab-${sc.id}`} className="grid lg:grid-cols-[1.35fr_1fr]">
        {/* editor */}
        <div className="flex min-w-0 flex-col border-b border-line lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[13px] text-muted">
            <span className="font-mono">{sc.file}</span><span>{sc.language}</span>
          </div>
          <pre className="flex-1 overflow-x-auto py-3 font-mono text-[13px] leading-7" aria-label={`Selected code in ${sc.file}`}>
            {sc.code.map((line, i) => {
              const n = i + 1;
              const issue = markLines && sc.issueLines.includes(n);
              const hatched = done && sc.unverifiedLines.includes(n);
              return (
                <div key={n} className={`relative flex pr-4 transition-colors duration-300 ${issue ? 'bg-warn/10' : 'bg-brand/[.06]'}`}>
                  {hatched && <span aria-hidden="true" className="hatch absolute inset-0" />}
                  <span className="relative w-6 shrink-0 select-none text-center" aria-hidden="true">
                    {issue && <span className="absolute left-2 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-warn" />}
                  </span>
                  <span className="relative w-7 shrink-0 select-none pr-3 text-right text-dim" aria-hidden="true">{n}</span>
                  <code className={`relative whitespace-pre ${line.startsWith('#') ? 'text-dim' : 'text-fg'}`}>{line || ' '}</code>
                </div>
              );
            })}
          </pre>
          <div className="border-t border-line">
            <p className="px-4 pt-2.5 text-xs font-medium text-muted">Problems{done ? ` (${CHECKS.filter((c) => sc.checks[c.id].status === 'issue').length})` : ''}</p>
            <ul className="min-h-16 px-4 pb-2 pt-1.5 text-[13px]">
              {done ? CHECKS.filter((c) => sc.checks[c.id].status === 'issue').map((c) => (
                <li key={c.id} className="enter flex gap-2 py-1 leading-relaxed"><StatusIcon s="issue" className="mt-0.5 h-3.5 w-3.5" /><span className="text-fg">{sc.checks[c.id].detail}</span><span className="ml-auto shrink-0 pl-3 text-dim">TrustCode</span></li>
              )) : <li className="py-1 text-dim">{phase.kind === 'running' ? 'Checking the selection…' : 'No problems reported yet.'}</li>}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warn" aria-hidden="true" />Finding on this line</span>
            <span className="flex items-center gap-1.5"><span className="hatch inline-block h-3 w-4 rounded-sm border border-line2" aria-hidden="true" />Not verified by any check</span>
          </div>
        </div>

        {/* TrustCode panel */}
        <div className="flex min-w-0 flex-col bg-bg2">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
            <span className="flex items-center gap-2 text-[13px] font-semibold"><LogoMark className="h-4 w-4" />TrustCode</span>
            <button type="button" onClick={run} disabled={phase.kind === 'running'} className="btn btn-primary !min-h-9 !px-3 !py-1.5 text-[13px]">
              {phase.kind === 'running' ? 'Checking…' : done ? 'Run again' : 'Verify selection'}
            </button>
          </div>

          <div className="flex-1 p-4" aria-live="polite">
            {done ? <p className="mb-3 font-semibold">{sc.headline}</p>
                  : <p className="mb-3 text-muted">{phase.kind === 'running' ? 'Running independent checks…' : 'Select code, then verify it.'}</p>}
            <ol className="space-y-1.5">
              {CHECKS.map((c, i) => {
                const r = sc.checks[c.id];
                return (
                  <li key={c.id} className={`rounded-lg border px-3 py-2 transition-colors duration-300 ${reached(i) && r.status === 'issue' ? 'border-warn/40 bg-warn/5' : 'border-line bg-card'}`}>
                    <div className="flex items-center gap-2.5 text-[13px]">
                      <span className="flex h-4 w-4 items-center justify-center">
                        {reached(i) ? <StatusIcon s={r.status} /> : running(i)
                          ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-label="Running" />
                          : <span className="h-1.5 w-1.5 rounded-full bg-line2" aria-hidden="true" />}
                      </span>
                      <span className="font-medium">{c.label}</span>
                      <span className="ml-auto text-dim">{reached(i) ? STATUS_LABEL[r.status] : c.tool}</span>
                    </div>
                    {done && r.status !== 'clean' && <p className="mt-1 pl-6.5 text-[13px] leading-relaxed text-muted">{r.detail}</p>}
                  </li>
                );
              })}
            </ol>
            {done && (
              <div className="mt-4 rounded-lg border border-dashed border-line2 p-3">
                <p className="text-[13px] font-semibold">Not verified</p>
                <ul className="mt-1.5 space-y-1">
                  {sc.notVerified.map((t) => <li key={t} className="flex gap-2 text-[13px] leading-relaxed text-muted"><span className="hatch mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm border border-line2" aria-hidden="true" />{t}</li>)}
                </ul>
              </div>
            )}
            {sc.selfHosted && <p className="mt-3 text-xs text-dim">Tests run only on a self-hosted TrustCode server, inside an isolated container with no network.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
