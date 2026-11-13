'use client';
// Interactive product walkthrough: a 78-second "film" rendered as live UI on one continuous VS Code-style stage.
// A clock drives the storyboard (script.ts); a virtual camera pans and zooms between regions; captions run as
// lower thirds. Any click on the interface pauses the film so the visitor can explore; "Explore yourself" turns
// the clock off entirely. Everything shown is simulated demonstration data, and the player says so.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogoMark } from '@/components/logo';
import { INSTALL_URL } from '@/lib/config';
import {
  AGENT_LOG, CHANGED, COMMIT_LOG, ENGINES, FILES, FINDINGS, NOT_CHECKED, PIPELINE, SCENES, SEVERITY_ORDER, STAGE, TOTAL, TREE,
  sceneAt, type Finding, type Severity,
} from './script';

const SEV: Record<Severity, { label: string; color: string; glyph: string }> = {
  critical: { label: 'Critical', color: 'var(--err)', glyph: '◆' },
  high: { label: 'High', color: 'var(--warn)', glyph: '▲' },
  medium: { label: 'Medium', color: 'var(--info)', glyph: '●' },
  low: { label: 'Low', color: 'var(--dim)', glyph: '○' },
};
const idx = (id: string) => SCENES.findIndex((s) => s.id === id);
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Override = { file?: string; finding?: string | null; engine?: string; stage?: string; sev?: Severity | null };
type Mode = 'watch' | 'explore';

// Fixed panel geometry, so the scripted cursor can point at real rows.
const PANEL_X = 790, ROW_TOP = 34 + 46 + 40, ROW_H = 52;

