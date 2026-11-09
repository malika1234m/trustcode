// Pure HTML renderers for the webview (no vscode import -> unit-testable).
// Every dynamic value passes through esc(). Status is always conveyed by icon + text, never colour alone.
// No renderer ever states or implies that code is safe or correct.

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

/** One plain-language line that orients the user. Describes evidence only — never a verdict. */
export function renderHeadline(view: any): string {
  const f = (view?.findings ?? []).length;
  const u = (view?.unverified ?? []).length + (view?.llm?.assumptions ?? []).length;
  const failed = (view?.checks ?? []).filter((c: any) => c.status === 'check_failed').length;
  const main = f ? `${f} finding${f === 1 ? '' : 's'} need${f === 1 ? 's' : ''} your attention` : 'The checks reported no findings';
  const parts = [u ? `${u} area${u === 1 ? '' : 's'} not verified` : '', failed ? `${failed} check${failed === 1 ? '' : 's'} could not run` : '']
    .filter(Boolean);
  return `<div class="headline ${f ? 'has-findings' : 'no-findings'}" role="status">
    <div class="headline-main">${esc(main)}</div>
    ${parts.length ? `<div class="headline-sub">${esc(parts.join(' · '))}</div>` : ''}
    ${f ? '' : '<div class="headline-sub">No findings is not proof of correctness — review what was not verified.</div>'}</div>`;
}

export function renderChecks(view: any): string {
  const rows = (view?.checks ?? []).map((c: any) => {
    const s = STATUS_LABEL[c.status] ?? { icon: '?', label: c.status, cls: 'st-review' };
    return `<li class="check">
      <details>
        <summary class="check-row"><span class="check-icon ${s.cls}" aria-hidden="true">${s.icon}</span>
          <span class="check-name">${esc(CHECK_NAME[c.kind] ?? c.kind)}</span>
          <span class="check-sum muted">${esc(c.summary)}</span>
          <span class="sr-only">${esc(s.label)}</span></summary>
        <div class="check-body">${statusChip(c.status)}
          <p>${esc(c.status_text)}</p><p class="muted">${esc(c.scope)}</p>
          <p class="muted small">Tool: ${esc(c.tool)}${c.tool_version ? ' ' + esc(c.tool_version) : ''}</p>
          ${c.error ? `<p class="err small">Error: ${esc(c.error)}</p>` : ''}</div>
      </details></li>`;
  }).join('');
  return `<section class="card" aria-labelledby="h-checks"><h3 id="h-checks" class="section-label">Checks run</h3><ul class="checks">${rows}</ul>
    <p class="note">There is no overall “safe” score. Each check only covers what it looks for.</p></section>`;
}

export function renderFinding(f: any, allowFeedback: boolean): string {
  const sev = String(f?.severity ?? 'info');
  const id = esc(f?.finding_id);
  const fb = allowFeedback ? `<div class="fb" role="group" aria-label="Was this explanation helpful?">
      <span class="muted small">Helpful?</span>
      <button class="mini" data-action="feedback" data-finding="${id}" data-rating="helpful">Yes</button>
      <button class="mini" data-action="feedback" data-finding="${id}" data-rating="not_helpful">No</button>
      <button class="mini" data-action="feedback" data-finding="${id}" data-rating="too_simple">More technical</button>
      <button class="mini" data-action="feedback" data-finding="${id}" data-rating="too_technical">Simpler</button>
      <button class="mini" data-action="feedback" data-finding="${id}" data-rating="incorrect">Wrong</button></div>` : '';
  const body = `
      <dl class="f-main">
        <dt>Where</dt><dd>${esc(f?.where)}</dd>
        <dt>Detected by</dt><dd>${esc(f?.method)}</dd>
        <dt>Why it matters</dt><dd>${esc(f?.why)}</dd>
        <dt>Suggested next step</dt><dd>${esc(f?.next_step)}</dd>
      </dl>
      <details class="f-more" data-track="evidence" data-finding="${id}"><summary>Evidence &amp; limits</summary>
        <dl><dt>Evidence (tool output)</dt><dd><pre>${esc(f?.evidence)}</pre></dd>
        <dt>Not verified</dt><dd>${esc(f?.could_not_verify)}</dd>
        ${f?.confidence_note ? `<dt>Rule confidence</dt><dd>${esc(f.confidence_note)}</dd>` : ''}</dl>
      </details>
      <div class="f-actions">${f?.where && /line/i.test(String(f.where)) ? `<button class="mini" data-action="reveal" data-finding="${id}">Go to line</button>` : ''}${fb}</div>`;
  const head = `<span class="pill sev-${esc(sev)}">${esc(sev.toUpperCase())}</span>
      <span class="f-title">${esc(f?.what)}</span><span class="f-id muted">${id}</span>${f?.source === 'llm' ? ' <span class="tag">AI-worded</span>' : ''}`;
  return f?.collapsed
    ? `<li class="finding sev-${esc(sev)}"><details><summary class="f-head">${head}</summary>${body}</details></li>`
    : `<li class="finding sev-${esc(sev)}"><div class="f-head">${head}</div>${body}</li>`;
}

