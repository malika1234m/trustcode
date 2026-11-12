// Pure UI renderers for the TrustCode panel (no vscode import -> unit-testable). Every dynamic value is escaped.
import { esc, STATUS_LABEL } from './render';

export type Tab = 'security' | 'verify' | 'session' | 'history' | 'account';
export const TABS: Tab[] = ['security', 'verify', 'session', 'history', 'account'];

const ICON = {
  // The TrustCode mark: selection frame + a check whose stroke fades (see docs/brand). Frame follows the theme's link colour.
  shield: '<svg class="mark" viewBox="0 0 48 48" width="16" height="16" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 17V10a4 4 0 0 1 4-4h7M42 31v7a4 4 0 0 1-4 4h-7" stroke="currentColor" stroke-width="4"/><path class="chk" d="M14 25l7 7 6.3-7.65" stroke-width="4.5"/><path class="chk" d="M29.2 21.9l2.3-2.8" stroke-width="4.5" stroke-linecap="butt" stroke-opacity=".55"/><path class="chk" d="M33.4 16.8l1.6-1.95" stroke-width="4.5" stroke-linecap="butt" stroke-opacity=".3"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  code: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
};

export function header(signedIn: boolean, who: string): string {
  return `<header class="topbar">
    <div class="brand">${ICON.shield}<span>TrustCode</span></div>
    <div class="top-actions">
      <span class="who ${signedIn ? 'on' : ''}" title="${esc(who)}">${signedIn ? '● ' : '○ '}${esc(who)}</span>
      <button class="icon" data-action="refresh" title="Refresh" aria-label="Refresh">${ICON.refresh}</button>
      <button class="icon" data-action="tab" data-tab="account" title="Account and settings" aria-label="Account and settings">${ICON.user}</button>
    </div></header>`;
}

export function tabs(active: Tab): string {
  const label: Record<Tab, string> = { security: 'Security', verify: 'Verify', session: 'Session', history: 'History', account: 'Account' };
  return `<nav class="tabs" role="tablist">${TABS.map((t) =>
    `<button role="tab" class="tab ${t === active ? 'active' : ''}" aria-selected="${t === active}" data-action="tab" data-tab="${t}">${label[t]}</button>`).join('')}</nav>`;
}

export function page(active: Tab, signedIn: boolean, who: string, body: string): string {
  return `${header(signedIn, who)}${tabs(active)}<main class="content">${body}</main>`;
}

export function welcome(backend: string): string {
  return `<header class="topbar"><div class="brand">${ICON.shield}<span>TrustCode</span></div></header>
  <section class="welcome">
    <div class="hero">${ICON.shield}</div>
    <h2>Welcome to TrustCode</h2>
    <p class="muted">Check AI-generated code with real evidence before you accept it.</p>
    <ul class="benefits">
      <li><span aria-hidden="true">✓</span><div>Security, lint and dependency checks on the code you select</div></li>
      <li><span aria-hidden="true">?</span><div>A clear list of what was <strong>not</strong> verified</div></li>
      <li><span aria-hidden="true">✎</span><div>You decide — your files are never changed</div></li>
    </ul>
    <button class="primary wide" data-action="signIn">Sign In with browser</button>
    <button class="link" data-action="createAccount">Create free account</button>
    <div class="divider"><span>or</span></div>
    <button class="secondary wide" data-action="useLocal">Use local mode (code stays on this machine)</button>
    <button class="secondary wide" data-action="tab" data-tab="security">Scan this project for security issues (local, no account)</button>
    <p class="note">Server: ${esc(backend)}</p>
  </section>`;
}

export function waitingForBrowser(mode: 'login' | 'register'): string {
  return `<header class="topbar"><div class="brand">${ICON.shield}<span>TrustCode</span></div></header>
  <section class="welcome">
    <div class="spinner" aria-hidden="true" style="margin:0 auto 14px"></div>
    <h2>${mode === 'register' ? 'Create your account in the browser' : 'Continue in your browser'}</h2>
    <p class="muted">We opened the TrustCode sign-in page. After you ${mode === 'register' ? 'create your account' : 'log in'}, your browser will send you back here.</p>
    <p class="note">If your browser asks to open VS Code, choose <strong>Open</strong>.</p>
    <button class="secondary wide" data-action="${mode === 'register' ? 'createAccount' : 'signIn'}">Open the browser again</button>
    <button class="link" data-action="ready">Cancel</button>
  </section>`;
}

