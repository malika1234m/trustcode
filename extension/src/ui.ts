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

/** Shown above Verify and Session while the local engine is not usable. Says exactly what state it is in. */
export function engineNotice(e: { status: string; detail?: string }): string {
  if (e.status === 'ready') return '';
  if (e.status === 'installing') return `<section class="card progress" aria-busy="true"><div class="spinner" aria-hidden="true"></div><div><strong>Setting up the local engine…</strong>
    <div class="muted small">Downloading the analysis tools from PyPI. This takes a few minutes the first time.</div><button class="link" data-action="engineLog">Show log</button></div></section>`;
  const failed = e.status === 'failed';
  return `<section class="card ${failed ? 'alert' : 'onboarding'}" ${failed ? 'role="alert"' : ''}><div class="card-title">${failed ? 'The local engine is not working' : 'Set up the local engine'}</div>
    <p>${failed ? esc(e.detail ?? 'Setup did not finish.') : 'TrustCode checks your code on this computer, so the code is never uploaded. This needs a one-time setup.'}</p>
    <p class="muted small">Setup creates a private Python environment in VS Code's storage and downloads the analysis tools from PyPI (about 300 MB). Needs Python 3.11 or newer. Nothing is changed in your project. <strong>Until it is set up, nothing is checked.</strong></p>
    <div class="row"><button class="primary" data-action="engineSetup">${failed ? 'Try again' : 'Set up now'}</button>${failed ? '<button data-action="engineLog">Show log</button>' : ''}
    <button class="link" data-action="engineUseServer">Use the TrustCode server instead</button></div></section>`;
}