export function renderFindings(view: any, allowFeedback = true): string {
  const fs = view?.findings ?? [];
  if (!fs.length) {
    return `<section class="card" aria-labelledby="h-find"><h3 id="h-find" class="section-label">Findings</h3>
      <p>No checks reported findings. This does <strong>not</strong> mean the code is free of defects — see “Not verified”.</p></section>`;
  }
  return `<section aria-labelledby="h-find"><h3 id="h-find" class="section-label">Findings (${fs.length})</h3>
    <ul class="findings">${fs.map((f: any) => renderFinding(f, allowFeedback)).join('')}</ul></section>`;
}

export function renderUnverified(view: any): string {
  const us = view?.unverified ?? [];
  const assumptions = view?.llm?.assumptions ?? [];
  const items = us.map((u: any) => `<li><span class="unv-icon" aria-hidden="true">?</span><div><strong>${esc(u.description)}</strong>
        <div class="muted small">${esc(u.explanation)}</div></div></li>`).join('')
    + assumptions.map((a: any) => `<li><span class="unv-icon" aria-hidden="true">?</span><div><strong>Assumption${a.line ? ' (line ' + esc(a.line) + ')' : ''}:</strong> ${esc(a.statement)}
        <div><span class="chip st-review">? Requires human review — suggested by AI</span></div></div></li>`).join('');
  return `<section class="card unverified-card" aria-labelledby="h-unv" data-track="unverified"><h3 id="h-unv" class="section-label">Not verified (${us.length + assumptions.length})</h3>
    <p class="muted small">Hidden defects are most likely here — no check covered these areas.</p>
    ${items ? `<ul class="unverified">${items}</ul>` : '<p class="muted">No specific gaps were identified, but checks are still limited in scope.</p>'}</section>`;
}

export function renderLevelSwitch(level: Level): string {
  const opts = (['beginner', 'intermediate', 'advanced'] as Level[]).map(l =>
    `<button data-action="level" data-level="${l}" aria-pressed="${l === level}" class="${l === level ? 'on' : ''}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('');
  return `<div class="level-bar"><span class="muted small">Explain for</span><div class="levels segmented" role="group" aria-label="Explanation detail">${opts}</div></div>`;
}

export interface DecisionState { decision: string; confidence?: number }

export function renderDecision(prefix = 'decide', decided?: DecisionState): string {
  if (decided) {
    const label = ({ accept: 'Accepted', modify: 'Marked for modification', reject: 'Rejected' } as Record<string, string>)[decided.decision] ?? decided.decision;
    return `<section aria-labelledby="h-dec" class="card decision decided"><h3 id="h-dec" class="section-label">Your decision</h3>
      <div class="decided-row"><span class="decided-icon" aria-hidden="true">✓</span><div><strong>${esc(label)}</strong>
      ${decided.confidence !== undefined ? `<div class="muted small">${esc(decided.confidence)}% confident · recorded</div>` : ''}</div></div>
      <p class="muted small">TrustCode did not change your code.</p>
      <button class="link" data-action="changeDecision">Change decision</button></section>`;
  }
  return `<section aria-labelledby="h-dec" class="card decision"><h3 id="h-dec" class="section-label">Your decision</h3>
    <p class="muted small">You decide. TrustCode never changes your files.</p>
    <label for="conf" class="conf-label">How sure are you that your decision is right? <output id="confv">50</output>%</label>
    <input id="conf" type="range" min="0" max="100" step="5" value="50" aria-describedby="confv">
    <div class="conf-scale muted small" aria-hidden="true"><span>Guessing</span><span>Certain</span></div>
    <div class="decision-buttons">
      <button class="dec accept" data-action="${prefix}" data-decision="accept"><span aria-hidden="true">✓</span> Accept</button>
      <button class="dec modify" data-action="${prefix}" data-decision="modify"><span aria-hidden="true">✎</span> Modify</button>
      <button class="dec reject" data-action="${prefix}" data-decision="reject"><span aria-hidden="true">✕</span> Reject</button>
    </div></section>`;
}

export function renderResult(view: any, opts: { allowFeedback?: boolean; showLevelSwitch?: boolean; suggestion?: any } = {}): string {
  const v = view ?? {};
  const sug = v.adaptation?.suggestion ? `<p class="hint">Suggestion: switch to <strong>${esc(v.adaptation.suggestion.to)}</strong> explanations — ${esc(v.adaptation.suggestion.because)}.
      <button data-action="level" data-level="${esc(v.adaptation.suggestion.to)}">Switch</button></p>` : '';
  const llm = v.llm?.fallback ? `<p class="muted small">AI wording unavailable; showing standard explanations.</p>` : '';
  return `${opts.showLevelSwitch !== false && v.level ? renderLevelSwitch(v.level) : ''}${sug}${llm}
    ${renderFindings(v, opts.allowFeedback !== false)}${renderUnverified(v)}${renderChecks(v)}
    <section class="card"><h3 class="section-label">Before you decide</h3><ul class="guidance">${(v.guidance ?? []).map((g: string) => `<li>${esc(g)}</li>`).join('')}</ul>
    <p class="disclaimer">${esc(v.disclaimer)}</p></section>`;
}