export function verifyForm(sel: { lines: number; language?: string; file?: string; whole?: boolean } | undefined, lastTask = ''): string {
  const selBox = sel
    ? `<div class="card selection ok">${ICON.code}<div><strong>${sel.whole ? `Whole file (${sel.lines} lines)` : `${sel.lines} line(s) selected`}</strong>
         <div class="muted">${esc(sel.language ?? 'unsupported language')}${sel.file ? ` · ${esc(sel.file)}` : ''}</div></div></div>`
    : `<div class="card onboarding"><div class="card-title">Get started</div>
         <ol class="steps-onboard">
           <li><strong>Select</strong> AI-generated Python, JavaScript or TypeScript in the editor</li>
           <li><strong>Describe</strong> what it should do (optional, below)</li>
           <li><strong>Verify</strong> — or right-click → “TrustCode: Verify Selected Code” / “Verify Current File”</li>
         </ol></div>`;
  return `<button class="primary wide" data-action="verify">${ICON.shield} Verify selection</button>
  <button class="secondary wide" data-action="verifyFile">${ICON.code} Verify current file</button>
  ${selBox}
  <section class="card">
    <label for="task" class="card-title">What should the code do? <span class="badge">recommended</span></label>
    <textarea id="task" placeholder="e.g. Return the average of a list, or 0.0 for an empty list">${esc(lastTask)}</textarea>
  </section>
  <details class="card">
    <summary class="card-title">Unit tests <span class="badge">optional</span></summary>
    <p class="muted small">Import the selected code as <code>solution</code>. Tests run only on a self-hosted server with the sandbox.</p>
    <textarea id="tests" placeholder="from solution import average&#10;def test_empty():&#10;    assert average([]) == 0.0"></textarea>
  </details>
  <p class="note">Nothing is sent until you confirm. TrustCode never edits your files.</p>
  <button class="link" data-action="experiment">Join a research study…</button>`;
}

export function errorCard(message: string): string {
  return `<section class="card alert" role="alert">
    <div class="alert-head"><span class="alert-icon" aria-hidden="true">!</span><h3>Something went wrong</h3></div>
    <p>${esc(message)}</p>
    <div class="row"><button class="primary" data-action="refresh">Retry</button>
    <button data-action="openSettings">Settings</button><button class="link" data-action="home">Back</button></div></section>`;
}

export function progress(status: string): string {
  const steps = ['Syntax', 'Static analysis', 'Type checking', 'Security patterns', 'Hardcoded secrets', 'Unit tests', 'Dependencies'];
  return `<section class="card progress" aria-busy="true">
    <div class="spinner" aria-hidden="true"></div>
    <div><strong>Verification ${esc(status)}…</strong>
    <div class="muted small">Independent checks (each reports its own result; some may not be available on this server):</div>
    <ul class="steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ul>
    <div class="muted small">You can cancel from the notification.</div></div></section>`;
}

/** Counts are computed from the evidence itself; no aggregate verdict is implied. */
export function summaryTiles(view: any): string {
  const checks: any[] = view?.checks ?? [];
  const n = (st: string) => checks.filter((c) => c.status === st).length;
  const findings = (view?.findings ?? []).length;
  const unverified = (view?.unverified ?? []).length + (view?.llm?.assumptions ?? []).length;
  const tile = (num: number, label: string, cls: string, hint: string) =>
    `<div class="tile ${cls}" title="${esc(hint)}"><div class="num">${num}</div><div class="lbl">${esc(label)}</div></div>`;
  return `<div class="tiles">
    ${tile(findings, 'Findings', findings ? 'warn' : 'neutral', 'Issues reported by the checks')}
    ${tile(unverified, 'Not verified', unverified ? 'info' : 'neutral', 'Areas no check covered')}
    ${tile(n('passed'), 'No findings', 'neutral', 'Checks that reported nothing within their scope')}
    ${tile(n('check_failed') + n('not_run'), 'Not run / failed', n('check_failed') ? 'err' : 'neutral', 'Checks that did not produce a result')}
  </div>`;
}

