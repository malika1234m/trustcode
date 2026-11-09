import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ApiError, describeError, Tokens, TrustCodeApi } from './api';
import { consentMessage, ConsentState, isLoopback, languageFor, needsPrompt, normaliseBackend, remember, SupportedLanguage, thirdPartyKind } from './consent';
import { DecisionState, esc, Level, renderDecision, renderHeadline, renderResult } from './render';
import { authorizeUrl, callbackUri, newPkce, parseCallback, Pending } from './auth';
import { shellHtml } from './panel';
import { account, errorCard, history, page, progress as progressCard, summaryTiles, Tab, TABS, verifyForm, waitingForBrowser, welcome } from './ui';

// Secrets are bound to the backend origin, so tokens are never sent to a different server.
const backendUrl = () => vscode.workspace.getConfiguration('trustcode').get<string>('backendUrl')!;
const TOKEN_KEY = () => `trustcode.tokens:${normaliseBackend(backendUrl())}`;
const PARTICIPANT_KEY = () => `trustcode.participantToken:${normaliseBackend(backendUrl())}`;
const CONSENT_KEY = 'trustcode.consent';

interface Selection { code: string; language?: SupportedLanguage; lines: number; uri: vscode.Uri; startLine: number }

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const DECISIONS = ['accept', 'modify', 'reject'] as const;
const RATINGS = ['helpful', 'not_helpful', 'too_technical', 'too_simple', 'incorrect'] as const;
const TRACK_TYPES = ['evidence_expand', 'evidence_collapse', 'unverified_view'] as const;
const MAX_CODE_CHARS = 50_000;
const oneOf = <T extends readonly string[]>(v: unknown, allowed: T): T[number] | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T[number]) : undefined;
const confidenceOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : undefined);
const textOf = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

const SEV: Record<string, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Warning, high: vscode.DiagnosticSeverity.Warning,
  medium: vscode.DiagnosticSeverity.Information, low: vscode.DiagnosticSeverity.Information, info: vscode.DiagnosticSeverity.Hint,
};

class TrustCodeView implements vscode.WebviewViewProvider {
  view?: vscode.WebviewView;
  selection?: Selection;
  jobId?: string;
  level?: Level;
  trialId?: string;
  private lastTask = '';

  readonly diagnostics = vscode.languages.createDiagnosticCollection('trustcode');

  constructor(private ctx: vscode.ExtensionContext, private api: TrustCodeApi, private participantApi: TrustCodeApi) {}