export function Walkthrough() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<Mode>('watch');
  const [captions, setCaptions] = useState(true);
  const [ov, setOv] = useState<Override>({});
  const [fit, setFit] = useState(1);
  const [narrow, setNarrow] = useState(false);
  const [reduce, setReduce] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [fsOk, setFsOk] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  // Environment: reduced motion, narrow screens, fullscreen state.
  useEffect(() => {
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const nw = window.matchMedia('(max-width: 639px)');
    const sync = () => { setReduce(rm.matches); setNarrow(nw.matches); setFsOk(Boolean(document.fullscreenEnabled)); };
    sync();
    rm.addEventListener('change', sync); nw.addEventListener('change', sync);
    const onFs = () => setIsFs(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => { rm.removeEventListener('change', sync); nw.removeEventListener('change', sync); document.removeEventListener('fullscreenchange', onFs); };
  }, []);

  // Scale the fixed-size stage to the frame, like a video.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setFit(Math.min(e.contentRect.width / STAGE.w, e.contentRect.height / STAGE.h)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [narrow]);

  // Clock: requestAnimationFrame while playing, committed to state about 20 times a second.
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now(), acc = 0;
    const tick = (now: number) => {
      acc += (now - last) / 1000; last = now;
      if (acc >= 0.05) {
        const step = acc; acc = 0;
        setT((p) => {
          const n = p + step;
          if (n >= TOTAL) { setPlaying(false); return TOTAL; }
          return n;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const si = sceneAt(t);
  const scene = SCENES[si];
  const explore = mode === 'explore';
  const local = explore ? scene.duration : t - scene.start;
  /** Has a beat of a given scene happened yet? */
  const seen = useCallback((id: string, at = 0) => { const i = idx(id); return si > i || (si === i && local >= at); }, [si, local]);

  // ---- Controls -------------------------------------------------------------------------------------------
  const seek = (time: number, keepPlaying = playing) => { setOv({}); setT(clamp(time, 0, TOTAL)); setPlaying(keepPlaying && time < TOTAL); };
  /** Jump to a chapter. In watch mode the film keeps playing from there, like video chapters. */
  const go = (i: number) => { const n = clamp(i, 0, SCENES.length - 1); setStarted(true); setOv({}); setT(SCENES[n].start); setPlaying(!explore); };
  const play = () => { setStarted(true); setMode('watch'); setOv({}); if (t >= TOTAL - 0.05) setT(0); setPlaying(true); };
  const pause = () => setPlaying(false);
  const replay = () => { setStarted(true); setMode('watch'); setOv({}); setT(0); setPlaying(true); };
  const toExplore = () => { setStarted(true); setMode('explore'); setPlaying(false); setOv({}); };
  /** A visitor's click on the simulated interface: pause and show their choice. */
  const touch = (o: Override) => { setStarted(true); setPlaying(false); setOv((p) => ({ ...p, ...o })); };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch { /* not supported: the control is hidden below */ }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === ' ' || e.key === 'k') { if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'A') return; e.preventDefault(); if (playing) pause(); else play(); }
    else if (e.key === 'ArrowRight' && tag !== 'INPUT') { e.preventDefault(); go(si + 1); }
    else if (e.key === 'ArrowLeft' && tag !== 'INPUT') { e.preventDefault(); go(local < 1 && !explore ? si - 1 : si); }
    else if (e.key === 'c') setCaptions((c) => !c);
    else if (e.key === 'f' && fsOk) void fullscreen();
  };

  // ---- Derived state for the stage ------------------------------------------------------------------------
  const view = useMemo(() => {
    const ev = idx('evidence');
    const findings = FINDINGS.filter((f) => seen('risks', f.at));
    let scripted: string | null = null;
    if (si === ev) scripted = local >= 6 ? 'xss' : local >= 1 ? 'sql' : null;
    else if (si > ev && si < idx('release')) scripted = 'sql';
    const selected = ov.finding !== undefined ? ov.finding : scripted;
    const sf = FINDINGS.find((f) => f.id === selected) ?? null;
    const file = ov.file ?? sf?.path ?? 'backend/users.py';
    const typed = si === 0 ? clamp((local - 2.6) / 5, 0, 1) : 1;
    const changes = CHANGED.filter((n) => seen('detected', n.at ?? 0)).length;
    const scanFiles = si < idx('scanned') ? 0 : si > idx('scanned') ? 128 : Math.round(clamp((local - 0.6) / 8.4, 0, 1) * 128);
    return { findings, sf, file, typed, changes, scanFiles };
  }, [si, local, ov, seen]);

  // Virtual camera: only while the film plays (paused or exploring shows the full frame).
  const cam = playing && !explore && !reduce ? scene.camera : { s: 1, x: STAGE.w / 2, y: STAGE.h / 2 };
  const tx = clamp(STAGE.w / 2 - cam.x * cam.s, STAGE.w - STAGE.w * cam.s, 0);
  const ty = clamp(STAGE.h / 2 - cam.y * cam.s, STAGE.h - STAGE.h * cam.s, 0);

  const stageProps = { si, local, seen, view, ov, touch, explore, playing, reduce };

  return (
    <div ref={root} onKeyDown={onKey} className={`neon-frame overflow-hidden rounded-[22px] ${isFs ? 'flex h-full flex-col justify-center !rounded-none bg-bg' : ''}`}
         role="region" aria-roledescription="interactive walkthrough" aria-label="TrustCode walkthrough">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[.07] px-4 py-3 sm:px-5">
        <span className="flex items-center gap-2 font-semibold"><LogoMark className="h-5 w-5" />See TrustCode in action</span>
        <span className="status status-planned !text-[10px]" title="A simulated interface with sample data. Not a recording of the extension.">Simulated demo · sample data</span>
        <div role="radiogroup" aria-label="Walkthrough mode" className="ml-auto flex shrink-0 rounded-lg border border-white/10 p-0.5 text-sm">
          {(['watch', 'explore'] as Mode[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => (m === 'watch' ? play() : toExplore())}
                    className={`min-h-9 rounded-md px-3 transition-colors ${mode === m ? 'bg-brand/20 text-fg' : 'text-muted hover:text-fg'}`}>
              {m === 'watch' ? <>Watch<span className="max-sm:hidden"> walkthrough</span></> : <>Explore<span className="max-sm:hidden"> yourself</span></>}
            </button>
          ))}
        </div>
      </div>

      {/* Frame */}
      {narrow ? (
        <div className="relative">
          <MobileStage {...stageProps} />
          {captions && started && <Caption text={scene.caption} />}
          {!started && <Poster onPlay={play} onExplore={toExplore} />}
        </div>
      ) : (
        <div ref={frame} className={`relative w-full overflow-hidden bg-[#070C18] ${isFs ? 'flex-1' : 'aspect-[16/9]'}`}>
          <div className="absolute left-1/2 top-1/2" style={{ width: STAGE.w, height: STAGE.h, transform: `translate(-50%, -50%) scale(${fit})` }}>
            <div className="absolute inset-0 origin-top-left" style={{ transform: `translate(${tx}px, ${ty}px) scale(${cam.s})`, transition: reduce ? 'none' : 'transform 1.4s cubic-bezier(.65,0,.35,1)' }}>
              <Workspace {...stageProps} />
            </div>
          </div>
          {!explore && started && local < 2.2 && !reduce && <ChapterCard key={scene.id} n={si + 1} title={scene.chapter} />}
          {captions && started && <Caption text={scene.caption} />}
          {!started && <Poster onPlay={play} onExplore={toExplore} />}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{started ? `Scene ${si + 1} of ${SCENES.length}: ${scene.title}. ${scene.caption}` : ''}</p>

      {/* Controls */}
      <div className="border-t border-white/[.07] px-3 pb-3 pt-2 sm:px-5">
        <div className="flex flex-wrap items-center gap-1 sm:flex-nowrap sm:gap-2">
          <Ctl label={playing ? 'Pause' : 'Play'} onClick={playing ? pause : play} primary>{playing ? <PauseGlyph /> : <PlayGlyph />}</Ctl>
          <Ctl label="Replay from the start" onClick={replay}><ReplayGlyph /></Ctl>
          <Ctl label="Previous scene" onClick={() => go(si - 1)} disabled={si === 0}><PrevGlyph /></Ctl>
          <Ctl label="Next scene" onClick={() => go(si + 1)} disabled={si === SCENES.length - 1}><NextGlyph /></Ctl>
          <span className="mono w-24 shrink-0 text-center text-xs text-muted max-sm:ml-auto max-sm:order-last max-sm:w-auto">{fmt(t)} / {fmt(TOTAL)}</span>
          <div className="relative mx-1 flex-1 max-sm:order-first max-sm:mx-0 max-sm:basis-full">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/[.08]">
              <div className="h-full bg-[linear-gradient(90deg,var(--neon-blue),var(--neon-cyan))]" style={{ width: `${(t / TOTAL) * 100}%` }} />
              {SCENES.slice(1).map((s) => <span key={s.id} className="absolute top-0 h-full w-0.5 bg-bg" style={{ left: `${(s.start / TOTAL) * 100}%` }} />)}
            </div>
            <input type="range" min={0} max={TOTAL} step={0.1} value={t} aria-label="Walkthrough timeline"
                   aria-valuetext={`${fmt(t)}, scene ${si + 1}: ${scene.chapter}`}
                   onChange={(e) => { setStarted(true); setMode('watch'); seek(Number(e.target.value)); }}
                   className="tc-range relative h-8 w-full cursor-pointer appearance-none bg-transparent" />
          </div>
          <Ctl label={captions ? 'Turn captions off' : 'Turn captions on'} onClick={() => setCaptions((c) => !c)} pressed={captions}><span className="text-[11px] font-bold">CC</span></Ctl>
          {fsOk && <Ctl label={isFs ? 'Exit full screen' : 'Full screen'} onClick={fullscreen} className="max-sm:hidden"><FsGlyph /></Ctl>}
        </div>
        <ol className="mt-2 grid grid-cols-7 gap-1.5" aria-label="Scenes">
          {SCENES.map((s, i) => {
            const active = i === si && started;
            const done = started && (i < si || (explore && i === si));
            const fill = active && !explore ? clamp((t - s.start) / s.duration, 0, 1) : done ? 1 : 0;
            return (
              <li key={s.id}>
                <button type="button" onClick={() => go(i)} aria-current={active ? 'step' : undefined}
                        className={`group w-full rounded-lg px-1.5 pb-1.5 pt-1 text-left transition-colors ${active ? 'bg-white/[.06]' : 'hover:bg-white/[.04]'}`}>
                  <span className="block h-0.5 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-[var(--neon-cyan)]" style={{ width: `${fill * 100}%` }} /></span>
                  <span className={`mt-1.5 block truncate text-[11px] sm:text-xs ${active ? 'text-fg' : 'text-dim group-hover:text-muted'}`}>
                    <span className="mono mr-1 text-brand">{i + 1}</span><span className="max-md:sr-only">{s.chapter}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 hidden text-[11px] text-dim md:block">Space play/pause · ← → scenes · C captions · F full screen · Click anything in the demo to explore it</p>
      </div>
    </div>
  );
}

// ==== Stage (desktop): one continuous VS Code-style workspace =================================================

type StageProps = {
  si: number; local: number; seen: (id: string, at?: number) => boolean; explore: boolean; playing: boolean; reduce: boolean;
  view: { findings: Finding[]; sf: Finding | null; file: string; typed: number; changes: number; scanFiles: number };
  ov: Override; touch: (o: Override) => void;
};

function Workspace(p: StageProps) {
  const { si, local } = p;
  const showPanel = si >= idx('scanned');
  const release = si === idx('release'), finish = si === idx('finish');
  return (
    <div className="absolute inset-0 select-none overflow-hidden rounded-none bg-[#0B1120] text-[13px] text-[#C9D3F5]">
      {/* Title bar */}
      <div className="flex h-[34px] items-center gap-2 border-b border-white/[.06] bg-[#0A0F1C] px-4 text-xs text-muted">
        <span className="flex gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-err/60" /><i className="h-2.5 w-2.5 rounded-full bg-warn/60" /><i className="h-2.5 w-2.5 rounded-full bg-ok/60" /></span>
        <span className="mx-auto">acme-shop — Visual Studio Code</span>
      </div>
      {/* Activity bar */}
      <div className="absolute bottom-[26px] left-0 top-[34px] flex w-[44px] flex-col items-center gap-4 border-r border-white/[.06] bg-[#0A0F1C] pt-4 text-dim">
        {[0, 1, 2].map((i) => <span key={i} className="h-5 w-5 rounded border border-current opacity-40" />)}
        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${showPanel ? 'bg-brand/20' : ''}`}><LogoMark className="h-5 w-5" /></span>
      </div>
      <Explorer {...p} />
      <Editor {...p} />
      <Terminal {...p} />
      <Panel {...p} visible={showPanel} />
      <StatusBar {...p} />
      {(release || finish) && <div className={`absolute inset-0 bg-[#060A14]/75 ${p.reduce ? '' : 'backdrop-blur-[2px]'}`} />}
      {release && <PipelineOverlay {...p} />}
      {finish && <Summary {...p} />}
      {!p.explore && p.playing && si === idx('evidence') && <ScriptedCursor local={local} />}
    </div>
  );
}

function Explorer({ view, seen, touch }: StageProps) {
  return (
    <div className="absolute bottom-[26px] left-[44px] top-[34px] w-[210px] border-r border-white/[.06] bg-[#0C1222] py-2">
      <p className="px-4 pb-1.5 text-[11px] font-semibold tracking-wide text-dim">EXPLORER · ACME-SHOP</p>
      {TREE.map((n) => {
        const changed = n.change && seen('detected', n.at ?? 0);
        const active = !n.dir && view.file === n.path;
        const flagged = !n.dir && view.findings.find((f) => f.path === n.path);
        const Row = n.dir ? 'div' : 'button';
        return (
          <Row key={n.path} {...(n.dir ? {} : { type: 'button' as const, onClick: () => touch({ file: n.path, finding: FINDINGS.find((f) => f.path === n.path && view.findings.includes(f))?.id ?? null }) })}
               className={`relative flex h-[22px] w-full items-center gap-1.5 pr-3 text-left ${active ? 'bg-brand/15 text-fg' : n.dir ? 'text-muted' : 'hover:bg-white/[.04]'}`}
               style={{ paddingLeft: 14 + n.depth * 14 }} title={n.dir ? undefined : `Open ${n.path}`}>
            <span className="text-[10px] text-dim">{n.dir ? '▾' : ''}</span>
            <span className={`mono truncate text-[12.5px] ${changed ? (n.change === 'A' ? 'text-ok' : 'text-warn') : ''}`}>{n.name}</span>
            {flagged && <span className="ml-auto text-[10px]" style={{ color: SEV[flagged.severity].color }} aria-label={SEV[flagged.severity].label}>{SEV[flagged.severity].glyph}</span>}
            {changed && <span className={`mono enter w-3 text-right text-[11px] ${flagged ? '' : 'ml-auto'} ${n.change === 'A' ? 'text-ok' : 'text-warn'}`}>{n.change}</span>}
            {changed && seen('detected', (n.at ?? 0)) && !seen('detected', (n.at ?? 0) + 1.2) && <span className="pointer-events-none absolute inset-0 animate-pulse bg-[var(--neon-cyan)]/10" />}
          </Row>
        );
      })}
    </div>
  );
}

function Editor({ view, si, local, touch }: StageProps) {
  const file = FILES[view.file] ?? FILES['backend/users.py'];
  const lineFindings = view.findings.filter((f) => f.path === view.file);
  const typingLine = 42;
  return (
    <div className="absolute left-[254px] right-[330px] top-[34px] h-[396px] overflow-hidden">
      <div className="flex h-[34px] items-end gap-px border-b border-white/[.06] bg-[#0A0F1C] pl-2">
        <span className="mono flex h-[30px] items-center gap-2 rounded-t-md border-t-2 border-brand bg-[#0B1120] px-3 text-xs text-fg">{view.file.split('/').pop()}</span>
        <span className="mono ml-3 self-center text-[11px] text-dim">{view.file}</span>
      </div>
      <pre className="mono py-3 text-[13px] leading-[26px]">
        {file.lines.map((l, i) => {
          const n = file.start + i;
          const f = lineFindings.find((x) => x.line === n);
          const sel = f && view.sf?.id === f.id;
          const isTyping = si === 0 && view.file === 'backend/users.py' && n === typingLine;
          const text = isTyping ? l.slice(0, Math.round(l.length * view.typed)) : l;
          return (
            <div key={`${view.file}-${n}`}>
              <div className="relative flex pr-4" style={f ? { background: `color-mix(in srgb, ${SEV[f.severity].color} ${sel ? 18 : 9}%, transparent)`, boxShadow: sel ? `inset 3px 0 0 ${SEV[f.severity].color}` : undefined } : undefined}>
                {f ? (
                  <button type="button" onClick={() => touch({ finding: f.id, file: f.path })} className="w-12 shrink-0 pr-3 text-right font-semibold" style={{ color: SEV[f.severity].color }}
                          aria-label={`${SEV[f.severity].label}: ${f.title}, line ${n}`}>{SEV[f.severity].glyph} {n}</button>
                ) : <span className="w-12 shrink-0 pr-3 text-right text-dim">{n}</span>}
                <code className="whitespace-pre" style={f ? { textDecoration: `underline wavy ${SEV[f.severity].color}`, textUnderlineOffset: '5px', textDecorationThickness: '1px' } : undefined}>
                  {text}{isTyping && view.typed < 1 && <span className="ml-px inline-block h-4 w-[7px] translate-y-0.5 animate-pulse bg-[var(--neon-cyan)]" />}
                </code>
              </div>
              {sel && f && <FindingCard f={f} local={local} />}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function FindingCard({ f }: { f: Finding; local: number }) {
  return (
    <div className="enter mx-3 my-2 ml-12 max-w-[420px] whitespace-normal rounded-lg border bg-[#0F1830] p-3 font-sans text-[12.5px] leading-snug shadow-[0_20px_40px_-20px_rgba(0,0,0,.9)]"
         style={{ borderColor: `color-mix(in srgb, ${SEV[f.severity].color} 50%, transparent)` }}>
      <p className="flex items-center gap-2"><SevTag s={f.severity} /><b className="font-semibold text-fg">{f.title}</b></p>
      <p className="mt-1 text-muted">{f.reason}</p>
      <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-y-0.5 text-[11.5px]">
        <dt className="text-dim">Confidence</dt><dd>{f.confidence}</dd>
        <dt className="text-dim">Rule</dt><dd className="mono">{f.rule}</dd>
        <dt className="text-dim">Policy</dt><dd>{f.gate}</dd>
        <dt className="text-dim">Fix</dt><dd className="text-muted">{f.fix}</dd>
      </dl>
    </div>
  );
}

function Terminal({ si, local, seen }: StageProps) {
  const lines = AGENT_LOG.filter((l) => seen('edits', l.at));
  const working = si === 0 && local < 8.5;
  return (
    <div className="absolute bottom-[26px] left-[254px] right-[330px] h-[174px] border-t border-white/[.06] bg-[#090E1A]">
      <div className="flex h-[30px] items-center gap-4 border-b border-white/[.05] px-4 text-[11px] text-dim">
        <span className="border-b border-fg pb-0.5 text-fg">TERMINAL</span><span>AI coding agent</span>
      </div>
      <div className="mono space-y-1.5 px-4 py-3 text-[12.5px]">
        {lines.map((l) => <p key={l.text} className="enter"><span className="text-[var(--neon-purple)]">● agent</span> <span className="text-muted">{l.text}</span></p>)}
        {working && <p className="text-dim"><span className="inline-block animate-pulse">▍</span> working…</p>}
        {!working && lines.length === AGENT_LOG.length && <p className="text-ok">✓ agent finished · 6 files changed</p>}
      </div>
    </div>
  );
}

function StatusBar({ si, local, view, touch }: StageProps) {
  let text = 'TrustCode · watching for changes';
  if (si === idx('detected')) text = local < 7.6 ? `TrustCode · ${view.changes} change${view.changes === 1 ? '' : 's'} · waiting for edits to settle` : 'TrustCode · edits settled · scanning';
  else if (si === idx('scanned')) text = `TrustCode · scanning ${view.scanFiles}/128 files`;
  else if (si > idx('scanned')) text = `TrustCode · ${view.findings.length} findings`;
  return (
    <div className="absolute inset-x-0 bottom-0 flex h-[26px] items-center gap-4 bg-[linear-gradient(90deg,#3B3FB8,#5B4BD0)] px-3 text-[11.5px] text-white">
      <span>⎇ main</span>
      <button type="button" onClick={() => touch({ finding: null })} className="flex items-center gap-1.5 rounded px-1.5 hover:bg-white/15">
        <LogoMark className="h-3.5 w-3.5" mono />{text}
      </button>
      <span className="ml-auto opacity-80">Ln 42, Col 9</span>
    </div>
  );
}

function Panel({ visible, si, local, view, ov, touch }: StageProps & { visible: boolean }) {
  const scanning = si === idx('scanned');
  const counts = SEVERITY_ORDER.map((s) => [s, view.findings.filter((f) => f.severity === s).length] as const);
  const list = view.findings
    .filter((f) => !ov.sev || f.severity === ov.sev)
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const engine = ENGINES.find((e) => e.name === ov.engine);
  const showNotChecked = si > idx('evidence') || (si === idx('evidence') && local >= 9);
  return (
    <div className={`absolute bottom-[26px] right-0 top-[34px] w-[330px] border-l border-white/[.07] bg-[#0D1426] transition-transform duration-700 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="flex h-[46px] items-center gap-2 border-b border-white/[.06] px-4">
        <LogoMark className="h-4 w-4" /><span className="font-semibold text-fg">Security</span>
        <span className="text-[11px] text-dim">local · nothing uploaded</span>
        {!scanning && (
          <span className="ml-auto flex gap-1">
            {(['Previous finding', 'Next finding'] as const).map((l, k) => (
              <button key={l} type="button" aria-label={l} title={l} onClick={() => {
                const order = list.length ? list : view.findings;
                const cur = order.findIndex((f) => f.id === view.sf?.id);
                const nxt = order[(cur + (k ? 1 : -1) + order.length) % order.length];
                if (nxt) touch({ finding: nxt.id, file: nxt.path });
              }} className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-muted hover:border-brand hover:text-fg">{k ? '↓' : '↑'}</button>
            ))}
          </span>
        )}
      </div>

      {scanning || (ov.engine && engine) ? (
        <div className="px-4 py-3">
          <div className="flex items-center justify-between text-xs text-muted"><span>{scanning ? `Scanning changed files` : 'Engines'}</span><span className="mono">{view.scanFiles}/128</span></div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[.07]"><div className="h-full bg-[linear-gradient(90deg,var(--neon-blue),var(--neon-cyan))]" style={{ width: `${(view.scanFiles / 128) * 100}%` }} /></div>
          <p className="mt-1.5 text-[11px] text-dim">122 unchanged files reused from the cache</p>
          <ul className="mt-3 space-y-1.5">
            {ENGINES.map((e, i) => {
              const state = !scanning ? 'done' : local >= 1 + i * 1.2 ? 'done' : local >= 0.4 + i * 1.2 ? 'run' : 'wait';
              const sel = ov.engine === e.name;
              return (
                <li key={e.name}>
                  <button type="button" onClick={() => touch({ engine: sel ? undefined : e.name })} aria-expanded={sel}
                          className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${sel ? 'border-brand/60 bg-brand/10' : 'border-white/[.06] bg-white/[.02] hover:border-white/15'}`}>
                    <span className="flex items-center gap-2">
                      <span className="w-4 text-center">{state === 'wait' ? <span className="text-dim">·</span> : state === 'run' ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--neon-cyan)] border-t-transparent" /> : e.state === 'ran' ? <span className="text-ok">✓</span> : <span className="text-dim">–</span>}</span>
                      <span className="font-medium text-fg">{e.name}</span>
                      <span className={`ml-auto text-[11px] ${e.state === 'ran' ? 'text-dim' : 'text-warn'}`}>{state === 'done' ? e.note : ''}</span>
                    </span>
                    <span className="ml-6 block text-[11px] text-dim">{sel ? e.detail : e.role}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!scanning && <button type="button" onClick={() => touch({ engine: undefined })} className="mt-3 text-xs text-brand hover:underline">Back to findings</button>}
        </div>
      ) : (
        <>
          <div className="flex h-[40px] items-center gap-1.5 border-b border-white/[.06] px-3">
            {counts.map(([s, n]) => (
              <button key={s} type="button" onClick={() => touch({ sev: ov.sev === s ? null : s })} aria-pressed={ov.sev === s}
                      className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors ${ov.sev === s ? 'bg-white/10' : 'hover:bg-white/[.05]'}`}>
                <span style={{ color: SEV[s].color }}>{SEV[s].glyph}</span><span className="text-muted">{SEV[s].label}</span><b className="text-fg">{n}</b>
              </button>
            ))}
          </div>
          <ul>
            {list.map((f) => {
              const sel = view.sf?.id === f.id;
              return (
                <li key={f.id} className="enter" style={{ height: ROW_H }}>
                  <button type="button" onClick={() => touch({ finding: f.id, file: f.path })} aria-pressed={sel}
                          className={`relative flex h-full w-full flex-col justify-center px-4 text-left transition-colors ${sel ? 'bg-brand/[.14]' : 'hover:bg-white/[.04]'}`}>
                    {sel && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" />}
                    <span className="flex items-center gap-2"><SevTag s={f.severity} small /><span className="truncate font-medium text-fg">{f.title}</span></span>
                    <span className="mono mt-0.5 truncate text-[11px] text-dim">{f.path}:{f.line}</span>
                  </button>
                </li>
              );
            })}
            {!list.length && <li className="px-4 py-4 text-xs text-dim">{view.findings.length ? 'No findings for this filter.' : 'No findings yet.'}</li>}
          </ul>
          <button type="button" onClick={() => touch({ engine: ENGINES[0].name })} className="mx-4 mt-2 text-[11.5px] text-brand hover:underline">Engines that ran</button>
          {showNotChecked && (
            <div className="enter absolute inset-x-3 bottom-3 rounded-lg border border-dashed border-line2 p-3">
              <span aria-hidden="true" className="hatch absolute inset-x-0 top-0 h-1.5 rounded-t-lg" />
              <p className="text-xs font-semibold text-fg">Not checked by this scan</p>
              <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-muted">{NOT_CHECKED.map((n) => <li key={n}>– {n}</li>)}</ul>
              <p className="mt-2 text-[11px] text-dim">Bandit not installed · advisories off</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PipelineOverlay({ local, ov, touch, explore }: StageProps) {
  const sel = PIPELINE.find((s) => s.name === ov.stage);
  const commit = COMMIT_LOG.filter((l) => explore || local >= l.at);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-12">
      <ol className="flex w-full items-start justify-between">
        {PIPELINE.map((s, i) => {
          const lit = explore || local >= s.at;
          const blocked = s.blocked && (explore || local >= 5.2);
          return (
            <li key={s.name} className="relative flex flex-1 flex-col items-center">
              {i < PIPELINE.length - 1 && (
                <span className={`absolute left-[calc(50%+34px)] right-[calc(-50%+34px)] top-[30px] h-[2px] rounded-full ${explore || local >= PIPELINE[i + 1].at ? 'beam' : 'bg-white/10'}`} />
              )}
              <button type="button" onClick={() => touch({ stage: ov.stage === s.name ? undefined : s.name })} aria-expanded={ov.stage === s.name}
                      className={`relative flex h-[60px] w-[60px] items-center justify-center rounded-2xl text-lg transition-all duration-500 ${blocked
                        ? 'border-2 border-err bg-err/15 text-err shadow-[0_0_40px_-6px_var(--err)]'
                        : lit ? 'bg-gradient-to-br from-[#4F7BFF] to-[#A97CFF] text-white shadow-[0_0_40px_-8px_rgba(120,110,255,.9)]' : 'border border-white/10 bg-white/[.03] text-dim'} ${ov.stage === s.name ? 'ring-2 ring-[var(--neon-cyan)]' : ''}`}>
                {blocked ? '✖' : lit ? '✓' : i + 1}
              </button>
              <p className={`mt-3 font-semibold ${lit ? 'text-fg' : 'text-dim'}`}>{s.name}</p>
              <p className="text-xs text-dim">{blocked ? 'Blocked by policy' : s.note}</p>
            </li>
          );
        })}
      </ol>
      <div className="mt-10 grid w-full max-w-[860px] grid-cols-2 gap-5">
        <div className="mono min-h-[132px] rounded-xl border border-white/10 bg-[#070B15] p-4 text-[12.5px]">
          {commit.map((l) => <p key={l.text} className={`enter ${l.tone === 'err' ? 'text-err' : l.tone === 'dim' ? 'text-dim' : 'text-fg'}`}>{l.text}</p>)}
        </div>
        <div className="rounded-xl border border-white/10 bg-[#0D1426] p-4 text-[13px]">
          <p className="font-semibold text-fg">{sel ? sel.name : 'Default policy'}</p>
          {sel ? <p className="mt-1.5 text-muted">{sel.detail}</p> : (
            <ul className="mt-1.5 space-y-1 text-muted">
              <li>Commit and push: block <b className="text-err">critical</b></li>
              <li>CI and production: block <b className="text-warn">high</b> and above</li>
              <li>Only <span className="text-fg">strongly suspected</span> or confirmed findings block</li>
            </ul>
          )}
          <p className="mt-2 text-[11px] text-dim">Click a stage for details.</p>
        </div>
      </div>
    </div>
  );
}

function Summary({ local, explore }: StageProps) {
  const reveal = explore || local >= 1.2;
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className={`w-[720px] rounded-2xl border border-white/10 bg-[#0D1426]/95 p-8 text-center shadow-[0_40px_120px_-40px_rgba(91,140,255,.6)] transition-all duration-700 ${reveal ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}>
        <LogoMark className="mx-auto h-10 w-10" />
        <h3 className="mt-4 text-[26px] font-bold leading-tight tracking-tight text-fg">Know what changed. Know what was checked.<br /><span className="text-neon">Ship with confidence.</span></h3>
        <div className="mt-6 grid grid-cols-4 gap-3 text-left">
          {[['6', 'files changed'], ['128', 'files scanned'], ['4', 'findings to review'], ['1', 'blocks the commit']].map(([n, l]) => (
            <div key={l} className="rounded-xl border border-white/[.07] bg-white/[.02] px-3 py-2.5"><p className="text-2xl font-semibold text-fg">{n}</p><p className="text-[11px] text-dim">{l}</p></div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-dim">Sample numbers from this demonstration.</p>
        <div className="mt-6 flex justify-center gap-3">
          <a href={INSTALL_URL} className="btn btn-neon !min-h-11 text-sm">Download TrustCode</a>
          <Link href="/#features" className="btn btn-ghost !min-h-11 text-sm">Explore features</Link>
        </div>
      </div>
    </div>
  );
}

/** The scripted mouse pointer in the "evidence" scene: click a finding, then "Next finding". */
function ScriptedCursor({ local }: { local: number }) {
  const pts: [number, number, number][] = [[0, 640, 360], [0.9, PANEL_X + 120, ROW_TOP + ROW_H * 1.5], [5.2, PANEL_X + 120, ROW_TOP + ROW_H * 1.5], [5.9, 1098, 57], [12, 1098, 57]];
  let k = 0;
  while (k < pts.length - 2 && local >= pts[k + 1][0]) k++;
  const [t0, x0, y0] = pts[k], [t1, x1, y1] = pts[k + 1];
  const e = clamp((local - t0) / Math.max(0.001, t1 - t0), 0, 1), ease = e < 0.5 ? 2 * e * e : 1 - (-2 * e + 2) ** 2 / 2;
  const x = x0 + (x1 - x0) * ease, y = y0 + (y1 - y0) * ease;
  const clicking = (local >= 1 && local < 1.35) || (local >= 6 && local < 6.35);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute z-20" style={{ left: x, top: y }}>
      {clicking && <span className="absolute -left-4 -top-4 h-8 w-8 animate-ping rounded-full bg-[var(--neon-cyan)]/50" />}
      <svg width="18" height="22" viewBox="0 0 18 22" className="drop-shadow-[0_2px_4px_rgba(0,0,0,.6)]"><path d="M1 1v17l4.5-4.2 3 6.7 3-1.4-3-6.6H15Z" fill="#fff" stroke="#0B1120" strokeWidth="1.2" /></svg>
    </div>
  );
}

// ==== Mobile stage: one focused panel per scene, same storyboard =============================================

function MobileStage(p: StageProps) {
  const { si, view, touch } = p;
  const id = SCENES[si].id;
  return (
    <div className="min-h-[26rem] bg-[#0B1120] p-4 text-[13px] text-[#C9D3F5]">
      <p className="mb-3 text-xs text-dim"><span className="mono text-brand">{si + 1}</span> · {SCENES[si].chapter}</p>
      {id === 'edits' && (
        <div className="space-y-3">
          <div className="mono rounded-lg border border-white/[.07] bg-[#090E1A] p-3 text-[12px]">
            {AGENT_LOG.filter((l) => p.seen('edits', l.at)).map((l) => <p key={l.text} className="enter"><span className="text-[var(--neon-purple)]">● agent</span> <span className="text-muted">{l.text}</span></p>)}
          </div>
          <MobileCode file="backend/users.py" p={p} />
        </div>
      )}
      {id === 'detected' && (
        <ul className="rounded-lg border border-white/[.07] bg-[#0C1222] py-1">
          {CHANGED.map((n) => (
            <li key={n.path} className={`mono flex items-center justify-between px-3 py-2 text-[12.5px] transition-opacity ${p.seen('detected', n.at ?? 0) ? 'opacity-100' : 'opacity-30'}`}>
              <span>{n.path}</span><span className={n.change === 'A' ? 'text-ok' : 'text-warn'}>{n.change === 'A' ? 'new' : 'modified'}</span>
            </li>
          ))}
          <li className="px-3 py-2 text-[11.5px] text-dim">{view.changes} changes · waiting for edits to settle</li>
        </ul>
      )}
      {id === 'scanned' && (
        <ul className="space-y-1.5">
          {ENGINES.map((e, i) => {
            const done = p.local >= 1 + i * 1.2 || p.explore;
            return (
              <li key={e.name} className="flex items-center gap-2 rounded-lg border border-white/[.06] bg-white/[.02] px-3 py-2">
                <span className="w-4">{done ? (e.state === 'ran' ? <span className="text-ok">✓</span> : <span className="text-dim">–</span>) : <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--neon-cyan)] border-t-transparent" />}</span>
                <span className="font-medium text-fg">{e.name}</span><span className="ml-auto text-[11px] text-dim">{done ? e.note : ''}</span>
              </li>
            );
          })}
        </ul>
      )}
      {(id === 'risks' || id === 'evidence') && (
        <div className="space-y-3">
          <ul className="rounded-lg border border-white/[.07] bg-[#0D1426]">
            {view.findings.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => touch({ finding: f.id, file: f.path })} aria-pressed={view.sf?.id === f.id}
                        className={`flex w-full flex-col px-3 py-2 text-left ${view.sf?.id === f.id ? 'bg-brand/[.14]' : ''}`}>
                  <span className="flex items-center gap-2"><SevTag s={f.severity} small /><span className="font-medium text-fg">{f.title}</span></span>
                  <span className="mono text-[11px] text-dim">{f.path}:{f.line}</span>
                </button>
              </li>
            ))}
          </ul>
          {view.sf && <><MobileCode file={view.sf.path} p={p} /><FindingCard f={view.sf} local={p.local} /></>}
        </div>
      )}
      {id === 'release' && (
        <ol className="space-y-2">
          {PIPELINE.map((s) => {
            const lit = p.explore || p.local >= s.at, blocked = s.blocked && (p.explore || p.local >= 5.2);
            return (
              <li key={s.name} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${blocked ? 'border-err/60 bg-err/10' : lit ? 'border-brand/40 bg-brand/10' : 'border-white/[.06]'}`}>
                <span className={blocked ? 'text-err' : lit ? 'text-ok' : 'text-dim'}>{blocked ? '✖' : lit ? '✓' : '·'}</span>
                <span className="font-medium text-fg">{s.name}</span><span className="ml-auto text-[11px] text-dim">{blocked ? 'Blocked by policy' : s.note}</span>
              </li>
            );
          })}
        </ol>
      )}
      {id === 'finish' && (
        <div className="py-4 text-center">
          <LogoMark className="mx-auto h-9 w-9" />
          <p className="mt-3 text-xl font-bold leading-snug text-fg">Know what changed. Know what was checked. <span className="text-neon">Ship with confidence.</span></p>
          <div className="mt-5 flex flex-col gap-2"><a href={INSTALL_URL} className="btn btn-neon">Download TrustCode</a><Link href="/#features" className="btn btn-ghost">Explore features</Link></div>
        </div>
      )}
    </div>
  );
}

function MobileCode({ file, p }: { file: string; p: StageProps }) {
  const src = FILES[file];
  const f = p.view.findings.find((x) => x.path === file);
  return (
    <pre className="mono overflow-x-auto rounded-lg border border-white/[.07] bg-[#090E1A] py-2 text-[12px] leading-6">
      {src.lines.map((l, i) => {
        const n = src.start + i, hit = f && f.line === n;
        const text = p.si === 0 && n === 42 ? l.slice(0, Math.round(l.length * p.view.typed)) : l;
        return <div key={n} className="flex pr-3" style={hit ? { background: `color-mix(in srgb, ${SEV[f.severity].color} 16%, transparent)` } : undefined}><span className="w-9 shrink-0 pr-2 text-right text-dim">{n}</span><code className="whitespace-pre">{text}</code></div>;
      })}
    </pre>
  );
}

// ==== Chrome =================================================================================================

function SevTag({ s, small = false }: { s: Severity; small?: boolean }) {
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 font-semibold ${small ? 'text-[10.5px]' : 'text-[11px]'}`}
               style={{ color: SEV[s].color, background: `color-mix(in srgb, ${SEV[s].color} 14%, transparent)` }}>{SEV[s].glyph} {SEV[s].label}</span>;
}

function Caption({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <p key={text} className="enter max-w-[46rem] rounded-lg bg-black/75 px-4 py-2 text-center text-sm leading-snug text-white sm:text-base">{text}</p>
    </div>
  );
}

function ChapterCard({ n, title }: { n: number; title: string }) {
  return (
    <div className="chapter-card pointer-events-none absolute left-5 top-5 flex items-center gap-3 rounded-xl border border-white/10 bg-[#0B1120]/85 px-4 py-2.5 backdrop-blur">
      <span className="mono text-sm text-[var(--neon-cyan)]">{String(n).padStart(2, '0')}</span>
      <span className="font-semibold text-fg">{title}</span>
    </div>
  );
}

function Poster({ onPlay, onExplore }: { onPlay: () => void; onExplore: () => void }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-[radial-gradient(60%_60%_at_50%_45%,rgba(20,28,58,.55),rgba(6,10,20,.88))] p-6 text-center">
      <button type="button" onClick={onPlay} aria-label={`Play the walkthrough, ${fmt(TOTAL)}`}
              className="group relative flex h-20 w-20 items-center justify-center rounded-full bg-[linear-gradient(135deg,#4F7BFF,#A97CFF)] shadow-[0_0_60px_-6px_rgba(120,110,255,.9)] transition-transform hover:scale-105">
        <span aria-hidden="true" className="pulse-soft absolute -inset-3 rounded-full border border-white/20" />
        <PlayGlyph big />
      </button>
      <div>
        <p className="text-lg font-semibold text-fg sm:text-xl">Watch the walkthrough · {fmt(TOTAL)}</p>
        <p className="mt-1 text-sm text-muted">Seven scenes. Click anything to explore.</p>
      </div>
      <button type="button" onClick={onExplore} className="btn btn-ghost !min-h-10 text-sm">Or explore it yourself</button>
    </div>
  );
}

function Ctl({ label, onClick, children, primary, disabled, pressed, className = '' }: { label: string; onClick: () => void; children: React.ReactNode; primary?: boolean; disabled?: boolean; pressed?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-pressed={pressed}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors ${primary ? 'bg-brand/20 text-fg hover:bg-brand/30' : pressed ? 'bg-white/10 text-fg' : 'text-muted hover:bg-white/[.06] hover:text-fg'} ${className}`}>
      {children}
    </button>
  );
}

const G = ({ children, big }: { children: React.ReactNode; big?: boolean }) => <svg viewBox="0 0 24 24" className={big ? 'h-9 w-9 text-white' : 'h-[18px] w-[18px]'} fill="currentColor" aria-hidden="true">{children}</svg>;
const PlayGlyph = ({ big }: { big?: boolean }) => <G big={big}><path d="M8 5.5v13l10.5-6.5z" /></G>;
const PauseGlyph = () => <G><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></G>;
const PrevGlyph = () => <G><path d="M6 5h2.5v14H6zM19 5v14L9.5 12z" /></G>;
const NextGlyph = () => <G><path d="M15.5 5H18v14h-2.5zM5 5v14l9.5-7z" /></G>;
const ReplayGlyph = () => <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>;
const FsGlyph = () => <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
