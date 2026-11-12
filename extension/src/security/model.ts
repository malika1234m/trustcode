// Security scan report handling and the Security tab (pure: no vscode import -> unit-testable).
// The report comes from a local program, so it is validated before use. Nothing here explains code at length:
// a finding is a title, a location, a severity, a confidence and one line of evidence.
import { esc } from '../render';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];
export interface SecFinding {
  fingerprint: string; ruleId: string; category: string; title: string; severity: Severity; confidence: string; state: string;
  path: string; line: number; col: number; endLine: number; endCol: number; fileLevel: boolean;
  evidence: string; reason: string; remediation: string; source: string; alsoReportedBy: string[]; review?: { reason?: string; by?: string; at?: string };
}
export interface SecReport {
  mode: string; status: 'complete' | 'incomplete' | 'failed'; durationMs: number; generatedAt: string; findings: SecFinding[];
  files: { included: number; scanned: number; fromCache: number; excluded: Record<string, number>; samples: Record<string, string[]>; git: boolean };
  checks: Array<{ name: string; status: string; detail: string }>; coverage: Array<{ language: string; files: number; analysis: string }>;
  tools: Array<{ name: string; role: string; installed: boolean; version?: string; status: string; detail: string }>; notes: string[];
  baseline: { present: boolean; resolved: number; notRevalidated: number; suppressed: number };
  gate: { decision: string; reasons: string[] };
  disabledRules: string[];
}

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, min = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : min);
const SAFE_PATH = (p: string) => !!p && !p.startsWith('/') && !p.includes('\0') && !p.split('/').includes('..') && !/^[A-Za-z]:/.test(p);

/** Validates scanner output. Anything malformed is dropped; a report that is not a report is rejected. */
export function parseReport(text: string): SecReport | undefined {
  let d: any;
  try { d = JSON.parse(text); } catch { return undefined; }
  if (!d || typeof d !== 'object' || d.schema !== 1 || !Array.isArray(d.findings) || !['complete', 'incomplete', 'failed'].includes(d.status)) return undefined;
  const findings: SecFinding[] = [];
  for (const f of d.findings.slice(0, 5000)) {
    if (!f || typeof f !== 'object' || !SAFE_PATH(str(f.path, 600)) || !SEVERITIES.includes(f.severity)) continue;
    const line = num(f.line, 1), col = num(f.col, 1);
    findings.push({
      fingerprint: str(f.fingerprint, 64).replace(/[^a-f0-9]/g, ''), ruleId: str(f.rule_id, 80), category: str(f.category, 60), title: str(f.title, 160),
      severity: f.severity, confidence: ['confirmed', 'strongly_suspected', 'potential'].includes(f.confidence) ? f.confidence : 'potential',
      state: ['new', 'existing', 'reintroduced', 'suppressed', 'unclassified'].includes(f.state) ? f.state : 'unclassified',
      path: str(f.path, 600), line, col, endLine: Math.max(line, num(f.end_line, 1)), endCol: num(f.end_col, 1), fileLevel: f.file_level === true,
      evidence: str(f.evidence, 240), reason: str(f.reason, 320), remediation: str(f.remediation, 240), source: str(f.source, 120),
      alsoReportedBy: Array.isArray(f.also_reported_by) ? f.also_reported_by.map((x: unknown) => str(x, 80)).filter(Boolean).slice(0, 6) : [],
      review: f.review && typeof f.review === 'object' ? { reason: str(f.review.reason), by: str(f.review.reviewed_by, 100), at: str(f.review.reviewed_at, 40) } : undefined,
    });
  }
  const counts = (o: any): Record<string, number> => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).map(([k, v]) => [String(k).slice(0, 80), num(v)]));
  const list = (v: any) => (Array.isArray(v) ? v : []);
  return {
    mode: str(d.mode, 20), status: d.status, durationMs: num(d.duration_ms), generatedAt: str(d.generated_at, 40), findings,
    files: { included: num(d.files?.included), scanned: num(d.files?.scanned), fromCache: num(d.files?.from_cache), excluded: counts(d.files?.excluded),
      samples: Object.fromEntries(Object.entries(d.files?.excluded_samples ?? {}).map(([k, v]) => [String(k).slice(0, 80), list(v).map((x: unknown) => str(x, 300)).slice(0, 8)])), git: d.files?.git === true },
    checks: list(d.checks).map((c: any) => ({ name: str(c?.name, 160), status: str(c?.status, 20), detail: str(c?.detail) })),
    coverage: list(d.coverage).map((c: any) => ({ language: str(c?.language, 40), files: num(c?.files), analysis: str(c?.analysis, 120) })),
    tools: list(d.tools).map((t: any) => ({ name: str(t?.name, 40), role: str(t?.role, 120), installed: t?.installed === true, version: str(t?.version, 60) || undefined, status: str(t?.status, 80), detail: str(t?.detail) })),
    notes: list(d.notes).map((n: unknown) => str(n, 500)).filter(Boolean),
    baseline: { present: d.baseline?.present === true, resolved: list(d.baseline?.resolved).length, notRevalidated: list(d.baseline?.not_revalidated).length, suppressed: num(d.baseline?.suppressed) },
    gate: { decision: str(d.gate?.decision, 20), reasons: list(d.gate?.reasons).map((r: unknown) => str(r, 500)) },
    disabledRules: list(d.disabled_rules).map((x: unknown) => str(x, 80)).filter((x: string) => /^[A-Za-z0-9._-]+$/.test(x)).slice(0, 200),
  };
}