  /** Show findings as editor hints at their real line (evidence, not verdicts: never "Error" severity). */
  showDiagnostics(result: any) {
    if (!this.selection) return;
    const sel = this.selection;
    const diags: vscode.Diagnostic[] = [];
    for (const c of result?.checks ?? []) {
      for (const f of c.findings ?? []) {
        if (!f.location?.line) continue;
        const line = sel.startLine + f.location.line - 1;
        const end = sel.startLine + (f.location.end_line ?? f.location.line) - 1;
        const d = new vscode.Diagnostic(new vscode.Range(line, 0, end, Number.MAX_SAFE_INTEGER),
          `${f.title} (${f.id}) — ${f.message}`, SEV[f.severity] ?? vscode.DiagnosticSeverity.Information);
        d.source = `TrustCode · ${f.tool}`;
        d.code = f.rule_id ?? undefined;
        diags.push(d);
      }
    }
    this.diagnostics.set(sel.uri, diags);
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = shellHtml(view.webview);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => this.error(e)));
  }

  activeTab: Tab = 'verify';
  private signedIn = false;

  private mode() { return vscode.workspace.getConfiguration('trustcode').get<string>('mode', 'account'); }
  private who() {
    if (this.mode() === 'local') return 'Local mode';
    try { return this.signedIn ? new URL(backendUrl()).hostname : 'Signed out'; } catch { return 'Signed out'; }
  }
  async refreshAuth() {
    this.signedIn = this.mode() === 'local' || !!(await this.ctx.secrets.get(TOKEN_KEY()));
    return this.signedIn;
  }
  /** Posts a full page (header + tabs + body). The body is produced by escaping renderers only. */
  render(html: string) { this.view?.webview.postMessage({ type: 'render', html: page(this.activeTab, this.signedIn, this.who(), html) }); }
  private renderRaw(html: string) { this.view?.webview.postMessage({ type: 'render', html }); }
  renderWaitingForBrowser(mode: 'login' | 'register') { this.renderRaw(waitingForBrowser(mode)); }

  async showForm() {
    await this.refreshAuth();
    if (!this.signedIn) return this.renderRaw(welcome(backendUrl()));
    this.activeTab = 'verify';
    const sel = this.selection && { lines: this.selection.lines, language: this.selection.language, file: path.basename(this.selection.uri.path) };
    this.render(verifyForm(sel, this.lastTask));
  }
  async showTab(tab: Tab) {
    await this.refreshAuth();
    if (!this.signedIn && tab !== 'account') return this.renderRaw(welcome(backendUrl()));
    this.activeTab = tab;
    if (tab === 'verify') return this.jobId ? this.showExplanation() : this.showForm();
    if (tab === 'history') {
      this.render('<p class="muted">Loading history…</p>');
      const pageData = await this.api.request('GET', '/verifications?limit=25');
      return this.render(history(pageData.items ?? []));
    }
    const profile = this.signedIn ? await this.api.request('GET', '/profile').catch(() => undefined) : undefined;
    this.render(account({ backend: backendUrl(), mode: this.mode(), signedIn: this.signedIn, profile }));
  }
  error(e: unknown) {
    const msg = describeError(e);
    vscode.window.showErrorMessage(`TrustCode: ${msg}`);
    this.render(errorCard(msg));
  }

  captureSelection(): boolean {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.selection.isEmpty) {
      vscode.window.showInformationMessage('TrustCode: select the AI-generated code you want to verify first.');
      return false;
    }
    const code = ed.document.getText(ed.selection);  // read-only access; the document is never modified
    this.selection = { code, language: languageFor(ed.document.languageId), lines: code.split('\n').length,
      uri: ed.document.uri, startLine: ed.selection.start.line };
    return true;
  }

  /** Webview messages are untrusted input: every field is validated against an allow-list before use. */
  async onMessage(m: any) {
    if (!m || typeof m !== 'object') return;
    switch (m.action) {
      case 'ready': return this.showForm();
      case 'home': this.jobId = undefined; return this.showForm();
      case 'refresh': return this.showTab(this.activeTab);
      case 'tab': { const tab = oneOf(m.tab, TABS); return tab ? this.showTab(tab) : undefined; }
      case 'signIn': return void vscode.commands.executeCommand('trustcode.signIn');  // shows "continue in your browser"
      case 'createAccount': return void vscode.commands.executeCommand('trustcode.signIn', 'create');
      case 'useLocal': {
        const cfg = vscode.workspace.getConfiguration('trustcode');
        await cfg.update('mode', 'local', vscode.ConfigurationTarget.Global);
        if (!isLoopback(backendUrl())) await cfg.update('backendUrl', 'http://127.0.0.1:8000', vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('TrustCode: local mode on. Start the local backend (see README) before verifying.');
        return this.showForm();
      }
      case 'reveal': return this.reveal(m.finding);
      case 'changeDecision': if (this.jobId) { this.decisions.delete(this.jobId); this.renderResultPage(); } return;
      case 'openSettings': return void vscode.commands.executeCommand('workbench.action.openSettings', 'trustcode');
      case 'openJob': {
        if (typeof m.job !== 'string' || !/^[a-f0-9]{32}$/.test(m.job)) return;
        this.jobId = m.job; this.activeTab = 'verify';
        return this.showExplanation();
      }
      case 'setLevel': {
        const level = oneOf(m.level, LEVELS);
        if (!level) return;
        await this.api.request('PATCH', '/profile', { experience_level: level });
        this.level = undefined;
        return this.showTab('account');
      }
      case 'privacy': {
        const key = oneOf(m.key, ['store_history', 'allow_llm', 'adaptive_suggestions'] as const);
        if (!key || typeof m.value !== 'boolean') return;
        await this.api.request('PATCH', '/profile', { [key]: m.value });
        return void vscode.window.setStatusBarMessage('TrustCode: privacy setting saved', 2500);
      }
      case 'signOut': await vscode.commands.executeCommand('trustcode.signOut'); return this.showForm();
      case 'forgetConsent': return void vscode.commands.executeCommand('trustcode.forgetConsent');
      case 'deleteData': await vscode.commands.executeCommand('trustcode.deleteMyData'); return this.showForm();
      case 'verify': this.lastTask = textOf(m.task, 10_000) ?? ''; return this.verify(textOf(m.task, 10_000), textOf(m.tests, MAX_CODE_CHARS));
      case 'level': {
        const level = oneOf(m.level, LEVELS);
        if (!level) return;  // ignore malformed values instead of persisting them
        this.level = level;
        return this.showExplanation();
      }
      case 'decide': return this.decide(m);
      case 'feedback': {
        const rating = oneOf(m.rating, RATINGS);
        if (!rating || !this.jobId) return;
        await this.api.request('POST', '/feedback', { job_id: this.jobId, finding_id: textOf(m.finding, 20), rating });
        return void vscode.window.setStatusBarMessage('TrustCode: thanks for the feedback', 2500);
      }
      case 'experiment': return vscode.commands.executeCommand('trustcode.startExperiment');
      case 'trial-decide': return this.trialDecide(m);
      case 'track': return this.track(m);
      case 'tlx': return this.submitTlx(m);
      default: return;  // unknown actions are ignored
    }
  }

  async ensureSignedIn(): Promise<boolean> {
    if (await this.ctx.secrets.get(TOKEN_KEY())) return true;
    const cfg = vscode.workspace.getConfiguration('trustcode');
    if (cfg.get('mode') === 'local') {
      if (!isLoopback(backendUrl())) {
        vscode.window.showErrorMessage('TrustCode: local mode only works with a loopback backend (127.0.0.1, localhost, ::1). The local secret was not sent.');
        return false;
      }
      const secretFile = path.join(os.homedir(), '.trustcode', 'local-secret');
      if (!fs.existsSync(secretFile)) {
        vscode.window.showErrorMessage('TrustCode local mode: start the local backend first (it creates ~/.trustcode/local-secret).');
        return false;
      }
      await this.api.localLogin(fs.readFileSync(secretFile, 'utf8').trim());
      return true;
    }
    await vscode.commands.executeCommand('trustcode.signIn');
    return !!(await this.ctx.secrets.get(TOKEN_KEY()));
  }

  private busy = false;

  async verify(task?: string, tests?: string) {
    if (this.busy) {
      vscode.window.setStatusBarMessage('TrustCode: a verification is already running', 3000);
      return;
    }
    this.busy = true;
    try {
      await this.verifyOnce(task, tests);
    } finally {
      this.busy = false;
    }
  }

  private async verifyOnce(task?: string, tests?: string) {
    // Prefer the editor's current selection so a stale capture is never sent by mistake.
    const ed = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors.find((e) => !e.selection.isEmpty);
    if (ed && !ed.selection.isEmpty) {
      // Always refresh: identical text in another file or position must map findings to the right document/lines.
      const current = ed.document.getText(ed.selection);
      this.selection = { code: current, language: languageFor(ed.document.languageId), lines: current.split('\n').length,
        uri: ed.document.uri, startLine: ed.selection.start.line };
    }
    if (!this.selection && !this.captureSelection()) return;
    if (!this.selection) return;
    if (!this.selection.language) {
      const langId = await vscode.workspace.openTextDocument(this.selection.uri).then((d) => d.languageId, () => 'unknown');
      const name = ({ java: 'Java', csharp: 'C#', go: 'Go', rust: 'Rust',
        cpp: 'C++', c: 'C', php: 'PHP', ruby: 'Ruby', markdown: 'Markdown', json: 'JSON', plaintext: 'plain text' } as Record<string, string>)[langId] ?? langId;
      const msg = `${name} isn't supported yet — TrustCode currently verifies Python, JavaScript and TypeScript. Nothing was sent.`;
      vscode.window.showWarningMessage(`TrustCode: ${msg}`);
      this.render(`<section class="card onboarding"><div class="card-title">Unsupported language</div><p>${esc(msg)}</p>
        <p class="muted small">Select Python (.py), JavaScript (.js) or TypeScript (.ts) code and try again.</p>
        <button class="primary" data-action="home">OK</button></section>`);
      return;
    }
    const library = this.selection.uri.scheme === 'file' ? thirdPartyKind(this.selection.uri.fsPath) : undefined;
    if (library) {
      const go = await vscode.window.showWarningMessage(
        `This code is from ${library}, not AI-generated code. TrustCode is designed to check AI-generated code; for dependency `
        + 'vulnerabilities use a dependency scanner (e.g. npm audit / pip-audit). Verify it anyway?', { modal: true }, 'Verify anyway');
      if (go !== 'Verify anyway') return;
    }
    if (this.selection.code.length > MAX_CODE_CHARS || (tests?.length ?? 0) > MAX_CODE_CHARS) {
      vscode.window.showWarningMessage(`TrustCode: the selection or tests exceed ${MAX_CODE_CHARS.toLocaleString()} characters. Select a smaller part. Nothing was sent.`);
      return;
    }
    this.diagnostics.clear();
    const sel = this.selection!;
    const cfg = vscode.workspace.getConfiguration('trustcode');
    const backend = cfg.get<string>('backendUrl')!;
    const consent = this.ctx.globalState.get<ConsentState>(CONSENT_KEY, { trustedBackends: [] });
    if (needsPrompt(consent, backend)) {
      const choice = await vscode.window.showWarningMessage(
        consentMessage(sel.lines, sel.code.length, backend, !!tests, cfg.get('useLlmExplanations', false)),
        { modal: true }, 'Send', 'Send and don\'t ask again for this server');
      if (!choice) return;
      if (choice !== 'Send') await this.ctx.globalState.update(CONSENT_KEY, remember(consent, backend));
    }
    if (!(await this.ensureSignedIn())) return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'TrustCode', cancellable: true },
      async (progress, token) => {
        progress.report({ message: 'submitting…' });
        this.render(progressCard('submitting'));
        const job = await this.api.submit(sel.code, sel.language, task, tests);
        this.jobId = job.id;
        const done = await this.api.waitForResult(job.id, () => token.isCancellationRequested, (s) => {
          progress.report({ message: s === 'running' ? 'running checks (syntax, lint, security, tests)…' : `${s}…` });
          this.render(progressCard(s));
        });
        if (done.status === 'cancelled') {
          this.render('<section class="card"><h3>Verification cancelled</h3><p class="muted">Nothing was recorded.</p><button class="primary" data-action="home">Back</button></section>');
          return;
        }
        if (done.status !== 'done') throw new ApiError(500, 'failed', done.error ?? `verification ${done.status}`);
        this.showDiagnostics(done.result);
        this.lastResult = { jobId: done.id ?? job.id, result: done.result, selection: this.selection };
        await this.showExplanation();
      });
  }

  private lastView?: any;
  private lastResult?: { jobId: string; result: any; selection?: Selection };
  private decisions = new Map<string, DecisionState>();
  statusItem?: vscode.StatusBarItem;

  async showExplanation() {
    if (!this.jobId) return this.showForm();
    const useLlm = vscode.workspace.getConfiguration('trustcode').get('useLlmExplanations', false);
    const q = new URLSearchParams();
    if (this.level) q.set('level', this.level);
    if (useLlm) q.set('llm', 'true');
    this.lastView = await this.api.request('GET', `/verifications/${this.jobId}/explanation?${q}`);
    this.renderResultPage();
  }

  private renderResultPage() {
    const view = this.lastView;
    if (!view || !this.jobId) return;
    const decided = this.decisions.get(this.jobId);
    this.render(`${renderHeadline(view)}${summaryTiles(view)}${renderResult(view)}${renderDecision('decide', decided)}
      ${decided ? '' : '<section class="card"><label class="card-title" for="rationale">Note <span class="badge">optional</span></label><textarea id="rationale" placeholder="Why did you decide this?"></textarea></section>'}
      <button class="primary wide" data-action="verify">Re-verify current selection</button>
      <div class="row"><button data-action="home">Add tests / task and re-verify</button>
      <button data-action="home">Verify something else</button></div>
      <p class="note">Findings are also shown in the editor and the Problems panel (source “TrustCode”).</p>`);
    this.updateStatus(view);
  }

  updateStatus(view?: any) {
    if (!this.statusItem) return;
    if (!view) { this.statusItem.text = '$(checklist) TrustCode'; this.statusItem.tooltip = 'Open TrustCode'; return; }
    const f = (view.findings ?? []).length;
    const u = (view.unverified ?? []).length;
    this.statusItem.text = `$(checklist) ${f} finding${f === 1 ? '' : 's'} · ${u} not verified`;
    this.statusItem.tooltip = 'TrustCode: last verification result — click to open';
  }

  /** Jump to a finding in the editor, using the selection offset of the verification that produced it. */
  async reveal(findingId: unknown) {
    if (typeof findingId !== 'string' || !/^[A-Z]{2,5}-\d{1,4}$/.test(findingId)) return;
    const lr = this.lastResult;
    if (!lr || lr.jobId !== this.jobId || !lr.selection) {
      vscode.window.showInformationMessage('TrustCode: re-verify the code to link findings to lines in the editor.');
      return;
    }
    const f = (lr.result?.checks ?? []).flatMap((c: any) => c.findings ?? []).find((x: any) => x.id === findingId);
    if (!f?.location?.line) return;
    const line = lr.selection.startLine + f.location.line - 1;
    const doc = await vscode.workspace.openTextDocument(lr.selection.uri);
    const ed = await vscode.window.showTextDocument(doc, { preserveFocus: false });
    const range = doc.lineAt(Math.min(line, doc.lineCount - 1)).range;
    ed.selection = new vscode.Selection(range.start, range.end);
    ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  async decide(m: any) {
    const decision = oneOf(m.decision, DECISIONS);
    if (!this.jobId || !decision) return;
    const confidence = confidenceOf(m.confidence);
    await this.api.request('POST', `/verifications/${this.jobId}/decision`,
      { decision, confidence, rationale: textOf(m.rationale, 2000) || undefined });
    this.decisions.set(this.jobId, { decision, confidence });
    vscode.window.setStatusBarMessage(`TrustCode: decision “${decision}” recorded`, 3000);
    this.renderResultPage();
  }

  // ---------------- research study mode ----------------
  async startExperiment() {
    const code = await vscode.window.showInputBox({ prompt: 'Participant code from the researcher (e.g. P-ABCD1234)', ignoreFocusOut: true });
    if (!code) return;
    const consent = await vscode.window.showInformationMessage(
      'Have you read the Participant Information Sheet and do you consent to take part? You may withdraw at any time by closing the study.',
      { modal: true }, 'I consent');
    if (consent !== 'I consent') return;
    const level = await vscode.window.showQuickPick(['beginner', 'intermediate', 'advanced'], { placeHolder: 'Your programming experience level' });
    const years = await vscode.window.showInputBox({ prompt: 'Years of programming experience (whole number)', validateInput: (v) => /^\d{1,2}$/.test(v) ? undefined : 'Enter a whole number' });
    if (!level || years === undefined) return;
    const r = await this.participantApi.request('POST', '/experiments/join',
      { participant_code: code.trim(), consent: true, experience_level: level, years_experience: Number(years) }, { auth: false });
    await this.ctx.secrets.store(PARTICIPANT_KEY(), JSON.stringify({ access: r.access_token }));
    await this.nextTrial();
  }

  async nextTrial() {
    const t = await this.participantApi.request('GET', '/experiments/next');
    if (t.done) {
      this.trialId = undefined;
      return this.render(`<h2>Study complete</h2><p>Thank you. Please complete the final questionnaire with the researcher.</p>
        ${tlxForm()}`);
    }
    this.trialId = t.trial_id;
    const evidence = t.evidence ? `<h3>Verification evidence</h3>${renderResult(t.evidence, { allowFeedback: false, showLevelSwitch: false })}` : '';
    this.render(`<h2>Task ${t.position + 1} of ${t.total}</h2><p class="muted">Condition block: ${t.condition === 'baseline' ? 'AI assistant' : 'AI assistant + TrustCode'}</p>
      <h3>Task</h3><p>${esc(t.task)}</p>
      <h3>AI-generated code (${esc(t.language)})</h3><pre id="pcode">${esc(t.code)}</pre>
      ${t.tests ? `<details><summary>Tests supplied with the code</summary><pre>${esc(t.tests)}</pre></details>` : ''}
      <h3>AI assistant's explanation</h3><p>${esc(t.assistant_explanation)}</p>
      ${evidence}
      ${renderDecision('trial-decide')}<label for="rationale">Briefly, why? (optional)</label><textarea id="rationale"></textarea>`);
  }

  async trialDecide(m: any) {
    const decision = oneOf(m.decision, DECISIONS);
    if (!this.trialId || !decision) return;
    await this.participantApi.request('POST', `/experiments/trials/${this.trialId}/decision`,
      { decision, confidence: confidenceOf(m.confidence) ?? 50, rationale: textOf(m.rationale, 2000) || undefined });
    await this.nextTrial();
  }

  async track(m: any) {
    const type = oneOf(m.type, TRACK_TYPES);
    if (!this.trialId || !type) return;  // interaction events are only collected in study mode
    const finding = textOf(m.finding, 20);
    await this.participantApi.request('POST', '/experiments/events', { trial_id: this.trialId, type, payload: finding ? { finding } : undefined })
      .catch(() => undefined);
  }

  async submitTlx(m: any) {
    const responses = { raw: textOf(m.rationale, 5000) ?? '' };
    await this.participantApi.request('POST', '/experiments/questionnaires', { instrument: 'open', responses });
    this.render('<p>Thank you — your responses were recorded.</p>');
  }
}

