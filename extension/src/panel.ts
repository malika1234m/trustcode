import * as vscode from 'vscode';
import { esc } from './render';

// Webview shell. Strict CSP: no remote content, scripts only with a per-load nonce.
// Colours come from VS Code theme variables, so light/dark/high-contrast themes work automatically.
export function shellHtml(webview: vscode.Webview): string {
  const nonce = Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  :root { --gap: 8px; --radius: 4px; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 var(--gap) 24px; line-height: 1.45; }
  h2 { font-size: 1.15em; margin: 12px 0 4px; } h3 { font-size: 1em; margin: 16px 0 6px; }
  textarea, input[type=text], select { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: var(--radius); padding: 4px 6px; font-family: inherit; }
  textarea { min-height: 56px; resize: vertical; font-family: var(--vscode-editor-font-family); }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: var(--radius); padding: 4px 10px; cursor: pointer; margin: 2px 4px 2px 0; }
  button.primary, button.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:focus-visible, summary:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .muted, .note { color: var(--vscode-descriptionForeground); } .note { font-size: .9em; }
  .row { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
  ul { padding-left: 18px; } ul.checks, ul.findings { list-style: none; padding: 0; }
  .check { border-bottom: 1px solid var(--vscode-panel-border); padding: 6px 0; }
  .check-head { display: flex; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
  .chip { display: inline-block; font-size: .85em; border-radius: 10px; padding: 0 8px; border: 1px solid currentColor; white-space: nowrap; }
  .st-passed { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
  .st-issue { color: var(--vscode-editorWarning-foreground); }
  .st-failed { color: var(--vscode-errorForeground); }
  .st-notrun { color: var(--vscode-descriptionForeground); border-style: dashed; }
  .st-review { color: var(--vscode-editorInfo-foreground); }
  .finding { border-left: 3px solid var(--vscode-panel-border); padding: 4px 0 4px 8px; margin: 6px 0; }
  .sev-critical, .sev-high { border-left-color: var(--vscode-errorForeground); }
  .sev-medium { border-left-color: var(--vscode-editorWarning-foreground); }
  .sev { font-weight: 600; font-size: .8em; }
  summary { cursor: pointer; } dl { margin: 6px 0; } dt { font-weight: 600; margin-top: 4px; } dd { margin: 0 0 0 8px; }
  pre { white-space: pre-wrap; word-break: break-word; background: var(--vscode-textCodeBlock-background); padding: 4px; border-radius: var(--radius); font-family: var(--vscode-editor-font-family); margin: 2px 0; }
  .tag { font-size: .75em; border: 1px dashed currentColor; border-radius: 6px; padding: 0 4px; }
  .unverified li { margin: 4px 0; } .err { color: var(--vscode-errorForeground); }
  .hint { background: var(--vscode-editorInfo-background, transparent); padding: 4px; border-radius: var(--radius); }
  .disclaimer { font-size: .85em; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); padding-top: 6px; }
  .decision { border: 1px solid var(--vscode-panel-border); border-radius: var(--radius); padding: 6px; }
  input[type=range] { width: 100%; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style></head><body>
<div id="root" aria-live="polite"><p class="muted">Loading…</p></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'render') { root.innerHTML = m.html; wire(); }  // html is produced by escaping renderers
  });
  function conf() { const c = document.getElementById('conf'); return c ? Number(c.value) : null; }
  function val(id) { const el = document.getElementById(id); return el ? el.value : undefined; }
  function wire() {
    const c = document.getElementById('conf');
    if (c) c.addEventListener('input', () => { document.getElementById('confv').textContent = c.value; });
    root.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => {
      const d = b.dataset;
      vscode.postMessage({ action: d.action, decision: d.decision, level: d.level, finding: d.finding, rating: d.rating,
        confidence: conf(), task: val('task'), tests: val('tests'), code: val('pcode'), rationale: val('rationale') });
    }));
    root.querySelectorAll('details[data-track]').forEach((el) => el.addEventListener('toggle', () => {
      vscode.postMessage({ action: 'track', type: el.open ? 'evidence_expand' : 'evidence_collapse', finding: el.dataset.finding });
    }));
    const unv = root.querySelector('section[data-track="unverified"]');
    if (unv && 'IntersectionObserver' in window) {
      new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { vscode.postMessage({ action: 'track', type: 'unverified_view' }); o.disconnect(); } }).observe(unv);
    }
  }
  vscode.postMessage({ action: 'ready' });
</script></body></html>`;
}

export function submitFormHtml(sel: { lines: number; language?: string } | undefined, lastTask = ''): string {
  return `<h2>Verify AI-generated code</h2>
  ${sel ? `<p>Selected: <strong>${sel.lines}</strong> line(s)${sel.language ? ` of ${esc(sel.language)}` : ''}.</p>`
    : '<p class="muted">Select AI-generated code in the editor, then press Verify (or right-click → “TrustCode: Verify Selected Code”).</p>'}
  <label for="task">What was the code supposed to do? (optional, recommended)</label>
  <textarea id="task" placeholder="e.g. Return the average of a list, or 0.0 for an empty list">${esc(lastTask)}</textarea>
  <label for="tests">Unit tests (optional; import from <code>solution</code>)</label>
  <textarea id="tests" placeholder="from solution import average&#10;def test_empty():&#10;    assert average([]) == 0.0"></textarea>
  <div class="row"><button class="primary" data-action="verify">Verify selection</button>
  <button data-action="experiment">Join research study…</button></div>
  <p class="note">Nothing is sent until you confirm. TrustCode never edits your files.</p>`;
}