export const visible = (r: SecReport) => r.findings.filter((f) => f.state !== 'suppressed');
export function countBySeverity(r: SecReport): Record<Severity, number> {
  const out = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<Severity, number>;
  for (const f of visible(r)) out[f.severity]++;
  return out;
}
const order = (f: SecFinding) => SEVERITIES.indexOf(f.severity);
export const sortFindings = (fs: SecFinding[]) => [...fs].sort((a, b) => order(a) - order(b) || a.path.localeCompare(b.path) || a.line - b.line || a.col - b.col);

/** Next / previous finding relative to a position, wrapping around. Ordered by file then position. */
export function neighbour(findings: SecFinding[], at: { path?: string; line: number; col: number } | undefined, dir: 1 | -1): SecFinding | undefined {
  const sorted = [...findings].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.col - b.col);
  if (!sorted.length) return undefined;
  if (!at?.path) return dir === 1 ? sorted[0] : sorted[sorted.length - 1];
  const cmp = (f: SecFinding) => f.path.localeCompare(at.path!) || f.line - at.line || f.col - at.col;
  const hit = dir === 1 ? sorted.find((f) => cmp(f) > 0) : [...sorted].reverse().find((f) => cmp(f) < 0);
  return hit ?? (dir === 1 ? sorted[0] : sorted[sorted.length - 1]);
}