export function verifyForm(sel: { lines: number; language?: string; file?: string; whole?: boolean } | undefined, lastTask = '', local = false): string {
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
    <p class="muted small">Import the selected code as <code>solution</code>. ${local ? 'Tests run only inside the Docker sandbox on this computer; without it they are reported as not run.' : 'Tests run only on a self-hosted server with the sandbox.'}</p>
    <textarea id="tests" placeholder="from solution import average&#10;def test_empty():&#10;    assert average([]) == 0.0"></textarea>
  </details>
  <p class="note">${local ? 'Checks run on this computer. Your code is not uploaded.' : 'Nothing is sent until you confirm.'} TrustCode never edits your files.</p>
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

export function history(items: any[], local = false): string {
  if (!items.length) {
    return `<section class="empty-state">${ICON.code}<p>No verifications yet.</p>
      <p class="muted small">${local ? 'The last 25 results are kept on this computer (turn history off in Account).' : 'Results are kept for 24 hours (30 days if you enable history in Account).'}</p></section>`;
  }
  const label = (s: string) => ({ done: 'Done', failed: 'Failed', cancelled: 'Cancelled', expired: 'Expired', queued: 'Queued', running: 'Running' } as any)[s] ?? s;
  return `<ul class="list">${items.map((j) => `
    <li><button class="row-item" data-action="openJob" data-job="${esc(j.id)}" ${[j.status !== 'done' || j.language === 'session' ? 'disabled' : '', j.language === 'session' ? 'title="Multi-file reports are kept in the Session tab"' : ''].filter(Boolean).join(' ')}>
      <span class="lang">${esc(j.language === 'session' ? 'MULTI' : (j.language ?? '?').slice(0, 2).toUpperCase())}</span>
      <span class="grow"><strong>${j.language === 'session' ? 'Multi-file · ' : ''}${esc(j.code_lines)} line(s)</strong> <span class="muted">${esc(new Date(j.created_at).toLocaleString())}</span></span>
      <span class="chip ${j.status === 'done' ? 'st-passed' : 'st-notrun'}">${esc(label(j.status))}</span>
    </button></li>`).join('')}</ul>`;
}

export function account(p: { backend: string; mode: string; signedIn: boolean; profile?: any; local?: boolean }): string {
  const lvl = p.profile?.experience_level ?? 'intermediate';
  const levels = ['beginner', 'intermediate', 'advanced'].map((l) =>
    `<button data-action="setLevel" data-level="${l}" aria-pressed="${l === lvl}" class="${l === lvl ? 'on' : ''}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('');
  const toggle = (key: string, label: string, help: string) =>
    `<label class="toggle"><input type="checkbox" data-action="privacy" data-key="${key}" ${p.profile?.[key] ? 'checked' : ''}>
      <span><strong>${esc(label)}</strong><br><span class="muted small">${esc(help)}</span></span></label>`;
  const where = p.local
    ? `<section class="card"><div class="card-title">Where checks run</div>
      <p><span class="chip st-passed">On this computer</span> Verify, Session and Security run locally. No account is needed and your code is not uploaded.</p>
      <div class="row"><button data-action="engineUseServer">Use the TrustCode server instead…</button></div></section>`
    : `<section class="card"><div class="card-title">Where checks run</div>
      <p><span class="chip st-review">TrustCode server</span> Verify and Session send the code you choose to ${esc(p.backend)} after you confirm. Security runs locally.</p>
      <div class="row"><button class="primary" data-action="engineUseLocal">Run checks on this computer</button></div></section>`;
  return `${where}<section class="card">
    <div class="card-title">${p.local ? 'TrustCode account (optional)' : 'Connection'}</div>
    ${p.local ? '<p class="muted small">Only needed for server analysis, a paid plan or the research study.</p>' : ''}
    <dl class="kv"><dt>Server</dt><dd>${esc(p.backend)}</dd><dt>Mode</dt><dd>${esc(p.mode)}</dd>
    <dt>Status</dt><dd>${p.signedIn ? '<span class="chip st-passed">✓ Signed in</span>' : '<span class="chip st-notrun">– Signed out</span>'}</dd></dl>
    <div class="row">${p.signedIn ? '<button data-action="signOut">Sign out</button>' : '<button class="primary" data-action="signIn">Sign in</button>'}
    <button data-action="openSettings">Change server…</button></div>
  </section>
  ${p.profile ? `<section class="card"><div class="card-title">Explanation detail</div><div class="levels" role="group" aria-label="Explanation detail">${levels}</div></section>
  <section class="card"><div class="card-title">Privacy</div>
    ${p.local ? toggle('store_history', 'Keep verification history on this computer', 'Off: results are kept only until VS Code is closed.')
      : toggle('store_history', 'Keep verification history (30 days)', 'Off: results are deleted after 24 hours.')}
    ${p.local ? '' : toggle('allow_llm', 'Allow AI-worded explanations', 'The server may send finding details to its LLM provider.')}
    ${toggle('adaptive_suggestions', 'Suggest explanation level from my feedback', 'Never changes the level automatically.')}
  </section>
  <section class="card danger"><div class="card-title">Danger zone</div>
    <div class="row">${p.local ? '' : '<button data-action="forgetConsent">Ask before sending code again</button>'}
    <button class="danger" data-action="deleteData">${p.local ? 'Delete my TrustCode data' : 'Delete my account and data'}</button></div></section>` : ''}`;
}

export interface PrivacyInputs {
  scanner: 'ready' | 'missing' | 'untrusted' | 'no-workspace'; signedIn: boolean; backend: string; localBackend: boolean;
  llmSetting: boolean; llmAllowedInProfile: boolean; llmAvailableOnServer: boolean; onlineAdvisories: boolean; updateCheck: boolean;
  entitlementVerifiedAt?: number; entitlementOffline?: boolean;
  /** Present when Verify and Session run on this machine. */
  engine?: { status: string; version?: string; managed?: boolean }; localHistory?: { runs: number; feedback: number }; registryLookups?: boolean;
}
/** Privacy status rows computed from the current settings and connection state - never fixed labels. */
export function privacyStatus(p: PrivacyInputs, now = Date.now()): Array<{ label: string; value: string; detail: string; on: boolean }> {
  const llm = p.llmSetting && p.llmAllowedInProfile && p.llmAvailableOnServer;
  const verified = p.entitlementVerifiedAt ? `${Math.max(0, Math.round((now - p.entitlementVerifiedAt) / 60000))} min ago` : 'never';
  return [
    { label: 'Security scanning', on: false, value: p.scanner === 'ready' ? 'Local' : p.scanner === 'missing' ? 'Not available (scanner not installed)' : 'Not running',
      detail: 'The Security tab reads files on this machine with a local program. Nothing is uploaded.' },
    ...(p.engine ? [
      { label: 'Verify and Session analysis', on: false,
        value: p.engine.status === 'ready' ? `On this computer${p.engine.version ? ` (${p.engine.version})` : ''}` : p.engine.status === 'installing' ? 'Local engine is being set up' : 'Not available (local engine not set up)',
        detail: 'The code is passed to a local program and is not uploaded. Chosen with trustcode.analysis.location.' },
      { label: 'Code sent to the TrustCode server', on: false, value: 'Never', detail: 'Local analysis is selected, so no verification request goes to the server.' },
      { label: 'History, decisions and feedback', on: false, value: `Kept on this computer (${p.localHistory?.runs ?? 0} runs, ${p.localHistory?.feedback ?? 0} ratings)`,
        detail: 'Stored in VS Code\'s storage for this user, readable only by you. Remove with “Delete my TrustCode data”.' },
      { label: 'Package registry lookups', on: !!p.registryLookups, value: p.registryLookups ? 'On: imported package names are sent to PyPI / npm' : 'Off',
        detail: 'Controlled by trustcode.engine.registryLookups. Off: whether a package exists is reported as not checked. Source code is never part of this lookup.' },
    ] : [
      { label: 'Code sent to the TrustCode server', on: p.signedIn,
        value: !p.signedIn ? 'Never (signed out)' : p.localBackend ? `Only to your own machine (${p.backend})` : `Only when you use Verify or Session, after you confirm (${p.backend})`,
        detail: 'The Verify and Session tabs analyse code on the server. Files matching the sensitive-file patterns are never sent. The Security tab never uses the server.' },
    ]),
    { label: 'Your API keys and credentials', on: false, value: 'Not collected',
      detail: 'TrustCode asks for no API keys. Secrets found by the scanner are masked before they are shown or stored. The sign-in token is kept in VS Code SecretStorage.' },
    { label: 'External AI analysis', on: llm && !p.engine, value: p.engine ? 'Off (not available for local analysis)' : llm ? 'On: finding details are sent by the server to its AI provider' : 'Off',
      detail: p.engine ? 'No code or findings are sent to an AI provider.' : llm ? 'Turn off with the trustcode.useLlmExplanations setting or the “Allow AI-worded explanations” toggle.'
        : p.llmSetting && !p.llmAvailableOnServer ? 'The setting is on, but this server has no AI provider configured, so nothing is sent.' : 'No code or findings are sent to an AI provider.' },
    { label: 'Dependency advisory lookups', on: p.onlineAdvisories, value: p.onlineAdvisories ? 'On: package names and versions are sent to osv.dev' : 'Off',
      detail: 'Controlled by trustcode.scanner.onlineAdvisories. Source code is never part of this lookup.' },
    { label: 'Telemetry and analytics', on: false, value: 'None', detail: 'TrustCode contains no telemetry or analytics code.' },
    { label: 'Update check', on: p.updateCheck, value: p.updateCheck ? 'On: reads the public release list on GitHub' : 'Off',
      detail: 'Sends no account or project data. Controlled by trustcode.updates.check.' },
    { label: 'Subscription verification', on: p.signedIn, value: !p.signedIn ? 'Not connected (signed out)' : p.entitlementOffline ? `Offline — last verified ${verified}` : `Connected — verified ${verified}`,
      detail: 'Only your account identity is sent. The server decides the plan; nothing stored on this machine can grant paid features.' },
  ];
}

export interface DashboardData {
  entitlements?: any; verifiedAt?: number; offline?: boolean; stale?: boolean; email?: string;
  update: { installed: string; latest?: string; available: boolean; notes?: string; checkedAt?: number; error?: string; canInstall?: boolean; tooOld?: boolean };
  privacy: PrivacyInputs;
}
const fmtDate = (iso?: string | null) => { const d = iso ? new Date(iso) : undefined; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '—'; };
const STATE_LABEL: Record<string, string> = { free: 'Free plan', active: 'Active', renewal_due: 'Renewal due', payment_failed: 'Payment failed (grace period)',
  cancelled: 'Cancelled (active until the period ends)', expired: 'Expired', refunded: 'Refunded', disputed: 'Payment disputed' };

/** Account, usage, updates and privacy. Every value comes from the server response or the running extension. */
export function accountDashboard(d: DashboardData, now = Date.now()): string {
  const e = d.entitlements;
  const sub = e?.subscription ?? {};
  const ago = d.verifiedAt ? (now - d.verifiedAt < 90_000 ? 'just now' : `${Math.round((now - d.verifiedAt) / 60000)} min ago`) : 'never';
  const plan = !e ? `<section class="card"><div class="card-title">Plan</div><p class="muted">${d.privacy.signedIn ? 'The plan could not be verified with the server, and no recent verification is stored. Server-side limits still apply.' : d.privacy.engine ? 'No account is connected. Checks run on this computer and need none; sign in only for server analysis, a paid plan or the research study.' : 'Sign in to see your plan. The Security tab works without an account.'}</p></section>`
    : `<section class="card" aria-labelledby="h-plan"><h3 id="h-plan" class="section-label">Account</h3>
    <dl class="kv">${d.email ? `<dt>Account</dt><dd>${esc(d.email)}</dd>` : ''}<dt>Plan</dt><dd>${esc(e.plan?.name ?? 'Free')}</dd>
      <dt>Status</dt><dd>${esc(STATE_LABEL[sub.state] ?? sub.state ?? 'unknown')}</dd>
      ${sub.current_period_end ? `<dt>${sub.cancel_at_period_end || sub.state === 'cancelled' ? 'Paid until' : 'Next renewal'}</dt><dd>${esc(fmtDate(sub.current_period_end))}</dd>` : ''}
      ${sub.grace_until && sub.state !== 'active' ? `<dt>Grace period ends</dt><dd>${esc(fmtDate(sub.grace_until))}</dd>` : ''}
      <dt>Last verified</dt><dd>${esc(ago)}${d.offline ? ' <span class="chip st-review">offline — showing the last verified state</span>' : ''}</dd></dl>
    ${sub.reason && sub.state !== 'free' && sub.state !== 'active' ? `<p class="hint small">${esc(sub.reason)}</p>` : ''}
    ${sub.billing_live === false ? '<p class="muted small">Paid plans are not on sale yet: every account is on the Free plan.</p>' : ''}
    <h3 class="section-label">Usage</h3>
    <dl class="kv"><dt>Server verifications this month</dt><dd>${esc(e.usage?.verifications_this_month ?? 0)}${e.limits?.verifications_per_month == null ? ' (no limit)' : ` of ${esc(e.limits.verifications_per_month)}`}</dd>
      ${e.usage?.remaining != null ? `<dt>Remaining</dt><dd>${esc(e.usage.remaining)}</dd>` : ''}<dt>Resets</dt><dd>${esc(fmtDate(e.usage?.resets_at))}</dd>
      <dt>Local security scans</dt><dd>Not limited, not counted</dd></dl></section>`;
  const u = d.update;
  const updates = `<section class="card" aria-labelledby="h-upd"><h3 id="h-upd" class="section-label">Updates</h3>
    <dl class="kv"><dt>Installed version</dt><dd>${esc(u.installed)}</dd><dt>Latest version</dt><dd>${esc(u.latest ?? (u.error ? 'unknown' : 'not checked yet'))}</dd>
      <dt>Status</dt><dd>${u.error ? `<span class="chip st-review">? ${esc(u.error)}</span>` : u.available ? '<span class="chip st-issue">! Update available</span>' : u.latest ? '<span class="chip st-notrun">Up to date</span>' : '<span class="chip st-notrun">–</span>'}</dd></dl>
    ${u.tooOld ? '<p class="err small">This version is older than the server still supports. Update to keep using Verify and Session.</p>' : ''}
    ${u.available && u.notes ? `<details><summary>Release notes for ${esc(u.latest)}</summary><pre class="notes">${esc(u.notes)}</pre></details>` : ''}
    <div class="row"><button data-action="checkUpdates">Check now</button>${u.available ? `${u.canInstall ? '<button class="primary" data-action="installUpdate">Download, verify and install</button>' : ''}<button data-action="openRelease">Open release page</button>` : ''}</div>
    <p class="muted small">Updates come from the project's GitHub releases. A download is installed only if its SHA-256 checksum matches the one published with the release, and never if it is older than the installed version.</p></section>`;
  const rows = privacyStatus(d.privacy, now).map((r) => `<li><details><summary><span class="chip ${r.on ? 'st-review' : 'st-notrun'}">${r.on ? '↗' : '●'}</span> <strong>${esc(r.label)}</strong>: ${esc(r.value)}</summary><p class="muted small">${esc(r.detail)}</p></details></li>`).join('');
  return `${plan}${updates}<section class="card" aria-labelledby="h-priv"><h3 id="h-priv" class="section-label">Privacy status</h3>
    <ul class="plain">${rows}</ul><div class="row"><button data-action="trustCenter">Trust Center</button><button data-action="openSettings">Settings</button></div></section>`;
}

export const STATUS_KEYS = Object.keys(STATUS_LABEL);
