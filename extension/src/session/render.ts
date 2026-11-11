// Session dashboard renderers (pure: no vscode import -> unit-testable). Every dynamic value is escaped.
// Nothing here states or implies that a change is safe or correct; counts describe evidence only.
import { esc, STATUS_LABEL } from '../render';
import { Completion, Counts, EffectiveChange, Skipped, verificationKey } from './model';
import { MergedReport, RunComparison, RunRecord, SessionFinding } from './report';

export interface DashboardSettings {
  depth: string; defaultScope: string; inactivitySeconds: number; sendBaseline: boolean; includeRelated: boolean;
  auto: { agentFinished: boolean; inactivity: boolean; sessionEnd: boolean; save: boolean; batch: boolean }; batchSize: number;
}
export interface DashboardModel {
  hasWorkspace: boolean;
  session?: {
    agent: string; status: string; startedAt: number; endedAt?: number; completion?: Completion; counts: Counts; changes: EffectiveChange[];
    skipped: Skipped[]; warnings: string[]; baselineFiles: number; usesGit: boolean; recovered: boolean;
  };
  busy?: { message: string; done: number; total: number };
  run?: RunRecord; outdated: string[]; comparison?: RunComparison; viewingOlderRun: boolean;
  history: Array<{ id: string; at: number; scope: string; depth: string; trigger: string; findings: number; files: number; cancelled?: boolean }>;
  settings: DashboardSettings;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const KIND_LABEL: Record<string, string> = { created: 'New files', modified: 'Modified files', renamed: 'Renamed / moved files', deleted: 'Deleted files' };
const CATEGORY_LABEL: Record<string, string> = { config: 'config', dependency: 'dependencies', test: 'test', migration: 'migration / schema', docs: 'docs' };
const CHECK_NAME: Record<string, string> = { syntax: 'Syntax', lint: 'Static analysis', types: 'Type checking', security: 'Security patterns',
  secrets: 'Hardcoded secrets', dependencies: 'Dependencies', tests: 'Unit tests', requirements: 'Matches the task?',
  imports: 'Imports between files', declared_dependencies: 'Declared dependencies' };
const SCOPE_LABEL: Record<string, string> = { session: 'Session changes', pending: 'Changes not yet verified', selected: 'Selected files', git: 'Git-changed files',
  workspace: 'Entire workspace', custom: 'Chosen files', failed: 'Re-run of failed checks' };
const TRIGGER_LABEL: Record<string, string> = { manual: 'manual', agent_signal: 'agent reported it finished', inactivity: 'no changes for a while (estimate)',
  session_end: 'session ended', save: 'files saved', batch: 'batch of changes', changed_during_run: 'files changed during the previous run' };

export function statusLine(s: NonNullable<DashboardModel['session']>): { chip: string; text: string } {
  if (s.status === 'paused') return { chip: '<span class="chip st-notrun">Ⅱ Paused</span>', text: 'Changes made while paused are not attributed to this session.' };
  if (s.status === 'ended') return { chip: '<span class="chip st-notrun">■ Ended</span>', text: `Tracking stopped${s.endedAt ? ` at ${esc(time(s.endedAt))}` : ''}. The changes below are final for this session.` };
  if (s.status === 'awaiting_review') {
    const c = s.completion;
    if (c?.kind === 'agent_signal') return { chip: '<span class="chip st-passed">● Agent reported it finished</span>', text: esc(c.detail) };
    if (c?.kind === 'inactivity_estimate') return { chip: '<span class="chip st-review">? Possibly finished (estimate)</span>',
      text: `${esc(c.detail)} TrustCode cannot confirm that the agent is done — it only sees that files stopped changing.` };
    return { chip: '<span class="chip st-review">● Ready for review</span>', text: esc(c?.detail ?? '') };
  }
  return { chip: '<span class="chip st-issue">● Tracking</span>', text: 'Watching the workspace for created, modified, renamed and deleted files.' };
}

function sessionHeader(m: DashboardModel): string {
  const s = m.session!;
  const st = statusLine(s);
  const c = s.counts;
  const tile = (n: number, label: string, cls = 'neutral') => `<div class="tile ${cls}"><div class="num">${n}</div><div class="lbl">${esc(label)}</div></div>`;
  const live = s.status !== 'ended';
  const notes = [
    s.recovered ? 'Session restored after VS Code restarted; the workspace was rescanned, so changes made in the meantime are included.' : '',
    ...s.warnings,
  ].filter(Boolean);
  return `<section class="card session-head" aria-labelledby="h-sess"><h3 id="h-sess" class="section-label">Current session</h3>
    <div class="sess-status">${st.chip}</div><p class="muted small">${st.text}</p>
    <dl class="kv"><dt>Agent</dt><dd>${esc(s.agent)}</dd><dt>Started</dt><dd>${esc(time(s.startedAt))}</dd>
      <dt>Baseline</dt><dd>${plural(s.baselineFiles, 'file')} · ${s.usesGit ? 'Git + content hashes' : 'content hashes (Git not used)'}</dd></dl>
    <div class="tiles four">${tile(c.created, 'New')}${tile(c.modified, 'Modified')}${tile(c.deleted + c.renamed, 'Deleted / moved')}${tile(c.awaiting, 'Awaiting verification', c.awaiting ? 'info' : 'neutral')}</div>
    ${notes.map((n) => `<p class="hint small" role="note">${esc(n)}</p>`).join('')}
    ${s.skipped.length ? `<details class="small"><summary>${plural(s.skipped.length, 'file')} not tracked (see why)</summary>
      <ul class="plain">${s.skipped.slice(0, 40).map((k) => `<li><code>${esc(k.path)}</code> — ${esc(k.reason)}</li>`).join('')}${s.skipped.length > 40 ? `<li class="muted">…and ${s.skipped.length - 40} more</li>` : ''}</ul></details>` : ''}
    <div class="row">${c.total ? `<button class="primary" data-action="sessionVerify" ${m.busy ? 'disabled' : ''}>Verify all changes (${c.total})</button>` : ''}
      ${c.awaiting && c.awaiting !== c.total ? `<button data-action="sessionVerifyPending" ${m.busy ? 'disabled' : ''}>Verify unverified only (${c.awaiting})</button>` : ''}
      ${live ? '<button data-action="sessionRescan" title="Rescan the workspace now, in case an event was missed">Review latest changes</button>' : ''}</div>
    <div class="row">${s.status === 'paused' ? '<button data-action="sessionResume">Resume tracking</button>' : live ? '<button data-action="sessionPause">Pause tracking</button>' : ''}
      ${live ? `<button data-action="sessionEndVerify" ${m.busy ? 'disabled' : ''}>End session and verify</button><button data-action="sessionEnd">End session</button>`
        : '<button class="primary" data-action="sessionStart">Start a new session</button>'}</div></section>`;
}

export function changedFiles(m: DashboardModel): string {
  const s = m.session!;
  if (!s.changes.length) {
    return `<section class="card" aria-labelledby="h-chg"><h3 id="h-chg" class="section-label">Changed files</h3>
      <p class="muted">No file has changed since the session started. Let your coding agent work — changes appear here as they happen.</p></section>`;
  }
  const row = (c: EffectiveChange) => {
    const awaiting = c.verifiedHash !== verificationKey(c);
    const tags = [CATEGORY_LABEL[c.category] ? `<span class="tag">${esc(CATEGORY_LABEL[c.category])}</span>` : '',
      c.editedInEditor ? '<span class="tag" title="Typed in a VS Code editor during the session — by you or an in-editor assistant">edited in editor</span>' : '',
      c.mixed ? '<span class="tag" title="Also changed while tracking was paused; the two cannot be separated">includes paused edits</span>' : '',
      awaiting ? '<span class="tag await">not verified</span>' : '<span class="tag">verified</span>'].join(' ');
    return `<li class="file-row"><label><input type="checkbox" data-pick="${esc(c.path)}" aria-label="Select ${esc(c.path)}">
      <span class="fpath" title="${esc(c.path)}">${esc(c.path)}</span></label>${c.from ? `<span class="muted small">from ${esc(c.from)}</span>` : ''}
      <span class="ftags">${tags}</span><button class="mini" data-action="openDiff" data-path="${esc(c.path)}">${c.kind === 'deleted' ? 'Show removed' : c.kind === 'created' ? 'Open' : 'Diff'}</button></li>`;
  };
  const groups = ['created', 'modified', 'renamed', 'deleted'].map((k) => {
    const items = s.changes.filter((c) => c.kind === k);
    return items.length ? `<details open><summary>${esc(KIND_LABEL[k])} <span class="muted">(${items.length})</span></summary><ul class="files">${items.map(row).join('')}</ul></details>` : '';
  }).join('');
  const cat = Object.entries(s.counts.byCategory).filter(([k, n]) => n && CATEGORY_LABEL[k]).map(([k, n]) => `${n} ${CATEGORY_LABEL[k]}`).join(' · ');
  return `<section class="card" aria-labelledby="h-chg"><h3 id="h-chg" class="section-label">Changed files (${s.changes.length})</h3>
    ${cat ? `<p class="muted small">Includes ${esc(cat)}.</p>` : ''}${groups}
    <div class="row"><button data-action="sessionVerifySelected" ${m.busy ? 'disabled' : ''}>Verify selected files</button></div></section>`;
}

const ORIGIN: Record<string, [string, string]> = {
  new: ['New in this change', 'st-issue'], preexisting: ['Already present before', 'st-notrun'], unknown: ['Origin unknown', 'st-review'],
};

export function findingItem(f: SessionFinding): string {
  const [originLabel, originCls] = ORIGIN[f.introduced] ?? ORIGIN.unknown;
  const id = esc(f.id);
  return `<li class="finding sev-${esc(f.severity)}" data-fid="${id}">
    <div class="f-head"><span class="pill sev-${esc(f.severity)}">${esc(f.severity.toUpperCase())}</span><span class="f-title">${esc(f.title)}</span><span class="f-id muted">${id}</span></div>
    <div class="f-badges"><span class="chip ${originCls}">${esc(originLabel)}</span>
      <span class="chip ${f.deterministic ? 'st-notrun' : 'st-review'}">${f.deterministic ? 'Tool-confirmed' : '? Needs human review'}</span>
      ${f.crossFile ? '<span class="chip st-notrun">Cross-file</span>' : ''}</div>
    <button class="link floc" data-action="openFinding" data-finding="${id}">${esc(f.path)}${f.line ? `:${esc(f.line)}` : ''}</button>
    <dl class="f-main">${f.why ? `<dt>Why it matters</dt><dd>${esc(f.why)}</dd>` : ''}${f.nextStep ? `<dt>Suggested next step</dt><dd>${esc(f.nextStep)}</dd>` : ''}</dl>
    <details class="f-more"><summary>Evidence &amp; limits</summary><dl><dt>Evidence (${esc(f.tool)}${f.rule ? ` · ${esc(f.rule)}` : ''})</dt><dd><pre>${esc(f.message)}${f.excerpt ? `\n\n${esc(f.excerpt)}` : ''}</pre></dd>
      ${f.couldNotVerify ? `<dt>Not verified</dt><dd>${esc(f.couldNotVerify)}</dd>` : ''}</dl></details>
    ${f.feedbackNote ? `<p class="learned small" role="note"><span aria-hidden="true">↺</span> ${esc(f.feedbackNote)}</p>` : ''}
    <div class="f-actions"><div class="fb" role="group" aria-label="Was this finding right?"><span class="muted small">Right?</span>
      <button class="mini" data-action="sessionFeedback" data-finding="${id}" data-rating="helpful">Yes</button>
      <button class="mini" data-action="sessionFeedback" data-finding="${id}" data-rating="incorrect">Wrong</button></div></div></li>`;
}

export function checkMatrix(r: MergedReport): string {
  const rows = Object.entries(r.checks).map(([kind, st]) => {
    const part = (k: string) => (st[k] ? `<span class="chip ${STATUS_LABEL[k]?.cls ?? ''}">${STATUS_LABEL[k]?.icon ?? '?'} ${st[k]} ${esc(({ passed: 'no findings', issues_found: 'with findings', check_failed: 'failed', not_run: 'not run', needs_review: 'need review' } as Record<string, string>)[k] ?? k)}</span>` : '');
    return `<li><span class="check-name">${esc(CHECK_NAME[kind] ?? kind)}</span> <span class="mx">${['issues_found', 'check_failed', 'needs_review', 'not_run', 'passed'].map(part).join(' ')}</span></li>`;
  }).join('');
  const project = r.projectChecks.map((c) => {
    const s = STATUS_LABEL[c.status] ?? STATUS_LABEL.needs_review;
    return `<li><details><summary><span class="check-icon ${s.cls}" aria-hidden="true">${s.icon}</span> <span class="check-name">${esc(CHECK_NAME[c.kind] ?? c.kind)}</span>
      <span class="muted small">${esc(c.summary)}</span><span class="sr-only">${esc(s.label)}</span></summary><p class="muted small">${esc(c.scope)}</p></details></li>`;
  }).join('');
  return `<section class="card" aria-labelledby="h-mx"><h3 id="h-mx" class="section-label">Checks run</h3>
    <p class="muted small">Per check: how many of the ${plural(r.filesChanged, 'changed file')} ended in each state. “No findings” only means the check matched nothing within its scope.</p>
    <ul class="matrix">${rows || '<li class="muted">No per-file check produced a result.</li>'}</ul>
    ${project ? `<h4 class="sev-group">Across files</h4><ul class="matrix">${project}</ul>` : ''}</section>`;
}

export function comparisonCard(c: RunComparison | undefined): string {
  if (!c) return '';
  const list = (fs: SessionFinding[]) => fs.slice(0, 8).map((f) => `<li>${esc(f.title)} <span class="muted">${esc(f.path)}</span></li>`).join('') + (fs.length > 8 ? `<li class="muted">…and ${fs.length - 8} more</li>` : '');
  return `<section class="card compare" aria-labelledby="h-rcmp"><h3 id="h-rcmp" class="section-label">Compared with the previous run</h3>
    <div class="cmp-counts"><span class="chip st-notrun">– ${c.noLongerReported.length} no longer reported</span>
      <span class="chip ${c.added.length ? 'st-issue' : 'st-notrun'}">${c.added.length ? '!' : '–'} ${c.added.length} new</span>
      <span class="chip st-notrun">${c.unchanged} unchanged</span>${c.notRechecked.length ? `<span class="chip st-review">? ${c.notRechecked.length} not re-checked</span>` : ''}</div>
    ${c.noLongerReported.length ? `<details><summary>No longer reported (${c.noLongerReported.length})</summary><ul>${list(c.noLongerReported)}</ul>
      <p class="muted small">The file was checked again and the check no longer matches. That is evidence the pattern is gone, not proof the problem is solved.</p></details>` : ''}
    ${c.added.length ? `<details open><summary>New (${c.added.length})</summary><ul>${list(c.added)}</ul></details>` : ''}
    ${c.notRechecked.length ? `<details><summary>Not re-checked (${c.notRechecked.length})</summary><ul>${list(c.notRechecked)}</ul>
      <p class="muted small">These files were not part of this run, so nothing is known about whether the earlier findings still apply.</p></details>` : ''}</section>`;
}

export function runReport(m: DashboardModel): string {
  const run = m.run;
  if (!run) return '';
  const r = run.report;
  const n = r.findings.length;
  const sev = (k: string) => r.bySeverity[k] ?? 0;
  const tile = (num: number, label: string, cls: string) => `<div class="tile ${cls}"><div class="num">${num}</div><div class="lbl">${esc(label)}</div></div>`;
  const groups: Array<[string, string[]]> = [['Critical', ['critical']], ['High', ['high']], ['Medium', ['medium']], ['Low / info', ['low', 'info']]];
  const findings = groups.map(([label, ks]) => {
    const items = r.findings.filter((f) => ks.includes(f.severity) || (ks.includes('info') && !['critical', 'high', 'medium', 'low', 'info'].includes(f.severity)));
    return items.length ? `<h4 class="sev-group">${esc(label)} <span class="muted">(${items.length})</span></h4><ul class="findings">${items.map(findingItem).join('')}</ul>` : '';
  }).join('');
  const failedFiles = r.files.filter((f) => (f.checks ?? []).some((c: any) => c.status === 'check_failed')).length;
  const incomplete = [...r.notAnalysed, ...run.skipped];
  return `${m.viewingOlderRun ? '<p class="hint cached" role="status">You are viewing an earlier run. <button class="mini" data-action="openRun" data-run="latest">Show the latest run</button></p>' : ''}
    ${run.cancelled ? '<p class="hint outdated" role="alert"><strong>This run was cancelled before it finished.</strong> Only part of the change was verified; see “Not analysed”.</p>' : ''}
    ${m.outdated.length ? `<section class="card outdated" role="alert"><div class="alert-head"><span class="alert-icon" aria-hidden="true">!</span><h3>These results are out of date</h3></div>
      <p>${plural(m.outdated.length, 'file')} changed after this run read ${m.outdated.length === 1 ? 'it' : 'them'}: ${m.outdated.slice(0, 5).map((p) => `<code>${esc(p)}</code>`).join(', ')}${m.outdated.length > 5 ? '…' : ''}.
      The findings below describe the earlier content.</p><button class="primary" data-action="sessionVerifyPending" ${m.busy ? 'disabled' : ''}>Verify the newer changes</button></section>` : ''}
    <div class="headline ${n ? 'has-findings' : 'no-findings'}" role="status"><div class="headline-main">${n ? `${plural(n, 'finding')} in ${plural(r.filesChanged, 'changed file')}` : `The checks reported no findings in ${plural(r.filesChanged, 'changed file')}`}</div>
      <div class="headline-sub">${esc(SCOPE_LABEL[run.scope] ?? run.scope)} · ${esc(r.depth)} check · ${esc(time(run.finishedAt))} · trigger: ${esc(TRIGGER_LABEL[run.trigger] ?? run.trigger)}</div>
      <div class="headline-sub">${r.origin.new} new in this change · ${r.origin.preexisting} already present before · ${r.origin.unknown} of unknown origin</div>
      ${n ? '' : '<div class="headline-sub">No findings is not proof that the change works — see what was not executed.</div>'}</div>
    <div class="tiles four">${tile(sev('critical'), 'Critical', sev('critical') ? 'err' : 'neutral')}${tile(sev('high'), 'High', sev('high') ? 'err' : 'neutral')}${tile(sev('medium'), 'Medium', sev('medium') ? 'warn' : 'neutral')}${tile(sev('low') + sev('info'), 'Low / info', 'neutral')}</div>
    ${comparisonCard(m.viewingOlderRun ? undefined : m.comparison)}
    ${n ? `<section aria-labelledby="h-sfind"><h3 id="h-sfind" class="section-label">Findings (${n})</h3>${findings}
      <div class="row"><button data-action="copyFixPrompt" title="Copies a prompt listing these findings for your coding agent. TrustCode does not change your files.">Copy fix prompt for your agent</button>
      <button data-action="openFixPrompt">Open fix prompt</button></div></section>`
      : '<section class="card"><h3 class="section-label">Findings</h3><p>No check reported a finding. This does <strong>not</strong> mean the change is free of defects.</p></section>'}
    ${checkMatrix(r)}
    <section class="card unverified-card" aria-labelledby="h-nx"><h3 id="h-nx" class="section-label">Not executed (${r.notExecuted.length})</h3>
      <p class="muted small">These checks did not run. Nothing is known from them.</p>
      <ul class="unverified">${r.notExecuted.map((x) => `<li><span class="unv-icon" aria-hidden="true">?</span><div><strong>${esc(x.check)}</strong><div class="muted small">${esc(x.reason)}</div></div></li>`).join('')}</ul></section>
    ${incomplete.length ? `<section class="card unverified-card" aria-labelledby="h-na"><h3 id="h-na" class="section-label">Not analysed (${incomplete.length})</h3>
      <p class="muted small">Changed files that were not, or not fully, analysed.</p>
      <ul class="plain">${incomplete.map((x) => `<li><code>${esc(x.path)}</code> — ${esc(x.reason)}</li>`).join('')}</ul></section>` : ''}
    ${failedFiles ? `<div class="row"><button data-action="rerunFailed" ${m.busy ? 'disabled' : ''}>Re-run failed checks (${plural(failedFiles, 'file')})</button></div>` : ''}
    <p class="disclaimer">${esc(r.disclaimer)}</p>`;
}

export function historyCard(m: DashboardModel): string {
  if (!m.history.length) return '';
  return `<details class="card"><summary class="card-title">Verification history (${m.history.length})</summary><ul class="list">${m.history.map((h) => `
    <li><button class="row-item" data-action="openRun" data-run="${esc(h.id)}"><span class="grow"><strong>${esc(time(h.at))}</strong>
      <span class="muted">${esc(SCOPE_LABEL[h.scope] ?? h.scope)} · ${esc(h.depth)} · ${plural(h.files, 'file')}${h.cancelled ? ' · cancelled' : ''}</span></span>
      <span class="chip ${h.findings ? 'st-issue' : 'st-notrun'}">${plural(h.findings, 'finding')}</span></button></li>`).join('')}</ul></details>`;
}

export function settingsCard(st: DashboardSettings): string {
  const select = (key: string, value: string, options: Array<[string, string]>, label: string) =>
    `<label class="set-row"><span>${esc(label)}</span><select data-action="setSetting" data-key="${key}">${options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const toggle = (key: string, on: boolean, label: string, help: string) =>
    `<label class="toggle"><input type="checkbox" data-action="setSetting" data-key="${key}" ${on ? 'checked' : ''}><span><strong>${esc(label)}</strong><br><span class="muted small">${esc(help)}</span></span></label>`;
  return `<details class="card"><summary class="card-title">Tracking &amp; verification settings</summary>
    ${select('verification.depth', st.depth, [['quick', 'Quick — syntax, lint, types'], ['standard', 'Standard — + security, secrets, dependencies, cross-file'], ['deep', 'Deep — + package registry lookup']], 'Check depth')}
    ${select('verification.defaultScope', st.defaultScope, [['session', 'All changes in the current session'], ['git', 'All Git-changed files'], ['file', 'Current file'], ['selection', 'Selected code'], ['workspace', 'Entire workspace'], ['custom', 'Files I choose']], 'Default scope for “TrustCode: Verify”')}
    <p class="muted small">Which checks exist for each language, and which tools the server lacks, is shown per check in every report (“Not run” / “Check failed”). Project tests are never run for multi-file changes.</p>
    <div class="card-title">Verify automatically</div>
    ${toggle('autoVerify.onAgentFinished', st.auto.agentFinished, 'When the agent reports it finished', 'Needs an agent hook that writes the TrustCode signal file (see “Agent hook setup”).')}
    ${toggle('autoVerify.onInactivity', st.auto.inactivity, `After ${st.inactivitySeconds || '…'} s without file changes`, st.inactivitySeconds ? 'An estimate: the agent may still be working.' : 'Inactivity detection is off (trustcode.session.inactivitySeconds is 0).')}
    ${toggle('autoVerify.onSessionEnd', st.auto.sessionEnd, 'When I end the session', 'Runs once on the final set of changes.')}
    ${toggle('autoVerify.onSave', st.auto.save, 'After files are saved', 'Waits for a quiet moment; never runs on every keystroke.')}
    ${toggle('autoVerify.onBatch', st.auto.batch, `After a batch of ${st.batchSize} changed files`, 'Runs once the batch has settled.')}
    <p class="muted small">Automatic runs only send files to a server you have already approved with “don't ask again”. Otherwise TrustCode asks first.</p>
    <div class="card-title">What is sent</div>
    ${toggle('verification.sendBaseline', st.sendBaseline, 'Send the previous version of modified files', 'Lets findings be labelled “new” or “already present”. Off: origin is shown as unknown.')}
    ${toggle('verification.includeRelatedFiles', st.includeRelated, 'Include related unchanged files', 'Files that import, or are imported by, a changed file — needed for cross-file checks.')}
    <div class="row"><button data-action="openSessionSettings">All settings (folders, extensions, limits, retention)…</button><button data-action="hookSetup">Agent hook setup…</button></div></details>`;
}

export function sessionPage(m: DashboardModel): string {
  const busy = m.busy ? `<section class="card progress" aria-busy="true"><div class="spinner" aria-hidden="true"></div><div><strong>${esc(m.busy.message)}</strong>
    ${m.busy.total ? `<progress max="${m.busy.total}" value="${m.busy.done}" aria-label="Verification progress"></progress>
    <div class="muted small">${m.busy.done} of ${m.busy.total} batch${m.busy.total === 1 ? '' : 'es'} done · cancel from the notification</div>` : ''}</div></section>` : '';
  const others = `<section class="card"><div class="card-title">Verify without a session</div>
    <div class="row"><button data-action="verifyGit" ${m.busy ? 'disabled' : ''}>Git-changed files</button><button data-action="verifyPick" ${m.busy ? 'disabled' : ''}>Choose files…</button>
    <button data-action="verifyWorkspace" ${m.busy ? 'disabled' : ''}>Entire workspace…</button></div></section>`;
  if (!m.hasWorkspace) {
    return `<section class="card onboarding"><div class="card-title">Open a folder to track sessions</div>
      <p class="muted">Session tracking compares the files of a workspace folder with a baseline. Open a folder, then start a session.</p></section>`;
  }
  if (!m.session) {
    return `${busy}<section class="card onboarding"><div class="card-title">Track an AI coding session</div>
      <ol class="steps-onboard"><li><strong>Start a session</strong> before you give your agent a task. TrustCode records the current state of every file as the baseline.</li>
        <li><strong>Let the agent work.</strong> Created, modified, renamed and deleted files are collected — however they are changed.</li>
        <li><strong>Verify all changes together</strong>, including problems between files, then re-verify after fixes.</li></ol>
      <button class="primary wide" data-action="sessionStart">Start tracking session</button>
      <p class="note">Edits you already have before starting are part of the baseline and are not attributed to the session.</p></section>
      ${runReport(m)}${others}${historyCard(m)}${settingsCard(m.settings)}`;
  }
  return `${busy}${sessionHeader(m)}${changedFiles(m)}${runReport(m)}${others}${historyCard(m)}${settingsCard(m.settings)}`;
}