function tlxForm(): string {
  return `<label for="rationale">Any comments about the two ways of working? (optional)</label><textarea id="rationale"></textarea>
    <button class="primary" data-action="tlx">Submit</button>`;
}

function secretStore(ctx: vscode.ExtensionContext, key: () => string) {
  return {
    async get(): Promise<Tokens | undefined> { const v = await ctx.secrets.get(key()); return v ? JSON.parse(v) : undefined; },
    async set(t: Tokens | undefined) { if (t) await ctx.secrets.store(key(), JSON.stringify(t)); else await ctx.secrets.delete(key()); },
  };
}

export function activate(ctx: vscode.ExtensionContext) {
  const started = Date.now();
  const cfg = () => vscode.workspace.getConfiguration('trustcode');
  const timeout = () => cfg().get<number>('requestTimeoutSeconds', 30) * 1000;
  const api = new TrustCodeApi(backendUrl, secretStore(ctx, TOKEN_KEY), timeout);
  const participantApi = new TrustCodeApi(backendUrl, secretStore(ctx, PARTICIPANT_KEY), timeout);
  const view = new TrustCodeView(ctx, api, participantApi);
  const wrap = (fn: () => Promise<unknown>) => () => fn().catch((e) => view.error(e));

  // Browser sign-in (authorization code + PKCE): the password is entered on the TrustCode website, never in VS Code.
  const pending = new Map<string, Pending>();
  const browserAuth = {
    opener: (target: vscode.Uri) => vscode.env.openExternal(target) as Thenable<boolean>,
    async begin(mode: 'login' | 'register') {
      const backend = cfg().get<string>('backendUrl')!;
      const p = newPkce();
      const redirect = callbackUri(vscode.env.uriScheme);
      pending.set(p.state, { verifier: p.verifier, redirectUri: redirect, backend, createdAt: Date.now() });
      const url = authorizeUrl(backend, redirect, p, mode);
      const opened = await browserAuth.opener(vscode.Uri.parse(url, true));
      if (!opened) throw new Error('Could not open the browser for sign-in.');
      vscode.window.setStatusBarMessage('TrustCode: complete sign-in in your browser…', 15000);
      view.renderWaitingForBrowser(mode);
      return url;
    },
    async handleUri(uri: vscode.Uri) {
      const r = parseCallback(uri.path, uri.query, pending);
      if (!r.ok) { vscode.window.showErrorMessage(`TrustCode: ${r.reason}`); return; }
      if (r.pending.backend !== cfg().get<string>('backendUrl')) {
        vscode.window.showErrorMessage('TrustCode: the server setting changed during sign-in. Please sign in again.');
        return;
      }
      const t = await api.request('POST', '/auth/extension/token',
        { code: r.code, code_verifier: r.pending.verifier, redirect_uri: r.pending.redirectUri }, { auth: false });
      await ctx.secrets.store(TOKEN_KEY(), JSON.stringify({ access: t.access_token, refresh: t.refresh_token }));
      vscode.window.showInformationMessage('TrustCode: signed in.');
      await view.showForm();
    },
  };

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('trustcode.panel', view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('trustcode.verifySelection', wrap(async () => {
      if (!view.captureSelection()) return;
      await vscode.commands.executeCommand('trustcode.panel.focus');
      view.showForm();
    })),
    vscode.commands.registerCommand('trustcode.signIn', (intent?: unknown) => wrap(async () => {
      await browserAuth.begin(intent === 'create' ? 'register' : 'login');
    })()),
    vscode.window.registerUriHandler({ handleUri: (uri: vscode.Uri) => browserAuth.handleUri(uri).catch((e) => view.error(e)) }),
    vscode.commands.registerCommand('trustcode.signOut', wrap(async () => {
      await ctx.secrets.delete(TOKEN_KEY());
      view.jobId = undefined;
      vscode.window.showInformationMessage('TrustCode: signed out.');
      await view.showForm();
    })),
    vscode.commands.registerCommand('trustcode.setExperienceLevel', wrap(async () => {
      const lvl = await vscode.window.showQuickPick(['beginner', 'intermediate', 'advanced'], { placeHolder: 'How detailed should explanations be?' });
      if (!lvl || !(await view.ensureSignedIn())) return;
      await api.request('PATCH', '/profile', { experience_level: lvl });
      view.level = undefined;
      vscode.window.showInformationMessage(`TrustCode: explanation level set to ${lvl}.`);
    })),
    vscode.commands.registerCommand('trustcode.privacySettings', wrap(async () => {
      if (!(await view.ensureSignedIn())) return;
      const p = await api.request('GET', '/profile');
      const picks = await vscode.window.showQuickPick([
        { label: 'Keep verification history (30 days)', key: 'store_history', picked: p.store_history },
        { label: 'Allow LLM-worded explanations (server sends finding details to its LLM provider)', key: 'allow_llm', picked: p.allow_llm },
        { label: 'Suggest explanation level changes from my feedback', key: 'adaptive_suggestions', picked: p.adaptive_suggestions },
      ], { canPickMany: true, placeHolder: 'Select what you allow (unselected = off)' });
      if (!picks) return;
      const on = new Set(picks.map((x) => x.key));
      await api.request('PATCH', '/profile', { store_history: on.has('store_history'), allow_llm: on.has('allow_llm'), adaptive_suggestions: on.has('adaptive_suggestions') });
      vscode.window.showInformationMessage('TrustCode: privacy settings saved.');
    })),
    vscode.commands.registerCommand('trustcode.startExperiment', wrap(async () => { await vscode.commands.executeCommand('trustcode.panel.focus'); await view.startExperiment(); })),
    view.diagnostics,
    (() => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
      item.command = 'trustcode.panel.focus';
      view.statusItem = item;
      view.updateStatus();
      item.show();
      return item;
    })(),
    vscode.workspace.onDidChangeTextDocument((e) => {
      // line numbers of earlier evidence no longer match edited code: remove stale hints for that document
      if (e.contentChanges.length && view.diagnostics.has(e.document.uri)) view.diagnostics.delete(e.document.uri);
    }),
    vscode.commands.registerCommand('trustcode.clearFindings', () => view.diagnostics.clear()),
    vscode.commands.registerCommand('trustcode.deleteMyData', wrap(async () => {
      const ok = await vscode.window.showWarningMessage(
        'Delete your TrustCode account and all stored verification history, decisions and feedback on this server? This cannot be undone.',
        { modal: true }, 'Delete everything');
      if (ok !== 'Delete everything' || !(await view.ensureSignedIn())) return;
      await api.request('DELETE', '/me/data');
      await ctx.secrets.delete(TOKEN_KEY());
      view.diagnostics.clear();
      vscode.window.showInformationMessage('TrustCode: your account and data were deleted.');
    })),
    vscode.commands.registerCommand('trustcode.forgetConsent', wrap(async () => { await ctx.globalState.update(CONSENT_KEY, { trustedBackends: [] }); vscode.window.showInformationMessage('TrustCode will ask before sending code again.'); })),
  );
  // Test-only hook (never active for users): lets the integration suite drive the real panel object.
  if (process.env.TRUSTCODE_TEST === '1') {
    return { __test: { view, ctx, browserAuth, activationMs: Date.now() - started } };
  }
  return undefined;
}

export function deactivate() { /* disposables are released via ctx.subscriptions */ }
