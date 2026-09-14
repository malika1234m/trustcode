// Pure HTML renderers for the webview (no vscode import -> unit-testable).
// Every dynamic value passes through esc(). Status is always conveyed by icon + text, never colour alone.

export type Level = 'beginner' | 'intermediate' | 'advanced';

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const STATUS_LABEL: Record<string, { icon: string; label: string; cls: string }> = {
  passed: { icon: '✓', label: 'No findings (within scope)', cls: 'st-passed' },
  issues_found: { icon: '!', label: 'Issue detected', cls: 'st-issue' },
  check_failed: { icon: '✕', label: 'Check failed — result unknown', cls: 'st-failed' },
  not_run: { icon: '–', label: 'Not tested', cls: 'st-notrun' },
  needs_review: { icon: '?', label: 'Requires human review', cls: 'st-review' },
};

const CHECK_NAME: Record<string, string> = {
  syntax: 'Syntax', lint: 'Static analysis', security: 'Security patterns', tests: 'Unit tests',
  dependencies: 'Dependencies', requirements: 'Matches the task?',
};

export function statusChip(status: string): string {
  const s = STATUS_LABEL[status] ?? { icon: '?', label: status, cls: 'st-review' };
  return `<span class="chip ${s.cls}"><span aria-hidden="true">${s.icon}</span> ${esc(s.label)}</span>`;
}

export function renderChecks(view: any): string {
  const rows = (view.checks ?? []).map((c: any) => `
    <li class="check">
      <div class="check-head"><strong>${esc(CHECK_NAME[c.kind] ?? c.kind)}</strong> ${statusChip(c.status)}</div>
      <div class="muted">${esc(c.summary)}</div>
      <details><summary>What this check can and cannot tell you</summary>
        <p>${esc(c.status_text)}</p><p>${esc(c.scope)}</p>
        <p class="muted">Tool: ${esc(c.tool)}${c.tool_version ? ' ' + esc(c.tool_version) : ''}</p>
        ${c.error ? `<p class="err">Error: ${esc(c.error)}</p>` : ''}
      </details>
    </li>`).join('');
  return `<section aria-labelledby="h-checks"><h3 id="h-checks">Checks run</h3><ul class="checks">${rows}</ul>
    <p class="note">There is no overall “safe” score. Each check only covers what it looks for.</p></section>`;
}

export function renderFinding(f: any, allowFeedback: boolean): string {
  const fb = allowFeedback ? `<div class="fb" role="group" aria-label="Feedback on this explanation">
      <button data-action="feedback" data-finding="${esc(f.finding_id)}" data-rating="helpful">Helpful</button>
      <button data-action="feedback" data-finding="${esc(f.finding_id)}" data-rating="too_technical">Too technical</button>
      <button data-action="feedback" data-finding="${esc(f.finding_id)}" data-rating="too_simple">Too simple</button>
      <button data-action="feedback" data-finding="${esc(f.finding_id)}" data-rating="incorrect">Wrong</button></div>` : '';
  return `<li class="finding sev-${esc(f.severity)}">
    <details ${f.collapsed ? '' : 'open'} data-track="evidence" data-finding="${esc(f.finding_id)}">
      <summary><span class="sev">${esc(String(f.severity).toUpperCase())}</span> ${esc(f.what)}
        <span class="muted">(${esc(f.finding_id)})</span>${f.source === 'llm' ? ' <span class="tag">AI-worded</span>' : ''}</summary>
      <dl>
        <dt>Where</dt><dd>${esc(f.where)}</dd>
        <dt>Detected by</dt><dd>${esc(f.method)}</dd>
        <dt>Why it matters</dt><dd>${esc(f.why)}</dd>
        <dt>Evidence (tool output)</dt><dd><pre>${esc(f.evidence)}</pre></dd>
        <dt>Not verified</dt><dd>${esc(f.could_not_verify)}</dd>
        <dt>Suggested next step</dt><dd>${esc(f.next_step)}</dd>
        ${f.confidence_note ? `<dt>Rule confidence</dt><dd>${esc(f.confidence_note)}</dd>` : ''}
      </dl>${fb}
    </details></li>`;
}

export function renderFindings(view: any, allowFeedback = true): string {
  const fs = view.findings ?? [];
  if (!fs.length) {
    return `<section aria-labelledby="h-find"><h3 id="h-find">Findings</h3>
      <p>No checks reported findings. This does <strong>not</strong> mean the code is free of defects — see “Not verified”.</p></section>`;
  }
  return `<section aria-labelledby="h-find"><h3 id="h-find">Findings (${fs.length})</h3>
    <ul class="findings">${fs.map((f: any) => renderFinding(f, allowFeedback)).join('')}</ul></section>`;
}

export function renderUnverified(view: any): string {
  const us = view.unverified ?? [];
  const assumptions = view.llm?.assumptions ?? [];
  const items = us.map((u: any) => `<li><strong>${esc(u.description)}</strong><br><span class="muted">${esc(u.explanation)}</span></li>`).join('')
    + assumptions.map((a: any) => `<li><strong>Assumption${a.line ? ' (line ' + esc(a.line) + ')' : ''}:</strong> ${esc(a.statement)}
        <span class="chip st-review">? Requires human review — suggested by AI</span></li>`).join('');
  return `<section aria-labelledby="h-unv" data-track="unverified"><h3 id="h-unv">Not verified (${us.length + assumptions.length})</h3>
    ${items ? `<ul class="unverified">${items}</ul>` : '<p class="muted">No specific gaps were identified, but checks are still limited in scope.</p>'}</section>`;
}

export function renderLevelSwitch(level: Level): string {
  const opts = (['beginner', 'intermediate', 'advanced'] as Level[]).map(l =>
    `<button data-action="level" data-level="${l}" aria-pressed="${l === level}" class="${l === level ? 'on' : ''}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('');
  return `<div class="levels" role="group" aria-label="Explanation detail">${opts}</div>`;
}

export function renderDecision(prefix = 'decide'): string {
  return `<section aria-labelledby="h-dec" class="decision"><h3 id="h-dec">Your decision</h3>
    <p class="muted">You decide. TrustCode never changes your files.</p>
    <label for="conf">How confident are you that your decision is right? <output id="confv">50</output>%</label>
    <input id="conf" type="range" min="0" max="100" step="5" value="50" aria-describedby="confv">
    <div class="row">
      <button data-action="${prefix}" data-decision="accept">Accept</button>
      <button data-action="${prefix}" data-decision="modify">Modify</button>
      <button data-action="${prefix}" data-decision="reject">Reject</button>
    </div></section>`;
}

export function renderResult(view: any, opts: { allowFeedback?: boolean; showLevelSwitch?: boolean; suggestion?: any } = {}): string {
  const sug = view.adaptation?.suggestion ? `<p class="hint">Suggestion: switch to <strong>${esc(view.adaptation.suggestion.to)}</strong> explanations — ${esc(view.adaptation.suggestion.because)}.
      <button data-action="level" data-level="${esc(view.adaptation.suggestion.to)}">Switch</button></p>` : '';
  const llm = view.llm?.fallback ? `<p class="muted">AI wording unavailable; showing standard explanations.</p>` : '';
  return `${opts.showLevelSwitch !== false ? renderLevelSwitch(view.level) : ''}${sug}${llm}
    ${renderFindings(view, opts.allowFeedback !== false)}${renderUnverified(view)}${renderChecks(view)}
    <ul class="guidance">${(view.guidance ?? []).map((g: string) => `<li>${esc(g)}</li>`).join('')}</ul>
    <p class="disclaimer">${esc(view.disclaimer)}</p>`;
}
