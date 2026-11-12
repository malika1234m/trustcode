'use client';
import { useEffect, useRef, useState } from 'react';
import { CheckIcon, FileIcon, MinusIcon, PlayIcon, RefreshIcon } from '@/components/icons';
import { type Status } from '@/lib/capabilities';
import { DemoTag, SeverityLabel, StatusBadge, type Severity } from './badges';

// Simulated scan. Nothing is analysed in the browser: files, findings and timings are fixed demonstration data.
type Finding = {
  id: string; severity: Severity; title: string; file: string; line: number; rule: string; ruleStatus: Status;
  reason: string; fix: string; code: string[]; codeStart: number;
};

const FINDINGS: Finding[] = [
  { id: 'f1', severity: 'critical', title: 'Exposed credential', file: 'config/.env.production', line: 4,
    rule: 'Credential in an environment file', ruleStatus: 'planned',
    reason: 'Potential production secret detected in a project file.', fix: 'Rotate the key and load it from a secret manager.',
    code: ['NODE_ENV=production', 'PORT=8080', 'DATABASE_URL=${DB_URL}', 'STRIPE_SECRET_KEY=sk_live_51Hx…[masked]', 'LOG_LEVEL=info'], codeStart: 1 },
  { id: 'f2', severity: 'high', title: 'SQL injection', file: 'backend/routes/users.py', line: 38,
    rule: 'User input in a SQL string', ruleStatus: 'available',
    reason: 'User-controlled input is incorporated into a SQL query.', fix: 'Use a parameterised query.',
    code: ['from flask import jsonify', '', '@app.get("/users/<user_id>")', 'def get_user(user_id):', '    cur = db.cursor()',
      '    cur.execute(f"SELECT * FROM users WHERE id = {user_id}")', '    row = cur.fetchone()', '    return jsonify(row)'], codeStart: 33 },
  { id: 'f3', severity: 'high', title: 'Command injection', file: 'backend/jobs/export.py', line: 21,
    rule: 'Request data in a shell command', ruleStatus: 'available',
    reason: 'A request value reaches a command run with shell=True.', fix: 'Pass arguments as a list, without a shell.',
    code: ['import subprocess', '', 'def export(request):', '    name = request.args["name"]', '    subprocess.run(f"tar -czf /tmp/{name}.tgz data/", shell=True)', '    return {"ok": True}'], codeStart: 17 },
  { id: 'f4', severity: 'medium', title: 'JWT signature not verified', file: 'backend/auth/tokens.py', line: 14,
    rule: 'JWT decoded without verification', ruleStatus: 'in-development',
    reason: 'The token is decoded with signature verification turned off.', fix: 'Verify the signature and pin the algorithm.',
    code: ['import jwt', '', 'def current_user(token):', '    claims = jwt.decode(token, options={"verify_signature": False})', '    return claims["sub"]'], codeStart: 11 },
  { id: 'f5', severity: 'medium', title: 'Package not found on npm', file: 'frontend/src/api/client.ts', line: 3,
    rule: 'Imported package does not exist', ruleStatus: 'available',
    reason: 'axios-retry-helper is not on the npm registry. It may be a hallucinated name.', fix: 'Check the name before installing anything.',
    code: ["import axios from 'axios';", "import { z } from 'zod';", "import retry from 'axios-retry-helper';", '', 'export const api = retry(axios.create());'], codeStart: 1 },
  { id: 'f6', severity: 'low', title: 'Cookie without HttpOnly', file: 'frontend/server/session.ts', line: 19,
    rule: 'Session cookie flags', ruleStatus: 'in-development',
    reason: 'The session cookie can be read by page scripts.', fix: 'Set httpOnly: true on the session cookie.',
    code: ['export function start(res, session) {', '  res.cookie("sid", session.id, {', '    secure: true,', '    sameSite: "lax",', '  });', '}'], codeStart: 18 },
];