export type GroupBy = 'severity' | 'file' | 'category';
export interface SecurityModel {
  availability: 'ready' | 'missing' | 'untrusted' | 'no-workspace'; scanning?: { mode: string; detail?: string; done?: number; total?: number }; report?: SecReport; error?: string; groupBy: GroupBy;
  automatic: boolean; scannerCommand: string; hooks?: Record<string, string>; online: boolean;
}
const CONFIDENCE: Record<string, [string, string]> = { confirmed: ['Confirmed', 'st-failed'], strongly_suspected: ['Strongly suspected', 'st-issue'], potential: ['Needs review', 'st-review'] };
const STATE: Record<string, [string, string]> = { new: ['New', 'st-issue'], reintroduced: ['Reintroduced', 'st-failed'], existing: ['In baseline', 'st-notrun'], unclassified: ['', ''], suppressed: ['Reviewed', 'st-notrun'] };
const MODE: Record<string, string> = { full: 'Entire project', changed: 'Changed files', new: 'New files', staged: 'Before commit (staged files)', push: 'Before push (outgoing changes)', production: 'Before production', ci: 'CI' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function findingRow(f: SecFinding): string {
  const [conf, confCls] = CONFIDENCE[f.confidence] ?? CONFIDENCE.potential;
  const [state, stateCls] = STATE[f.state] ?? STATE.unclassified;
  return `<li class="finding sec sev-${esc(f.severity)}" data-fid="${esc(f.fingerprint)}">
    <div class="f-head"><span class="pill sev-${esc(f.severity)}">${esc(f.severity.toUpperCase())}</span><span class="f-title">${esc(f.title)}</span></div>
    <button class="link floc" data-action="secOpen" data-finding="${esc(f.fingerprint)}">${esc(f.path)}${f.fileLevel ? ' (file-level)' : `:${f.line}:${f.col}`}</button>
    <div class="f-badges"><span class="chip st-notrun">${esc(f.category)}</span><span class="chip ${confCls}">${esc(conf)}</span>${state ? `<span class="chip ${stateCls}">${esc(state)}</span>` : ''}</div>
    <p class="sec-reason">${esc(f.reason)}</p>
    ${f.evidence ? `<pre class="sec-ev">${esc(f.evidence)}</pre>` : ''}
    <p class="muted small">${esc(f.ruleId)} · ${esc(f.source)}${f.alsoReportedBy.length ? ` · also ${esc(f.alsoReportedBy.join(', '))}` : ''}${f.remediation ? ` · Fix: ${esc(f.remediation)}` : ''}</p>
    <div class="f-actions"><button class="mini" data-action="secReview" data-finding="${esc(f.fingerprint)}">Mark as reviewed false positive…</button>
      <button class="mini" data-action="secDisableRule" data-key="${esc(f.ruleId)}" title="Stop reporting this rule in this project (recorded in .trustcode/config.json)">Disable rule ${esc(f.ruleId)}…</button></div></li>`;
}

export function findingsPanel(r: SecReport, groupBy: GroupBy): string {
  const all = sortFindings(visible(r));
  if (!all.length) {
    return `<section class="card"><h3 class="section-label">Findings</h3><p>No rule matched in the ${plural(r.files.scanned, 'file')} that were scanned.
      That is <strong>not</strong> a statement that the project is secure — see the checks that were skipped${r.status === 'complete' ? '' : ' or failed'} below.</p></section>`;
  }
  const keyOf = (f: SecFinding) => (groupBy === 'file' ? f.path : groupBy === 'category' ? f.category : f.severity);
  const keys = groupBy === 'severity' ? SEVERITIES.filter((s) => all.some((f) => f.severity === s)) : [...new Set(all.map(keyOf))].sort();
  const shown = all.slice(0, 300);
  const groups = keys.map((k) => {
    const items = shown.filter((f) => keyOf(f) === k);
    return items.length ? `<details ${groupBy === 'severity' && (k === 'low' || k === 'info') ? '' : 'open'}><summary class="sev-group">${esc(groupBy === 'severity' ? String(k).toUpperCase() : k)} <span class="muted">(${all.filter((f) => keyOf(f) === k).length})</span></summary>
      <ul class="findings">${items.map(findingRow).join('')}</ul></details>` : '';
  }).join('');
  const seg = (['severity', 'file', 'category'] as GroupBy[]).map((g) => `<button data-action="secGroup" data-key="${g}" class="${g === groupBy ? 'on' : ''}" aria-pressed="${g === groupBy}">${g[0].toUpperCase() + g.slice(1)}</button>`).join('');
  return `<section aria-labelledby="h-secf"><h3 id="h-secf" class="section-label">Findings (${all.length})</h3>
    <div class="level-bar"><span class="muted small">Group by</span><div class="segmented" role="group" aria-label="Group findings by">${seg}</div>
      <button class="mini" data-action="secPrev">◀ Previous</button><button class="mini" data-action="secNext">Next ▶</button></div>
    ${groups}${all.length > 300 ? `<p class="note">Showing the 300 most severe of ${all.length}. All of them are in the Problems panel.</p>` : ''}</section>`;
}

export function securityPage(m: SecurityModel): string {
  const busy = !!m.scanning;
  const dis = busy || m.availability !== 'ready' ? 'disabled' : '';
  const controls = `<section class="card"><div class="card-title">Scan</div>
    <button class="primary wide" data-action="secScan" data-key="full" ${dis}>Scan entire project</button>
    <div class="row"><button data-action="secScan" data-key="changed" ${dis}>Changed files</button><button data-action="secScan" data-key="new" ${dis} title="Files Git does not track yet">New files</button><button data-action="secScan" data-key="staged" ${dis}>Before commit</button>
      <button data-action="secScan" data-key="push" ${dis}>Before push</button><button data-action="secScan" data-key="production" ${dis}>Before production</button>
      <button data-action="secRescan" ${dis} title="Run the last scan again without the cache">Rescan</button></div>
    <label class="toggle"><input type="checkbox" data-action="setSetting" data-key="scanner.automatic" ${m.automatic ? 'checked' : ''}><span><strong>Scan automatically when files change</strong><br>
      <span class="muted small">Waits until changes settle, then rescans only what changed. Works for any tool that edits files — no agent integration needed.</span></span></label>
    <p class="note">Scanning runs on this machine. Project files are read, never executed, and nothing is uploaded${m.online ? ' except dependency names and versions for the advisory lookup you enabled' : ''}.</p></section>`;
  if (m.availability === 'no-workspace') return `<section class="card onboarding"><div class="card-title">Open a folder to scan</div><p class="muted">The security scanner examines the files of a project folder.</p></section>`;
  if (m.availability === 'untrusted') return `<section class="card onboarding"><div class="card-title">Workspace not trusted</div><p class="muted">The scanner starts a local program and Git. That is only done in workspaces you have marked as trusted.</p></section>`;
  if (m.availability === 'missing') {
    return `${controls}<section class="card alert" role="alert"><div class="alert-head"><span class="alert-icon" aria-hidden="true">!</span><h3>Scanner not found</h3></div>
      <p>The local scanner <code>${esc(m.scannerCommand)}</code> could not be started, so <strong>nothing was scanned</strong>.</p>
      <p class="muted small">Install it yourself (TrustCode never installs software for you): <code>pip install "trustcode-worker[tools]"</code> from the repository's <code>verification-worker</code> folder, or set <code>trustcode.scanner.path</code> to the full path of <code>trustcode-scan</code>.</p>
      <div class="row"><button data-action="secSettings">Scanner settings…</button><button data-action="secCheck">Check again</button></div></section>`;
  }
  const r = m.report;
  const progress = busy ? `<section class="card progress" aria-busy="true"><div class="spinner" aria-hidden="true"></div><div><strong>Scanning — ${esc(MODE[m.scanning!.mode] ?? m.scanning!.mode)}…</strong>
    ${m.scanning!.detail ? `<div class="muted small">${esc(m.scanning!.detail)}${m.scanning!.total ? ` — ${m.scanning!.done ?? 0} of ${m.scanning!.total} files` : ''}</div>` : ''}
    ${m.scanning!.total ? `<progress max="${m.scanning!.total}" value="${m.scanning!.done ?? 0}" aria-label="Scan progress"></progress>` : ''}
    <div class="row"><button data-action="secCancel">Cancel</button></div></div></section>` : '';
  if (!r) {
    return `${progress}${controls}${m.error ? `<section class="card alert" role="alert"><p>${esc(m.error)}</p></section>` : ''}
      <section class="empty-state"><p>No scan has been run in this window yet.</p><p class="muted small">A full scan covers tracked and untracked files, configuration, environment files, CI and agent settings.</p></section>`;
  }
  const c = countBySeverity(r);
  const tile = (n: number, label: string, cls = 'neutral') => `<div class="tile ${cls}"><div class="num">${n}</div><div class="lbl">${esc(label)}</div></div>`;
  const statusChip = r.status === 'complete' ? '<span class="chip st-notrun">Scan complete</span>' : r.status === 'incomplete' ? '<span class="chip st-failed">✕ Scan INCOMPLETE</span>' : '<span class="chip st-failed">✕ Scan failed</span>';
  const withFindings = new Set(visible(r).map((f) => f.path)).size;
  const st = (s: string) => r.findings.filter((f) => f.state === s).length;
  const gate = r.gate.decision && r.gate.decision !== 'not_applicable' ? `<div class="headline ${r.gate.decision === 'allow' ? 'no-findings' : 'has-findings'}" role="status">
      <div class="headline-main">${r.gate.decision === 'block' ? 'Policy decision: BLOCK' : r.gate.decision === 'warn' ? 'Policy decision: WARN' : 'Policy decision: allow'}</div>
      <div class="headline-sub">${esc(r.gate.reasons.join(' '))}</div></div>` : '';
  const checkIcon: Record<string, [string, string]> = { completed: ['✓', 'st-notrun'], skipped: ['–', 'st-notrun'], failed: ['✕', 'st-failed'] };
  const excluded = Object.entries(r.files.excluded);
  const suppressed = r.findings.filter((f) => f.state === 'suppressed');
  return `${progress}${controls}${m.error ? `<section class="card alert" role="alert"><p>${esc(m.error)}</p></section>` : ''}
    <section class="card" aria-labelledby="h-sov"><h3 id="h-sov" class="section-label">Security overview</h3>
      <div class="sess-status">${statusChip} <span class="muted small">${esc(MODE[r.mode] ?? r.mode)} · ${(r.durationMs / 1000).toFixed(1)} s · ${esc(r.generatedAt.replace('T', ' ').slice(0, 16))}</span></div>
      ${r.status !== 'complete' ? '<p class="err small">Some checks did not run. The numbers below do not cover them — see “Checks”.</p>' : ''}
      <div class="tiles four">${tile(r.files.scanned, 'Files scanned')}${tile(withFindings, 'Files with findings', withFindings ? 'warn' : 'neutral')}${tile(c.critical, 'Critical', c.critical ? 'err' : 'neutral')}${tile(c.high, 'High', c.high ? 'err' : 'neutral')}</div>
      <div class="tiles four">${tile(c.medium, 'Medium', c.medium ? 'warn' : 'neutral')}${tile(c.low, 'Low')}${tile(c.info, 'Informational')}${tile(r.files.fromCache, 'Unchanged (reused)')}</div>
      ${r.baseline.present ? `<p class="muted small">Baseline: ${st('new')} new · ${st('reintroduced')} reintroduced · ${st('existing')} already in the baseline · ${r.baseline.resolved} resolved · ${r.baseline.notRevalidated} not revalidated · ${r.baseline.suppressed} reviewed.</p>`
        : '<p class="muted small">No baseline yet: findings are not classified as new or existing.</p>'}
      <div class="row"><button data-action="secBaseline" ${dis} title="Run a full scan and record its findings as the existing state. They stay visible; later scans show what is new.">${r.baseline.present ? 'Update baseline' : 'Set baseline from a full scan'}</button></div>
      ${r.notes.map((n) => `<p class="hint small" role="note">${esc(n)}</p>`).join('')}</section>
    ${gate}${findingsPanel(r, m.groupBy)}
    ${suppressed.length ? `<details class="card"><summary class="card-title">Reviewed false positives (${suppressed.length})</summary><ul class="plain">${suppressed.map((f) => `<li><code>${esc(f.path)}:${f.line}</code> ${esc(f.title)} — “${esc(f.review?.reason ?? '')}” <span class="muted small">${esc(f.review?.by ?? '')} ${esc((f.review?.at ?? '').slice(0, 10))}</span></li>`).join('')}</ul>
      <p class="muted small">Stored in <code>.trustcode/reviewed.json</code>. A review covers one exact line; if the line changes, the finding is reported again.</p></details>` : ''}
    <details class="card" ${r.status === 'complete' ? '' : 'open'}><summary class="card-title">Checks (${r.checks.filter((x) => x.status === 'completed').length} completed, ${r.checks.filter((x) => x.status === 'skipped').length} skipped, ${r.checks.filter((x) => x.status === 'failed').length} failed)</summary>
      <ul class="plain">${r.checks.map((x) => { const [i, cls] = checkIcon[x.status] ?? ['?', 'st-review']; return `<li><span class="chip ${cls}">${i} ${esc(x.status)}</span> <strong>${esc(x.name)}</strong>${x.detail ? ` <span class="muted small">— ${esc(x.detail)}</span>` : ''}</li>`; }).join('')}</ul></details>
    <details class="card"><summary class="card-title">Coverage and exclusions</summary>
      <ul class="plain">${r.coverage.map((x) => `<li><strong>${esc(x.language)}</strong>: ${plural(x.files, 'file')} — ${esc(x.analysis)}</li>`).join('')}</ul>
      <p class="muted small">“Generic patterns only” means credentials and configuration were checked, but no language-specific rules exist for that file type.</p>
      <div class="card-title">Not scanned (${excluded.reduce((n, [, v]) => n + v, 0)} of ${r.files.included + excluded.reduce((n, [, v]) => n + v, 0)} entries)</div>
      <ul class="plain">${excluded.map(([reason, n]) => `<li>${n} — ${esc(reason)}${r.files.samples[reason]?.length ? ` <span class="muted small">(${esc(r.files.samples[reason].slice(0, 3).join(', '))}${n > 3 ? '…' : ''})</span>` : ''}</li>`).join('') || '<li class="muted">nothing was excluded</li>'}</ul></details>
    <details class="card"><summary class="card-title">Scanners and Git gates</summary>
      <ul class="plain">${r.tools.map((t) => `<li><span class="chip ${t.status === 'ready' ? 'st-notrun' : t.installed ? 'st-review' : 'st-failed'}">${esc(t.status)}</span> <strong>${esc(t.name)}</strong> <span class="muted small">${esc(t.version ?? '')} — ${esc(t.role)}${t.detail ? `. ${esc(t.detail)}` : ''}</span></li>`).join('')}</ul>
      ${r.disabledRules.length ? `<div class="card-title">Disabled rules (${r.disabledRules.length})</div><ul class="plain">${r.disabledRules.map((id) => `<li><code>${esc(id)}</code> <button class="mini" data-action="secEnableRule" data-key="${esc(id)}">Enable</button></li>`).join('')}</ul>` : ''}
      ${m.hooks ? `<div class="card-title">Git hooks</div><ul class="plain">${Object.entries(m.hooks).map(([k, v]) => `<li><strong>${esc(k)}</strong>: ${esc(v)}</li>`).join('')}</ul>` : ''}
      <div class="row"><button data-action="secHooks">Install Git hooks…</button><button data-action="secCi">CI workflow example</button><button data-action="secSettings">Scanner settings…</button><button data-action="secConfig">Rules &amp; exclusions…</button></div>
      <p class="muted small">Hooks are only written when no other hook exists. A local hook can be skipped with <code>--no-verify</code>, so use the CI workflow as the backstop.</p></details>`;
}