export function history(items: any[]): string {
  if (!items.length) {
    return `<section class="empty-state">${ICON.code}<p>No verifications yet.</p>
      <p class="muted small">Results are kept for 24 hours (30 days if you enable history in Account).</p></section>`;
  }
  const label = (s: string) => ({ done: 'Done', failed: 'Failed', cancelled: 'Cancelled', expired: 'Expired', queued: 'Queued', running: 'Running' } as any)[s] ?? s;
  return `<ul class="list">${items.map((j) => `
    <li><button class="row-item" data-action="openJob" data-job="${esc(j.id)}" ${[j.status !== 'done' || j.language === 'session' ? 'disabled' : '', j.language === 'session' ? 'title="Multi-file reports are kept in the Session tab"' : ''].filter(Boolean).join(' ')}>
      <span class="lang">${esc(j.language === 'session' ? 'MULTI' : (j.language ?? '?').slice(0, 2).toUpperCase())}</span>
      <span class="grow"><strong>${j.language === 'session' ? 'Multi-file · ' : ''}${esc(j.code_lines)} line(s)</strong> <span class="muted">${esc(new Date(j.created_at).toLocaleString())}</span></span>
      <span class="chip ${j.status === 'done' ? 'st-passed' : 'st-notrun'}">${esc(label(j.status))}</span>
    </button></li>`).join('')}</ul>`;
}

export function account(p: { backend: string; mode: string; signedIn: boolean; profile?: any }): string {
  const lvl = p.profile?.experience_level ?? 'intermediate';
  const levels = ['beginner', 'intermediate', 'advanced'].map((l) =>
    `<button data-action="setLevel" data-level="${l}" aria-pressed="${l === lvl}" class="${l === lvl ? 'on' : ''}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('');
  const toggle = (key: string, label: string, help: string) =>
    `<label class="toggle"><input type="checkbox" data-action="privacy" data-key="${key}" ${p.profile?.[key] ? 'checked' : ''}>
      <span><strong>${esc(label)}</strong><br><span class="muted small">${esc(help)}</span></span></label>`;
  return `<section class="card">
    <div class="card-title">Connection</div>
    <dl class="kv"><dt>Server</dt><dd>${esc(p.backend)}</dd><dt>Mode</dt><dd>${esc(p.mode)}</dd>
    <dt>Status</dt><dd>${p.signedIn ? '<span class="chip st-passed">✓ Signed in</span>' : '<span class="chip st-notrun">– Signed out</span>'}</dd></dl>
    <div class="row">${p.signedIn ? '<button data-action="signOut">Sign out</button>' : '<button class="primary" data-action="signIn">Sign in</button>'}
    <button data-action="openSettings">Change server…</button></div>
  </section>
  ${p.profile ? `<section class="card"><div class="card-title">Explanation detail</div><div class="levels" role="group" aria-label="Explanation detail">${levels}</div></section>
  <section class="card"><div class="card-title">Privacy</div>
    ${toggle('store_history', 'Keep verification history (30 days)', 'Off: results are deleted after 24 hours.')}
    ${toggle('allow_llm', 'Allow AI-worded explanations', 'The server may send finding details to its LLM provider.')}
    ${toggle('adaptive_suggestions', 'Suggest explanation level from my feedback', 'Never changes the level automatically.')}
  </section>
  <section class="card danger"><div class="card-title">Danger zone</div>
    <div class="row"><button data-action="forgetConsent">Ask before sending code again</button>
    <button class="danger" data-action="deleteData">Delete my account and data</button></div></section>` : ''}`;
}

export const STATUS_KEYS = Object.keys(STATUS_LABEL);
