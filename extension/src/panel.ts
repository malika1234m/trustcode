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
  :root { --gap: 10px; --radius: 6px; --card: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
          --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,.35))); }
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0; margin: 0; line-height: 1.45; }
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 8px var(--gap); border-bottom: 1px solid var(--border); }
  .brand { display: flex; align-items: center; gap: 6px; font-weight: 600; letter-spacing: .2px; }
  .brand svg { color: var(--vscode-textLink-foreground); }
  svg.mark .chk { stroke: var(--vscode-testing-iconPassed, var(--vscode-charts-green, currentColor)); }
  .top-actions { display: flex; align-items: center; gap: 2px; }
  .who { font-size: .85em; color: var(--vscode-descriptionForeground); margin-right: 4px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who.on { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
  .tabs { display: flex; border-bottom: 1px solid var(--border); padding: 0 var(--gap); }
  .tab { background: none; border: none; color: var(--vscode-descriptionForeground); padding: 8px 10px 7px; margin: 0; border-bottom: 2px solid transparent; border-radius: 0; cursor: pointer; }
  .tab:hover { color: var(--vscode-foreground); }
  .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); font-weight: 600; }
  .content { padding: var(--gap); }
  h2 { font-size: 1.15em; margin: 12px 0 4px; } h3 { font-size: 1em; margin: 0 0 8px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; margin: 0 0 var(--gap); }
  .card-title { display: block; font-weight: 600; margin-bottom: 6px; cursor: default; }
  details.card > summary.card-title { cursor: pointer; margin-bottom: 0; }
  details.card[open] > summary.card-title { margin-bottom: 6px; }
  .card.danger { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); }
  .badge { font-size: .75em; font-weight: 400; color: var(--vscode-descriptionForeground); border: 1px solid var(--border); border-radius: 8px; padding: 0 6px; margin-left: 4px; }
  textarea, input[type=text], select { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--border)); border-radius: 4px; padding: 6px 8px; font-family: inherit; }
  textarea { min-height: 60px; resize: vertical; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px; padding: 5px 12px; cursor: pointer; margin: 2px 4px 2px 0; font: inherit; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
  button:disabled { opacity: .55; cursor: default; }
  button.primary, button.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.wide { display: flex; justify-content: center; align-items: center; gap: 6px; width: 100%; padding: 8px 12px; margin: 0 0 var(--gap); font-weight: 600; }
  button.secondary.wide { font-weight: 400; }
  button.link { background: none; color: var(--vscode-textLink-foreground); padding: 4px 0; }
  button.link:hover { text-decoration: underline; background: none; }
  button.icon { background: none; padding: 4px; color: var(--vscode-icon-foreground, var(--vscode-foreground)); display: inline-flex; }
  button.icon:hover { background: var(--vscode-toolbar-hoverBackground); }
  button.danger { background: var(--vscode-inputValidation-errorBackground, transparent); color: var(--vscode-errorForeground); border: 1px solid var(--vscode-errorForeground); }
  button:focus-visible, summary:focus-visible, input:focus-visible, textarea:focus-visible, .tab:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .muted, .note { color: var(--vscode-descriptionForeground); } .note, .small { font-size: .88em; }
  .row { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 0; }
  ul { padding-left: 18px; } ul.checks, ul.findings, ul.list { list-style: none; padding: 0; margin: 0; }
  .selection { display: flex; gap: 10px; align-items: flex-start; }
  .selection svg { flex: none; margin-top: 2px; } .selection.ok svg { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
  .selection.empty { border-style: dashed; }
  .welcome { text-align: center; padding: 28px 16px; }
  .welcome .hero svg { width: 48px; height: 48px; color: var(--vscode-textLink-foreground); }
  .welcome h2 { font-size: 1.3em; margin: 10px 0 6px; } .welcome p { margin: 0 0 18px; }
  .divider { display: flex; align-items: center; gap: 8px; color: var(--vscode-descriptionForeground); margin: 14px 0; font-size: .85em; }
  .divider::before, .divider::after { content: ""; flex: 1; border-top: 1px solid var(--border); }
  .progress { display: flex; gap: 12px; align-items: flex-start; }
  .spinner { flex: none; width: 18px; height: 18px; border: 2px solid var(--border); border-top-color: var(--vscode-progressBar-background, var(--vscode-focusBorder)); border-radius: 50%; animation: spin .8s linear infinite; margin-top: 2px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .steps { margin: 4px 0; padding-left: 16px; color: var(--vscode-descriptionForeground); font-size: .9em; }
  .tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin: 0 0 var(--gap); }
  .tile { background: var(--card); border: 1px solid var(--border); border-left-width: 3px; border-radius: var(--radius); padding: 8px 10px; }
  .tile .num { font-size: 1.5em; font-weight: 700; line-height: 1.1; } .tile .lbl { font-size: .85em; color: var(--vscode-descriptionForeground); }
  .tile.warn { border-left-color: var(--vscode-editorWarning-foreground); } .tile.err { border-left-color: var(--vscode-errorForeground); }
  .tile.info { border-left-color: var(--vscode-editorInfo-foreground); }
  .check { border-bottom: 1px solid var(--border); padding: 6px 0; } .check:last-child { border-bottom: none; }
  .check-head { display: flex; justify-content: space-between; gap: 6px; flex-wrap: wrap; align-items: center; }
  .chip { display: inline-block; font-size: .82em; border-radius: 10px; padding: 0 8px; border: 1px solid currentColor; white-space: nowrap; }
  .st-passed { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); } .st-issue { color: var(--vscode-editorWarning-foreground); }
  .st-failed { color: var(--vscode-errorForeground); } .st-notrun { color: var(--vscode-descriptionForeground); border-style: dashed; }
  .st-review { color: var(--vscode-editorInfo-foreground); }
  .finding { background: var(--card); border: 1px solid var(--border); border-left: 3px solid var(--border); border-radius: var(--radius); padding: 8px 10px; margin: 0 0 8px; }
  .sev-critical, .sev-high { border-left-color: var(--vscode-errorForeground); } .sev-medium { border-left-color: var(--vscode-editorWarning-foreground); }
  .sev-low, .sev-info { border-left-color: var(--vscode-editorInfo-foreground); }
  .sev { font-weight: 700; font-size: .75em; letter-spacing: .4px; }
  summary { cursor: pointer; } dl { margin: 6px 0 0; } dt { font-weight: 600; margin-top: 6px; } dd { margin: 0; }
  dl.kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; } dl.kv dt { margin: 0; } dl.kv dd { word-break: break-all; }
  pre { white-space: pre-wrap; word-break: break-word; background: var(--vscode-textCodeBlock-background); padding: 6px; border-radius: 4px; font-family: var(--vscode-editor-font-family); margin: 2px 0; }
  .tag { font-size: .75em; border: 1px dashed currentColor; border-radius: 6px; padding: 0 4px; }
  .unverified li { margin: 6px 0; } .err { color: var(--vscode-errorForeground); }
  .hint { background: var(--vscode-editorInfo-background, transparent); border: 1px solid var(--border); padding: 6px; border-radius: var(--radius); }
  .disclaimer { font-size: .85em; color: var(--vscode-descriptionForeground); }
  .decision { border-color: var(--vscode-focusBorder); }
  input[type=range] { width: 100%; }
  .levels { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 var(--gap); }
  .toggle { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0; cursor: pointer; } .toggle input { margin-top: 3px; }
  .row-item { display: flex; width: 100%; align-items: center; gap: 8px; text-align: left; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; margin: 0 0 6px; color: var(--vscode-foreground); }
  .row-item:hover:not(:disabled) { border-color: var(--vscode-focusBorder); }
  .lang { font-size: .75em; font-weight: 700; border: 1px solid var(--border); border-radius: 4px; padding: 1px 4px; }
  .grow { flex: 1; min-width: 0; }
  .empty-state { text-align: center; padding: 24px 8px; color: var(--vscode-descriptionForeground); }
  .empty-state svg { width: 32px; height: 32px; }
  .alert { border-left: 3px solid var(--vscode-errorForeground); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .section-label { font-size: .78em; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--vscode-descriptionForeground); margin: 4px 0 8px; }
  .headline { border-radius: var(--radius); padding: 10px 12px; margin: 0 0 var(--gap); border: 1px solid var(--border); border-left-width: 4px; background: var(--card); }
  .headline.has-findings { border-left-color: var(--vscode-editorWarning-foreground); }
  .headline.no-findings { border-left-color: var(--vscode-editorInfo-foreground); }
  .headline-main { font-weight: 700; font-size: 1.05em; } .headline-sub { color: var(--vscode-descriptionForeground); font-size: .9em; margin-top: 2px; }
  .level-bar { display: flex; align-items: center; gap: 8px; margin: 0 0 var(--gap); flex-wrap: wrap; }
  .segmented { display: inline-flex; border: 1px solid var(--border); border-radius: 5px; overflow: hidden; margin: 0; gap: 0; }
  .segmented button { margin: 0; border-radius: 0; background: transparent; color: var(--vscode-foreground); padding: 3px 10px; }
  .segmented button + button { border-left: 1px solid var(--border); }
  .segmented button.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .f-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  details > summary.f-head { list-style: none; } details > summary.f-head::-webkit-details-marker { display: none; }
  .f-title { font-weight: 600; flex: 1; min-width: 120px; } .f-id { font-size: .8em; }
  .pill { font-size: .7em; font-weight: 700; letter-spacing: .5px; padding: 1px 7px; border-radius: 10px; border: 1px solid currentColor; }
  .pill.sev-critical, .pill.sev-high { color: var(--vscode-errorForeground); } .pill.sev-medium { color: var(--vscode-editorWarning-foreground); }
  .pill.sev-low, .pill.sev-info { color: var(--vscode-editorInfo-foreground); }
  .f-main { margin: 8px 0 4px; }
  .f-main dt { margin: 8px 0 1px; color: var(--vscode-descriptionForeground); font-weight: 600; font-size: .78em; text-transform: uppercase; letter-spacing: .4px; }
  .f-main dt:first-child { margin-top: 0; } .f-main dd { margin: 0; }
  @media (min-width: 480px) {  /* wide panels: two-column label/value layout */
    .f-main { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; }
    .f-main dt { margin: 1px 0 0; }
  }
  .f-more { margin: 4px 0; } .f-more > summary { color: var(--vscode-textLink-foreground); font-size: .9em; }
  .f-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); }
  .fb { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
  button.mini { background: none; color: var(--vscode-textLink-foreground); padding: 1px 5px; margin: 0; font-size: .88em; }
  button.mini:hover { background: var(--vscode-toolbar-hoverBackground); }
  button.mini.done { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); font-weight: 600; }
  .check-row { display: grid; grid-template-columns: 18px auto 1fr; gap: 8px; align-items: baseline; cursor: pointer; padding: 2px 0; list-style: none; }
  .check-row::-webkit-details-marker { display: none; }
  .check-icon { font-weight: 700; text-align: center; } .check-name { font-weight: 600; white-space: nowrap; }
  .check-sum { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .9em; }
  .check-body { padding: 6px 0 4px 26px; } .check-body p { margin: 4px 0; }
  .unverified { list-style: none; padding: 0; } .unverified li { display: flex; gap: 8px; margin: 8px 0; }
  .unv-icon { flex: none; width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--vscode-editorInfo-foreground); color: var(--vscode-editorInfo-foreground);
              font-size: .75em; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; margin-top: 2px; }
  .unverified-card { border-left: 3px solid var(--vscode-editorInfo-foreground); }
  .conf-label { display: block; margin: 6px 0 2px; } .conf-scale { display: flex; justify-content: space-between; margin-top: -2px; }
  .decision-buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 8px; }
  .decision-buttons .dec { margin: 0; padding: 7px 4px; font-weight: 600; border: 1px solid var(--border); }
  .dec.accept:hover { border-color: var(--vscode-testing-iconPassed, var(--vscode-focusBorder)); }
  .dec.reject:hover { border-color: var(--vscode-errorForeground); } .dec.modify:hover { border-color: var(--vscode-editorWarning-foreground); }
  .decided-row { display: flex; gap: 10px; align-items: center; }
  .decided-icon { width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
                  background: var(--vscode-testing-iconPassed, var(--vscode-button-background)); color: var(--vscode-editor-background, #000); font-weight: 700; }
  .benefits { list-style: none; padding: 0; margin: 0 0 18px; text-align: left; } .benefits li { display: flex; gap: 8px; margin: 6px 0; }
  .benefits > li > span { color: var(--vscode-textLink-foreground); font-weight: 700; width: 14px; flex: none; text-align: center; }
  .onboarding { border-style: dashed; } .steps-onboard { margin: 0; padding-left: 20px; } .steps-onboard li { margin: 4px 0; }
  .alert-head { display: flex; align-items: center; gap: 8px; } .alert-head h3 { margin: 0; }
  .alert-icon { width: 20px; height: 20px; border-radius: 50%; background: var(--vscode-errorForeground); color: var(--vscode-editor-background, #000);
                display: inline-flex; align-items: center; justify-content: center; font-weight: 700; flex: none; }
  .tiles.four { grid-template-columns: repeat(4, 1fr); } .tiles.four .num { font-size: 1.25em; }
  @media (max-width: 300px) { .tiles.four { grid-template-columns: repeat(2, 1fr); } }
  .sess-status { margin-bottom: 4px; } .session-head dl.kv { margin: 6px 0 8px; }
  ul.files, ul.plain, ul.matrix { list-style: none; padding: 0; margin: 4px 0; }
  .file-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 3px 0; border-bottom: 1px solid var(--border); }
  .file-row:last-child { border-bottom: none; } .file-row label { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 140px; cursor: pointer; }
  .fpath { font-family: var(--vscode-editor-font-family); font-size: .92em; word-break: break-all; }
  .ftags { display: inline-flex; flex-wrap: wrap; gap: 4px; } .tag.await { color: var(--vscode-editorInfo-foreground); border-style: solid; }
  ul.plain li { margin: 4px 0; word-break: break-word; } ul.plain code, .outdated code { font-family: var(--vscode-editor-font-family); font-size: .92em; }
  ul.matrix li { padding: 4px 0; border-bottom: 1px solid var(--border); } ul.matrix li:last-child { border-bottom: none; }
  .mx { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 4px; }
  .f-badges { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 2px; } button.floc { font-family: var(--vscode-editor-font-family); font-size: .92em; text-align: left; word-break: break-all; }
  .set-row { display: flex; flex-direction: column; gap: 3px; margin: 6px 0 10px; } .set-row span { font-weight: 600; }
  progress { width: 100%; height: 6px; margin: 6px 0 2px; accent-color: var(--vscode-progressBar-background, var(--vscode-focusBorder)); }
  .outdated { border-left: 3px solid var(--vscode-editorWarning-foreground); }
  .finding.sec { padding: 7px 10px; } .sec-reason { margin: 4px 0 2px; } pre.sec-ev { font-size: .9em; margin: 2px 0 4px; max-height: 5.5em; overflow: hidden; }
  summary.sev-group { cursor: pointer; margin: 8px 0 6px; } .tabs { overflow-x: auto; } .tab { padding-left: 8px; padding-right: 8px; white-space: nowrap; }
  .sev-group { font-size: .85em; margin: 10px 0 6px; font-weight: 600; } .sev-group:first-of-type { margin-top: 0; }
  .learned { border-left: 2px solid var(--vscode-editorInfo-foreground); padding: 2px 8px; margin: 6px 0; color: var(--vscode-descriptionForeground); }
  .cmp-counts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; } .compare ul { margin: 4px 0; } .compare details { margin: 4px 0; }
  .cached { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 var(--gap); font-size: .9em; }
  .finding { transition: box-shadow .25s ease, border-color .25s ease; }
  .finding.flash { border-color: var(--vscode-focusBorder); box-shadow: 0 0 0 2px var(--vscode-focusBorder); }
  .card, .tile, .headline { animation: rise .16s ease-out; } @keyframes rise { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style></head><body>
<div id="root" aria-live="polite"><p class="muted" style="padding:10px">Loading…</p></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'render') {  // html is produced by escaping renderers
      const y = m.keepScroll ? document.scrollingElement.scrollTop : 0;
      const open = m.keepScroll ? Array.from(root.querySelectorAll('details')).map((d) => d.open) : [];
      const picked = m.keepScroll ? Array.from(root.querySelectorAll('input[data-pick]:checked')).map((x) => x.dataset.pick) : [];
      root.innerHTML = m.html; wire();
      if (m.keepScroll) {
        const ds = root.querySelectorAll('details');
        if (ds.length === open.length) ds.forEach((d, i) => { d.open = open[i]; });
        root.querySelectorAll('input[data-pick]').forEach((x) => { x.checked = picked.includes(x.dataset.pick); });
        document.scrollingElement.scrollTop = y;
      }
    }
    if (m.type === 'focus' && /^[A-Z]{2,5}-\\d{1,4}$/.test(String(m.finding))) {
      const el = root.querySelector('[data-fid="' + m.finding + '"]');
      if (!el) return;
      el.querySelectorAll('details').forEach((d) => { if (!d.classList.contains('f-more')) d.open = true; });
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
    }
  });
  function conf() { const c = document.getElementById('conf'); return c ? Number(c.value) : null; }
  function val(id) { const el = document.getElementById(id); return el ? el.value : undefined; }
  function wire() {
    const c = document.getElementById('conf');
    if (c) c.addEventListener('input', () => { document.getElementById('confv').textContent = c.value; });
    root.querySelectorAll('[data-action]').forEach((b) => {
      if (b.tagName === 'SELECT') {
        b.addEventListener('change', () => vscode.postMessage({ action: b.dataset.action, key: b.dataset.key, value: b.value }));
        return;
      }
      if (b.type === 'checkbox') {
        b.addEventListener('change', () => vscode.postMessage({ action: b.dataset.action, key: b.dataset.key, value: b.checked }));
        return;
      }
      b.addEventListener('click', () => {
        const d = b.dataset;
        if (d.action === 'feedback' || d.action === 'sessionFeedback') {  // immediate, local confirmation
          b.parentElement.querySelectorAll('button').forEach((x) => { x.disabled = true; });
          b.classList.add('done'); b.textContent = '✓ ' + b.textContent;
        }
        vscode.postMessage({ action: d.action, decision: d.decision, level: d.level, finding: d.finding, rating: d.rating,
          tab: d.tab, job: d.job, path: d.path, run: d.run, key: d.key,
          paths: Array.from(root.querySelectorAll('input[data-pick]:checked')).map((x) => x.dataset.pick), confidence: conf(), task: val('task'), tests: val('tests'), code: val('pcode'), rationale: val('rationale') });
      });
    });
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