const FILES = ['backend/routes/users.py', 'backend/routes/orders.py', 'backend/jobs/export.py', 'backend/auth/tokens.py', 'backend/db.py',
  'config/.env.production', 'config/settings.py', 'frontend/src/api/client.ts', 'frontend/src/pages/account.tsx', 'frontend/server/session.ts'];
const TOTAL = 42;
const ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];
const SEV_VAR: Record<Severity, string> = { critical: 'var(--err)', high: 'var(--warn)', medium: 'var(--info)', low: 'var(--dim)' };

type Phase = 'running' | 'done';

export function ProjectScanDemo() {
  const [phase, setPhase] = useState<Phase>('done');
  const [scanned, setScanned] = useState(TOTAL);
  const [selected, setSelected] = useState('f2');
  const [run, setRun] = useState(0);
  const timer = useRef<number | null>(null);
  const editor = useRef<HTMLDivElement>(null);

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const replay = () => {
    if (timer.current) window.clearInterval(timer.current);
    setRun((r) => r + 1);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setScanned(TOTAL); setPhase('done'); return; }
    setScanned(0); setPhase('running');
    let n = 0;
    timer.current = window.setInterval(() => {
      n += 1;
      setScanned(Math.min(n, TOTAL));
      if (n >= TOTAL) { window.clearInterval(timer.current!); timer.current = null; setPhase('done'); }
    }, 45);
  };

  const view = (id: string) => {
    setSelected(id);
    if (window.matchMedia('(max-width: 1023px)').matches) editor.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const f = FINDINGS.find((x) => x.id === selected)!;
  const done = phase === 'done';
  const pct = Math.round((scanned / TOTAL) * 100);
  const current = FILES[Math.min(FILES.length - 1, Math.floor((scanned / TOTAL) * FILES.length))];

  return (
    <div className="neon-frame overflow-hidden rounded-[20px]">
      {/* Title bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/[.07] px-4 py-3 sm:px-5">
        <span aria-hidden="true" className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-err/70" /><span className="h-2.5 w-2.5 rounded-full bg-warn/70" /><span className="h-2.5 w-2.5 rounded-full bg-ok/70" /></span>
        <span className="font-semibold">acme-shop</span>
        <DemoTag />
        <button type="button" onClick={replay} disabled={!done} className="btn btn-neon ml-auto !min-h-10 !py-2 text-sm">
          {run === 0 ? <><PlayIcon className="h-4 w-4" />Run the demo scan</> : <><RefreshIcon className="h-4 w-4" />Run again</>}
        </button>
      </div>

      {/* Progress */}
      <div className="border-b border-white/[.07] px-4 py-3 sm:px-5" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
          {done ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-medium">Scan complete</span>
              <span className="text-muted">{TOTAL} files, {FINDINGS.length} findings</span>
              {ORDER.map((s) => <span key={s} className="flex items-center gap-1.5"><SeverityLabel severity={s} /><b className="font-semibold">{FINDINGS.filter((x) => x.severity === s).length}</b></span>)}
            </p>
          ) : (
            <p>Scanning <span className="mono text-muted">{current}</span></p>
          )}
          <span className="text-muted">{scanned}/{TOTAL}</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[.06]" role="progressbar" aria-label="Demo scan progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--neon-blue),var(--neon-cyan))]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Findings */}
        <nav aria-label="Demo findings" className="border-b border-white/[.07] py-2 max-lg:max-h-64 max-lg:overflow-y-auto lg:border-b-0 lg:border-r">
          {!done ? (
            <div className="space-y-2 px-4 py-2 sm:px-5" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 animate-pulse rounded-md bg-white/[.04]" />)}
            </div>
          ) : ORDER.map((s) => (
            <div key={`${s}-${run}`}>
              <p className="px-4 pb-1 pt-2.5 sm:px-5"><SeverityLabel severity={s} /></p>
              <ul>
                {FINDINGS.filter((x) => x.severity === s).map((x) => (
                  <li key={x.id} className="enter" style={{ animationDelay: `${FINDINGS.indexOf(x) * 70}ms` }}>
                    <button type="button" onClick={() => view(x.id)} aria-current={selected === x.id ? 'true' : undefined}
                            className={`relative flex w-full flex-col items-start px-4 py-2 text-left transition-colors sm:px-5 ${selected === x.id ? 'bg-brand/[.12]' : 'hover:bg-white/[.03]'}`}>
                      {selected === x.id && <span aria-hidden="true" className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand" />}
                      <span className="text-sm font-medium">{x.title}</span>
                      <span className="mono text-xs text-muted">{x.file}:{x.line}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Editor */}
        <div ref={editor} className="relative min-h-[22rem] scroll-mt-24 overflow-hidden bg-[#0A1020]/70">
          <div className="flex items-center gap-2 border-b border-white/[.06] text-xs">
            <span className="flex items-center gap-2 border-b-2 border-brand px-4 py-2.5 text-fg"><FileIcon className="h-3.5 w-3.5 text-dim" /><span className="mono">{f.file.split('/').pop()}</span></span>
            <span className="mono hidden truncate px-2 text-dim sm:inline">{f.file}</span>
          </div>
          {!done && <div aria-hidden="true" className="sweep pointer-events-none absolute inset-x-0 top-10 z-10 h-10 bg-[linear-gradient(180deg,transparent,rgba(56,225,255,.2),transparent)] [box-shadow:0_1px_0_rgba(56,225,255,.6)] [animation-duration:1.6s]" />}
          <pre className="mono overflow-x-auto py-3 text-[13px] leading-[1.7]">
            {f.code.map((l, i) => {
              const n = f.codeStart + i;
              const hit = done && n === f.line;
              return (
                <div key={`${f.id}-${n}`}>
                  <div className="flex pr-4" style={hit ? { background: `color-mix(in srgb, ${SEV_VAR[f.severity]} 14%, transparent)`, boxShadow: `inset 3px 0 0 ${SEV_VAR[f.severity]}` } : undefined}>
                    <span className="w-12 shrink-0 select-none pr-4 text-right" style={{ color: hit ? SEV_VAR[f.severity] : 'var(--dim)' }}>{n}</span>
                    <code className={`whitespace-pre ${hit ? 'text-fg' : 'text-[#C9D3F5]'}`} style={hit ? { textDecoration: `underline wavy ${SEV_VAR[f.severity]}`, textUnderlineOffset: '5px', textDecorationThickness: '1px' } : undefined}>{l || ' '}</code>
                  </div>
                  {hit && (
                    <div className="enter mx-3 my-2 whitespace-normal rounded-lg border bg-[#0F1830] p-3.5 font-sans text-sm sm:ml-12"
                         style={{ borderColor: `color-mix(in srgb, ${SEV_VAR[f.severity]} 45%, transparent)` }}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><SeverityLabel severity={f.severity} /><span className="font-semibold">{f.title}</span></div>
                      <p className="mt-1.5 text-muted">{f.reason}</p>
                      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-dim">Rule: <span className="text-muted">{f.rule}</span><StatusBadge status={f.ruleStatus} /></p>
                      <p className="mt-1 text-xs text-dim">Fix: <span className="text-muted">{f.fix}</span></p>
                    </div>
                  )}
                </div>
              );
            })}
          </pre>
        </div>
      </div>

      {/* Coverage */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-white/[.07] px-4 py-3 text-xs text-muted sm:px-5">
        <span className="flex items-center gap-1.5"><CheckIcon className="h-3.5 w-3.5 text-ok" />Checked: security rules, credential formats, packages</span>
        <span className="flex items-center gap-1.5"><MinusIcon className="h-3.5 w-3.5 text-dim" />Not checked: 2 images, 1 oversized file, tests</span>
      </div>
    </div>
  );
}
