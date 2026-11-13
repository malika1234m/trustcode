import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ApiError, describeError, Tokens, TrustCodeApi } from './api';
import { consentMessage, ConsentState, isLoopback, languageFor, needsPrompt, normaliseBackend, remember, SupportedLanguage, thirdPartyKind } from './consent';
import { DecisionState, esc, Level, renderCachedNotice, renderComparison, renderDecision, renderHeadline, renderResult } from './render';
import { ageText, cacheKey, compareResults, Comparison, findingIdFromMessage, flatFindings, FlatFinding, hoverMarkdown, LineRange, ResultCache, shiftRange, toLineEdit } from './findings';
import { authorizeUrl, callbackUri, newPkce, parseCallback, Pending } from './auth';
import { shellHtml } from './panel';
import { SessionController } from './session/controller';
import { SecurityController } from './security/controller';
import { securityPage } from './security/model';
import { setShowExplanations } from './render';
import { readRelease, RELEASES_API, tooOldForServer, UpdateInfo } from './updates';
import { createHash } from 'crypto';
import { sessionPage } from './session/render';
import { EngineManager } from './engine/manager';
import { LocalAnalysis, LocalState, RoutedApi } from './engine/local';
import { LicenceManager } from './licence/manager';
import { LICENCE_KEYS } from './licence/keys';
import { buildHash } from './licence/build';
import { noticeDue, type LicenceView } from './licence/state';
import { account, accountDashboard, engineNotice, errorCard, history, page, progress as progressCard, summaryTiles, Tab, TABS, verifyForm, waitingForBrowser, welcome } from './ui';

// Secrets are bound to the backend origin, so tokens are never sent to a different server.
const backendUrl = () => vscode.workspace.getConfiguration('trustcode').get<string>('backendUrl')!;
const TOKEN_KEY = () => `trustcode.tokens:${normaliseBackend(backendUrl())}`;
/** Where Verify and Session run: on this machine (default) or on the TrustCode server. A local backend (mode "local") is a server. */
const localEngine = () => { const c = vscode.workspace.getConfiguration('trustcode'); return c.get<string>('analysis.location', 'local') === 'local' && c.get<string>('mode', 'account') !== 'local'; };
const PARTICIPANT_KEY = () => `trustcode.participantToken:${normaliseBackend(backendUrl())}`;
const CONSENT_KEY = 'trustcode.consent';

interface Selection { code: string; language?: SupportedLanguage; lines: number; uri: vscode.Uri; startLine: number; whole?: boolean }
/** A finding or unverified area pinned to document lines; kept in step with edits (see onDocumentChanged). */
interface Mark { range: LineRange; finding?: FlatFinding; unverified?: { description: string; reason: string } }
const FINDING_ID = /^[A-Z]{2,5}-\d{1,4}$/;

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

  /** Lines with unverified areas (e.g. never executed by the tests): a quiet marker, not a warning. */
  readonly unverifiedDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true, borderWidth: '0 0 0 2px', borderStyle: 'dotted', borderColor: new vscode.ThemeColor('editorInfo.foreground'),
    overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'), overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  private marks: Mark[] = [];
  private marksUri?: vscode.Uri;

  /** Show findings as editor hints at their real line (evidence, not verdicts: never "Error" severity). */
  showDiagnostics(result: any) {
    if (!this.selection) return;
    const sel = this.selection;
    this.marks = [];
    this.marksUri = sel.uri;
    for (const f of flatFindings(result)) {
      if (!f.line) continue;
      this.marks.push({ finding: f, range: { start: sel.startLine + f.line - 1, end: sel.startLine + (f.endLine ?? f.line) - 1 } });
    }
    for (const u of result?.unverified ?? []) {
      if (!u?.location?.line) continue;
      this.marks.push({ unverified: { description: String(u.description ?? ''), reason: String(u.reason ?? '') },
        range: { start: sel.startLine + u.location.line - 1, end: sel.startLine + (u.location.end_line ?? u.location.line) - 1 } });
    }
    this.refreshMarks();
  }

  /** Re-draws diagnostics and decorations from the tracked marks. */
  refreshMarks() {
    const uri = this.marksUri;
    if (!uri) return;
    const diags = this.marks.filter((m) => m.finding).map((m) => {
      const f = m.finding!;
      const d = new vscode.Diagnostic(new vscode.Range(m.range.start, 0, m.range.end, Number.MAX_SAFE_INTEGER),
        `${f.title} (${f.id}) — ${f.message}`, SEV[f.severity] ?? vscode.DiagnosticSeverity.Information);
      d.source = `TrustCode · ${f.tool}`;
      d.code = f.rule;
      return d;
    });
    this.diagnostics.set(uri, diags);
    const unverified = this.marks.filter((m) => m.unverified).map((m) => ({
      range: new vscode.Range(m.range.start, 0, m.range.end, 0),
      hoverMessage: new vscode.MarkdownString().appendText(`TrustCode — not verified: ${m.unverified!.description}. ${m.unverified!.reason}`),
    }));
    for (const ed of vscode.window.visibleTextEditors) {
      if (ed.document.uri.toString() === uri.toString()) ed.setDecorations(this.unverifiedDecoration, unverified);
    }
  }

  clearMarks() {
    this.marks = [];
    this.diagnostics.clear();
    for (const ed of vscode.window.visibleTextEditors) ed.setDecorations(this.unverifiedDecoration, []);
  }

  /**
   * Keeps evidence attached to the right lines while the user edits. Marks above an edit stay, marks below it
   * move with the text, and marks on edited lines are removed: that evidence described the old text.
   */
  onDocumentChanged(e: vscode.TextDocumentChangeEvent) {
    if (!e.contentChanges.length || !this.marksUri || e.document.uri.toString() !== this.marksUri.toString() || !this.marks.length) return;
    const before = this.marks.filter((m) => m.finding).length;
    // All ranges refer to the document before the change, so apply edits bottom-up.
    const edits = [...e.contentChanges].sort((x, y) => y.range.start.line - x.range.start.line)
      .map((c) => toLineEdit(c.range.start.line, c.range.start.character, c.range.end.line, c.text));
    for (const edit of edits) {
      this.marks = this.marks.flatMap((m) => { const r = shiftRange(m.range, edit); return r ? [{ ...m, range: r }] : []; });
    }
    this.refreshMarks();
    const dropped = before - this.marks.filter((m) => m.finding).length;
    if (dropped) vscode.window.setStatusBarMessage(`TrustCode: ${dropped} finding${dropped === 1 ? '' : 's'} on edited lines hidden — re-verify to check the new code`, 5000);
  }

  markAt(uri: vscode.Uri, line: number): Mark | undefined {
    if (!this.marksUri || uri.toString() !== this.marksUri.toString()) return undefined;
    return this.marks.find((m) => m.finding && m.range.start <= line && line <= m.range.end);
  }
  explained(findingId: string): any {
    if (!this.lastResult || this.lastResult.jobId !== this.jobId) return undefined;
    return (this.lastView?.findings ?? []).find((x: any) => x?.finding_id === findingId);
  }

  /** Opens the panel on the current result and scrolls to one finding. */
  async showFinding(findingId: unknown, source?: unknown) {
    if (typeof findingId !== 'string' || !FINDING_ID.test(findingId)) return;
    if (source === 'session') {
      this.session.viewingRun = undefined;
      await this.showSessionTab();
      this.view?.webview.postMessage({ type: 'focus', finding: findingId });
      return;
    }
    await vscode.commands.executeCommand('trustcode.panel.focus');
    if (this.lastResult && this.jobId !== this.lastResult.jobId) { this.jobId = this.lastResult.jobId; this.lastView = undefined; }
    if (!this.jobId) return;
    this.activeTab = 'verify';
    if (this.lastView) this.renderResultPage(); else await this.showExplanation();
    this.view?.webview.postMessage({ type: 'focus', finding: findingId });
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = shellHtml(view.webview);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => this.error(e)));
  }

  activeTab: Tab = 'verify';
  /** The tabs can be used: the local engine is selected, or the user has an account on the server. */
  private signedIn = false;
  /** There is an account on the TrustCode server (needed only for server analysis, the plan and the study). */
  private hasAccount = false;
  engine!: EngineManager;
  local!: LocalAnalysis;
  private engineNote() { return localEngine() ? engineNotice(this.engine.info()) : ''; }
  private sessionHtml() { return this.engineNote() + sessionPage({ ...this.session.model(), local: localEngine() }); }
  session!: SessionController;
  security!: SecurityController;
  securityItem?: vscode.StatusBarItem;
  sessionItem?: vscode.StatusBarItem;
  /** Offline licence: the plan in force on this device, verified locally (src/licence). */
  licence!: LicenceManager;

  private lastProfile?: any;
  update?: UpdateInfo;

  /**
   * The plan and limits as decided by the server. The last verified answer is kept in SecretStorage (per server)
   * for display during a network interruption, for at most 72 hours. It is only ever displayed: nothing on this
   * machine can grant a plan, because every server feature checks the account on the server.
   */
  async loadEntitlements(): Promise<{ data?: any; fetchedAt?: number; offline?: boolean }> {
    const key = `trustcode.entitlements:${normaliseBackend(backendUrl())}`;
    try {
      const data = await this.api.request('GET', '/me/entitlements');
      const fetchedAt = Date.now();
      await this.ctx.secrets.store(key, JSON.stringify({ data, fetchedAt }));
      return { data, fetchedAt };
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 0) { await this.ctx.secrets.delete(key); return {}; }   // a real answer (e.g. signed out) replaces the cache
      try {
        const cached = JSON.parse((await this.ctx.secrets.get(key)) ?? 'null');
        if (cached && typeof cached.fetchedAt === 'number' && Date.now() - cached.fetchedAt < 72 * 3600 * 1000) return { ...cached, offline: true };
      } catch { /* unreadable cache: treated as absent */ }
      return { offline: true };
    }
  }

  /** Reads the public release record. Sends nothing about the user or the project. */
  async checkForUpdates(interactive: boolean): Promise<UpdateInfo> {
    const installed = String(this.ctx.extension.packageJSON.version);
    try {
      const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
      this.update = res.ok ? readRelease(installed, await res.json(), Date.now()) : { installed, available: false, checkedAt: Date.now(), error: `The release list could not be read (HTTP ${res.status}).` };
    } catch {
      this.update = { installed, available: false, checkedAt: Date.now(), error: 'The release list could not be reached.' };
    }
    await this.ctx.globalState.update('trustcode.lastUpdateCheck', Date.now());
    if (this.update.available && (interactive || this.ctx.globalState.get('trustcode.notifiedVersion') !== this.update.latest)) {
      await this.ctx.globalState.update('trustcode.notifiedVersion', this.update.latest);
      void vscode.window.showInformationMessage(`TrustCode ${this.update.latest} is available (installed: ${installed}).`, 'Show details').then((p) => { if (p) void this.showAccountTab(); });
    } else if (interactive && !this.update.error) vscode.window.setStatusBarMessage(`TrustCode ${installed} is the latest version`, 4000);
    if (this.activeTab === 'account') await this.showTab('account');
    return this.update;
  }
  async showAccountTab() { await vscode.commands.executeCommand('trustcode.panel.focus'); await this.showTab('account'); }

  /** Downloads the release package, checks it against the published SHA-256, and installs it through VS Code. */
  async installUpdate(): Promise<void> {
    const u = this.update;
    if (!u?.available || !u.vsixUrl || !u.sha256Url) return void vscode.commands.executeCommand('trustcode.openRelease');
    if (this.security.scanning || this.session.busy) { vscode.window.showInformationMessage('TrustCode: a scan is running. Install the update when it has finished.'); return; }
    const ok = await vscode.window.showWarningMessage(`Download TrustCode ${u.latest} from the project's GitHub release, verify its checksum and install it?`, { modal: true }, 'Install');
    if (ok !== 'Install') return;
    try {
      const [pkg, sum] = await Promise.all([fetch(u.vsixUrl, { signal: AbortSignal.timeout(120000) }), fetch(u.sha256Url, { signal: AbortSignal.timeout(30000) })]);
      if (!pkg.ok || !sum.ok) throw new Error(`download failed (HTTP ${pkg.status}/${sum.status})`);
      const data = Buffer.from(await pkg.arrayBuffer());
      const expected = (await sum.text()).trim().split(/\s+/)[0].toLowerCase();
      const actual = createHash('sha256').update(data).digest('hex');
      if (!/^[a-f0-9]{64}$/.test(expected) || expected !== actual) throw new Error('the package does not match its published checksum, so it was NOT installed');
      await vscode.workspace.fs.createDirectory(this.ctx.globalStorageUri);
      const file = vscode.Uri.joinPath(this.ctx.globalStorageUri, `trustcode-${u.latest}.vsix`);
      await vscode.workspace.fs.writeFile(file, data);
      await vscode.commands.executeCommand('workbench.extensions.installExtension', file);
      await vscode.workspace.fs.delete(file).then(undefined, () => undefined);
      const reload = await vscode.window.showInformationMessage(`TrustCode ${u.latest} was installed. Reload the window to start using it.`, 'Reload window');
      if (reload) await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } catch (e) {
      vscode.window.showErrorMessage(`TrustCode: the update was not installed — ${String((e as Error)?.message ?? e)}. The installed version is unchanged.`, 'Open release page')
        .then((p) => { if (p) void vscode.commands.executeCommand('trustcode.openRelease'); });
    }
  }

  /** Scanning is local; like every feature it needs a confirmed account (see the licence gate). */
  refreshSecurity() {
    if (this.activeTab === 'security') this.view?.webview.postMessage({ type: 'render', keepScroll: true, html: page('security', this.signedIn, this.who(), securityPage(this.security.model())) });
  }
  async showSecurityTab() {
    await vscode.commands.executeCommand('trustcode.panel.focus');
    await this.showTab('security');
  }
  private refreshTimer?: NodeJS.Timeout;

  /** Called by the session controller whenever its state changes: live-updates the dashboard and status bar. */
  refreshSession() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      const text = this.session.statusText();
      if (this.sessionItem) { if (text) { this.sessionItem.text = text; this.sessionItem.show(); } else this.sessionItem.hide(); }
      if (this.activeTab === 'session' && this.signedIn) this.view?.webview.postMessage({ type: 'render', keepScroll: true, html: page('session', this.signedIn, this.who(), this.sessionHtml()) });
    }, 120);
  }
  async showSessionTab() {
    await vscode.commands.executeCommand('trustcode.panel.focus');
    await this.showTab('session');
  }
  /** Consent for sending a set of files. Non-interactive callers (automatic triggers) never get a dialog. */
  async consentFor(message: string, interactive: boolean): Promise<boolean> {
    const backend = backendUrl();
    const consent = this.ctx.globalState.get<ConsentState>(CONSENT_KEY, { trustedBackends: [] });
    if (!needsPrompt(consent, backend)) return true;
    if (!interactive) return false;
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, 'Send', 'Send and don\'t ask again for this server');
    if (!choice) return false;
    if (choice !== 'Send') await this.ctx.globalState.update(CONSENT_KEY, remember(consent, backend));
    return true;
  }

  private mode() { return vscode.workspace.getConfiguration('trustcode').get<string>('mode', 'account'); }
  private who() {
    if (this.mode() === 'local') return 'Local mode';
    if (localEngine()) return 'On this device';
    try { return this.signedIn ? new URL(backendUrl()).hostname : 'Signed out'; } catch { return 'Signed out'; }
  }
  async refreshAuth() {
    this.hasAccount = this.mode() === 'local' || !!(await this.ctx.secrets.get(TOKEN_KEY()));
    this.signedIn = !!this.licence?.usable();   // every feature needs a registered account confirmed on this device
    return this.signedIn;
  }
  /** Why the welcome screen is showing, when it is not simply a first start. */
  welcomeReason(): string | undefined {
    const v = this.licence?.view;
    return v && v.status !== 'sign_in_required' ? v.message : undefined;
  }
  /** Shown when a feature is used before an account is confirmed on this device. */
  async showAccountRequired() {
    await vscode.commands.executeCommand('trustcode.panel.focus');
    await this.showForm();
  }
  /** Posts a full page (header + tabs + body). The body is produced by escaping renderers only. */
  render(html: string) { this.view?.webview.postMessage({ type: 'render', html: page(this.activeTab, this.signedIn, this.who(), html) }); }
  private renderRaw(html: string) { this.view?.webview.postMessage({ type: 'render', html }); }
  renderWaitingForBrowser(mode: 'login' | 'register') { this.renderRaw(waitingForBrowser(mode)); }

  async showForm() {
    await this.refreshAuth();
    if (!this.signedIn) return this.renderRaw(welcome(backendUrl(), this.welcomeReason()));
    this.activeTab = 'verify';
    const sel = this.selection && { lines: this.selection.lines, language: this.selection.language, file: path.basename(this.selection.uri.path), whole: this.selection.whole };
    this.render(this.engineNote() + verifyForm(sel, this.lastTask, localEngine()));
  }
  async showTab(tab: Tab) {
    await this.refreshAuth();
    if (!this.signedIn && tab !== 'account') return this.renderRaw(welcome(backendUrl(), this.welcomeReason()));
    if (tab === 'security') { this.activeTab = tab; return this.render(securityPage(this.security.model())); }
    this.activeTab = tab;
    if (tab === 'verify') return this.jobId ? this.showExplanation() : this.showForm();
    if (tab === 'session') return this.render(this.sessionHtml());
    if (tab === 'history') {
      this.render('<p class="muted">Loading history…</p>');
      const pageData = await this.api.request('GET', '/verifications?limit=25');
      return this.render(history(pageData.items ?? [], localEngine()));
    }
    const profile = this.signedIn ? await this.api.request('GET', '/profile').catch(() => undefined) : undefined;
    this.lastProfile = profile;
    const ent = this.hasAccount ? await this.loadEntitlements() : {};
    const me = this.hasAccount && !ent.offline ? await this.api.request('GET', '/me').catch(() => undefined) : undefined;
    const health = this.hasAccount ? await this.api.request('GET', '/health', undefined, { auth: false }).catch(() => undefined) : undefined;
    const cfg = vscode.workspace.getConfiguration('trustcode');
    const up: UpdateInfo = this.update ?? { installed: String(this.ctx.extension.packageJSON.version), available: false };
    this.render(account({ backend: backendUrl(), mode: this.mode(), signedIn: this.hasAccount, profile, local: localEngine() }) + accountDashboard({
      entitlements: ent.data, verifiedAt: ent.fetchedAt, offline: ent.offline, email: me?.email ?? undefined, licence: this.hasAccount ? this.licence?.view : undefined,
      update: { ...up, canInstall: !!(up.vsixUrl && up.sha256Url), tooOld: tooOldForServer(up.installed, health?.min_extension_version) },
      privacy: { engine: localEngine() ? this.engine.info() : undefined, localHistory: this.local.counts(), registryLookups: cfg.get('engine.registryLookups', false),
        scanner: this.security.model().availability, signedIn: this.hasAccount, backend: backendUrl(), localBackend: isLoopback(backendUrl()),
        llmSetting: cfg.get('useLlmExplanations', false), llmAllowedInProfile: !!profile?.allow_llm, llmAvailableOnServer: !!profile?.llm_available,
        onlineAdvisories: cfg.get('scanner.onlineAdvisories', false), updateCheck: cfg.get('updates.check', true),
        entitlementVerifiedAt: ent.fetchedAt, entitlementOffline: ent.offline } }));
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

  /** Captures the whole active (or only visible) document. Read-only. */
  captureFile(): boolean {
    const ed = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0];
    if (!ed) {
      vscode.window.showInformationMessage('TrustCode: open the file you want to verify first.');
      return false;
    }
    const code = ed.document.getText();
    if (!code.trim()) {
      vscode.window.showInformationMessage('TrustCode: this file is empty — there is nothing to verify.');
      return false;
    }
    this.selection = { code, language: languageFor(ed.document.languageId), lines: ed.document.lineCount, uri: ed.document.uri, startLine: 0, whole: true };
    return true;
  }

  /** Webview messages are untrusted input: every field is validated against an allow-list before use. */
  async onMessage(m: any) {
    if (!m || typeof m !== 'object') return;
    if (!OPEN_ACTIONS.has(m.action) && !this.licence?.usable()) return this.showForm();   // account required
    switch (m.action) {
      case 'ready': return this.showForm();
      case 'home': this.jobId = undefined; this.comparison = undefined; this.cachedAge = undefined; return this.showForm();
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
      case 'verifyFile': this.lastTask = textOf(m.task, 10_000) ?? ''; this.lastTests = textOf(m.tests, MAX_CODE_CHARS);
        return this.verify(this.lastTask, this.lastTests, { file: true });
      case 'rerun': return this.verify(this.lastTask, this.lastTests, { force: true, keepSelection: true });
      case 'changeDecision': if (this.jobId) { this.decisions.delete(this.jobId); this.renderResultPage(); } return;
      case 'openSettings': return void vscode.commands.executeCommand('workbench.action.openSettings', 'trustcode');
      case 'openJob': {
        if (typeof m.job !== 'string' || !/^[a-f0-9]{32}$/.test(m.job)) return;
        this.jobId = m.job; this.activeTab = 'verify'; this.comparison = undefined; this.cachedAge = undefined;
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
      case 'verify': this.lastTask = textOf(m.task, 10_000) ?? ''; this.lastTests = textOf(m.tests, MAX_CODE_CHARS);
        return this.verify(this.lastTask, this.lastTests);
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
      case 'engineSetup': await this.engine.ensure(true); return this.showTab(this.activeTab);
      case 'engineLog': return void this.engine.log.show();
      case 'engineUseServer':
        await vscode.workspace.getConfiguration('trustcode').update('analysis.location', 'server', vscode.ConfigurationTarget.Global);
        return this.showTab(this.activeTab);
      case 'engineUseLocal':
        await vscode.workspace.getConfiguration('trustcode').update('analysis.location', 'local', vscode.ConfigurationTarget.Global);
        return this.showTab(this.activeTab);
      case 'checkUpdates': return void (await this.checkForUpdates(true));
      case 'licenceSync': await this.licence.sync(true); return this.showTab('account');
      case 'manageDevices': return void vscode.env.openExternal(vscode.Uri.parse(`${SITE_URL}/dashboard/settings#devices`));
      case 'installUpdate': return this.installUpdate();
      case 'openRelease': return void vscode.commands.executeCommand('trustcode.openRelease');
      case 'trustCenter': return void vscode.commands.executeCommand('trustcode.openTrustCenter');
      // ---- security scanner (local)
      case 'secScan': { const mode = oneOf(m.key, ['full', 'changed', 'new', 'staged', 'push', 'production'] as const); return mode ? void (await this.security.scan(mode)) : undefined; }
      case 'secConfig': return this.security.editConfig();
      case 'secDisableRule': return typeof m.key === 'string' ? this.security.toggleRule(m.key, true) : undefined;
      case 'secEnableRule': return typeof m.key === 'string' ? this.security.toggleRule(m.key, false) : undefined;
      case 'secRescan': return void (await this.security.rescan());
      case 'secCancel': return this.security.cancel();
      case 'secCheck': return void (await this.security.scan('full'));
      case 'secOpen': return typeof m.finding === 'string' && /^[a-f0-9]{8,64}$/.test(m.finding) ? this.security.open(m.finding) : undefined;
      case 'secReview': return typeof m.finding === 'string' && /^[a-f0-9]{8,64}$/.test(m.finding) ? this.security.review(m.finding) : undefined;
      case 'secNext': return this.security.step(1);
      case 'secPrev': return this.security.step(-1);
      case 'secGroup': { const g = oneOf(m.key, ['severity', 'file', 'category'] as const); if (g) { this.security.groupBy = g; this.refreshSecurity(); } return; }
      case 'secBaseline': return this.security.baseline();
      case 'secHooks': return this.security.installHooks();
      case 'secCi': return void vscode.commands.executeCommand('trustcode.showCiExample');
      case 'secSettings': return void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:trustcode-research.trustcode scanner');
      // ---- session dashboard
      case 'sessionStart': return void (await this.session.start());
      case 'sessionPause': return this.session.pause();
      case 'sessionResume': return this.session.resume();
      case 'sessionEnd': return this.session.end(false);
      case 'sessionEndVerify': return this.session.end(true);
      case 'sessionRescan': return void (await this.session.rescan(true));
      case 'sessionVerify': return this.session.verify('session', 'manual', true);
      case 'sessionVerifyPending': return this.session.verify('pending', 'manual', true);
      case 'sessionVerifySelected': {
        const picked = Array.isArray(m.paths) ? m.paths.filter((p: unknown): p is string => typeof p === 'string' && p.length <= 500).slice(0, 500) : [];
        return this.session.verify('selected', 'manual', true, picked);
      }
      case 'rerunFailed': return this.session.verify('failed', 'manual', true);
      case 'verifyGit': return this.session.verify('git', 'manual', true);
      case 'verifyWorkspace': return void vscode.commands.executeCommand('trustcode.verifyWorkspace');
      case 'verifyPick': return void vscode.commands.executeCommand('trustcode.verifyFiles');
      case 'openDiff': return typeof m.path === 'string' && m.path.length <= 500 ? this.session.openDiff(m.path) : undefined;
      case 'openFinding': return typeof m.finding === 'string' && FINDING_ID.test(m.finding) ? this.session.openFinding(m.finding) : undefined;
      case 'sessionFeedback': {
        const rating = oneOf(m.rating, ['helpful', 'incorrect'] as const);
        if (!rating || typeof m.finding !== 'string' || !FINDING_ID.test(m.finding)) return;
        await this.session.feedback(m.finding, rating);
        return void vscode.window.setStatusBarMessage('TrustCode: thanks for the feedback', 2500);
      }
      case 'copyFixPrompt': return void vscode.commands.executeCommand('trustcode.copyFixPrompt');
      case 'openFixPrompt': return void vscode.commands.executeCommand('trustcode.copyFixPrompt', 'open');
      case 'openRun': {
        if (m.run !== 'latest' && (typeof m.run !== 'string' || !/^[a-f0-9]{12}$/.test(m.run))) return;
        this.session.viewingRun = m.run === 'latest' ? undefined : m.run;
        return this.render(this.sessionHtml());
      }
      case 'setSetting': {
        const cfg = vscode.workspace.getConfiguration('trustcode');
        const bools = ['scanner.automatic', 'autoVerify.onAgentFinished', 'autoVerify.onInactivity', 'autoVerify.onSessionEnd', 'autoVerify.onSave', 'autoVerify.onBatch',
          'verification.sendBaseline', 'verification.includeRelatedFiles'] as const;
        const key = oneOf(m.key, [...bools, 'verification.depth', 'verification.defaultScope'] as const);
        if (!key) return;
        let value: unknown;
        if (key === 'verification.depth') value = oneOf(m.value, ['quick', 'standard', 'deep'] as const);
        else if (key === 'verification.defaultScope') value = oneOf(m.value, ['selection', 'file', 'session', 'git', 'workspace', 'custom'] as const);
        else value = typeof m.value === 'boolean' ? m.value : undefined;
        if (value === undefined) return;
        await cfg.update(key, value, vscode.ConfigurationTarget.Global);
        this.refreshSecurity();
        return this.refreshSession();
      }
      case 'openSessionSettings': return void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:trustcode-research.trustcode session verification autoVerify');
      case 'hookSetup': return void vscode.commands.executeCommand('trustcode.agentHookSetup');
      case 'trial-decide': return this.trialDecide(m);
      case 'track': return this.track(m);
      case 'tlx': return this.submitTlx(m);
      default: return;  // unknown actions are ignored
    }
  }

  /** True when the selected analysis can be used (the licence gate applies before this). */
  async ensureSignedIn(): Promise<boolean> {
    if (localEngine()) return true;
    return this.ensureAccount();
  }
  async ensureAccount(): Promise<boolean> {
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
  private lastTests?: string;
  private comparison?: Comparison;
  private cachedAge?: string;
  /** Finished results for identical input (same server, language, code, task, tests): avoids sending code twice. */
  readonly cache = new ResultCache<{ jobId: string; result: any }>();
  /** Last result per document, for "what changed since the last verification". */
  private previousByDoc = new Map<string, any>();

  async verify(task?: string, tests?: string, opts: { force?: boolean; file?: boolean; keepSelection?: boolean } = {}) {
    if (this.busy) {
      vscode.window.setStatusBarMessage('TrustCode: a verification is already running', 3000);
      return;
    }
    this.busy = true;
    try {
      await this.verifyOnce(task, tests, opts);
    } finally {
      this.busy = false;
      if (this.statusItem?.text.includes('sync~spin')) this.updateStatus(this.jobId ? this.lastView : undefined);
    }
  }

  private async verifyOnce(task: string | undefined, tests: string | undefined, opts: { force?: boolean; file?: boolean; keepSelection?: boolean }) {
    if (opts.file) {
      if (!this.captureFile()) return;
    } else if (!(opts.keepSelection && this.selection?.whole)) {
      // Prefer the editor's current selection so a stale capture is never sent by mistake.
      const ed = vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors.find((e) => !e.selection.isEmpty);
      if (ed && !ed.selection.isEmpty) {
        // Always refresh: identical text in another file or position must map findings to the right document/lines.
        const current = ed.document.getText(ed.selection);
        this.selection = { code: current, language: languageFor(ed.document.languageId), lines: current.split('\n').length,
          uri: ed.document.uri, startLine: ed.selection.start.line };
      }
    } else {
      // Re-running a whole-file verification: read the file again so edits since the last run are included.
      const doc = await vscode.workspace.openTextDocument(this.selection.uri);
      this.selection = { ...this.selection, code: doc.getText(), lines: doc.lineCount };
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
      const what = this.selection.whole ? 'This file is' : 'The selection or tests are';
      vscode.window.showWarningMessage(`TrustCode: ${what} larger than ${MAX_CODE_CHARS.toLocaleString()} characters. Select a smaller part. Nothing was sent.`);
      return;
    }
    const sel = this.selection!;
    const cfg = vscode.workspace.getConfiguration('trustcode');
    const backend = cfg.get<string>('backendUrl')!;
    const local = localEngine();
    const key = cacheKey([local ? 'local-engine' : normaliseBackend(backend), sel.language, sel.code, task, tests]);
    const docKey = sel.uri.toString();
    const cached = opts.force ? undefined : this.cache.get(key);
    if (cached && await this.refreshAuth()) {
      // Identical input was verified moments ago: show that result. No code leaves the machine, so no consent prompt.
      try {
        this.jobId = cached.value.jobId;
        this.lastResult = { jobId: cached.value.jobId, result: cached.value.result, selection: sel };
        this.cachedAge = ageText(cached.ageMs);
        this.comparison = undefined;
        this.showDiagnostics(cached.value.result);
        await this.showExplanation();
        return;
      } catch {
        this.cache.delete(key);  // e.g. the result expired on the server: fall through to a real run
        this.cachedAge = undefined;
      }
    }
    this.clearMarks();
    const consent = this.ctx.globalState.get<ConsentState>(CONSENT_KEY, { trustedBackends: [] });
    // Local analysis: the code stays on this machine, so there is nothing to consent to. It needs the engine instead.
    if (local) {
      if (!(await this.engine.ensure(true))) return this.showForm();
    } else if (needsPrompt(consent, backend)) {
      const choice = await vscode.window.showWarningMessage(
        consentMessage(sel.lines, sel.code.length, backend, !!tests, cfg.get('useLlmExplanations', false)),
        { modal: true }, 'Send', 'Send and don\'t ask again for this server');
      if (!choice) return;
      if (choice !== 'Send') await this.ctx.globalState.update(CONSENT_KEY, remember(consent, backend));
    }
    if (!(await this.ensureSignedIn())) return;
    if (this.statusItem) { this.statusItem.text = '$(sync~spin) TrustCode: verifying…'; this.statusItem.tooltip = 'TrustCode: verification running'; }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'TrustCode', cancellable: true },
      async (progress, token) => {
        progress.report({ message: local ? 'running checks on this computer…' : 'submitting…' });
        this.render(progressCard(local ? 'running' : 'submitting'));
        const job = await this.api.submit(sel.code, sel.language, task, tests);
        this.jobId = job.id;
        this.lastView = undefined;
        const done = await this.api.waitForResult(job.id, () => token.isCancellationRequested, (s) => {
          progress.report({ message: s === 'running' ? 'running checks…' : `${s}…` });
          this.render(progressCard(s));
        });
        if (done.status === 'cancelled') {
          this.jobId = undefined;
          this.render('<section class="card"><h3>Verification cancelled</h3><p class="muted">Nothing was recorded.</p><button class="primary" data-action="home">Back</button></section>');
          return;
        }
        if (done.status !== 'done') throw new ApiError(500, 'failed', done.error ?? `verification ${done.status}`);
        const jobId = done.id ?? job.id;
        this.cachedAge = undefined;
        const previous = this.previousByDoc.get(docKey);
        this.comparison = previous ? compareResults(previous, done.result) : undefined;
        this.previousByDoc.set(docKey, done.result);
        if (this.previousByDoc.size > 30) this.previousByDoc.delete(this.previousByDoc.keys().next().value as string);
        this.cache.set(key, { jobId, result: done.result });
        this.showDiagnostics(done.result);
        this.lastResult = { jobId, result: done.result, selection: this.selection };
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
    if (useLlm && !localEngine()) q.set('llm', 'true');
    this.lastView = await this.api.request('GET', `/verifications/${this.jobId}/explanation?${q}`);
    this.renderResultPage();
  }

  private renderResultPage() {
    const view = this.lastView;
    if (!view || !this.jobId) return;
    const decided = this.decisions.get(this.jobId);
    const current = this.lastResult?.jobId === this.jobId;
    this.render(`${current ? renderCachedNotice(this.cachedAge) : ''}${renderHeadline(view)}${summaryTiles(view)}${current ? renderComparison(this.comparison) : ''}${renderResult(view)}${renderDecision('decide', decided)}
      ${decided ? '' : '<section class="card"><label class="card-title" for="rationale">Note <span class="badge">optional</span></label><textarea id="rationale" placeholder="Why did you decide this?"></textarea></section>'}
      <button class="primary wide" data-action="rerun">Run the checks again</button>
      <div class="row"><button data-action="home">Add tests / task, or verify something else</button></div>
      <p class="note">Findings are also shown in the editor and the Problems panel (source “TrustCode”).</p>`);
    this.updateStatus(view);
  }

  updateStatus(view?: any) {
    if (!this.statusItem) return;
    if (!view) { this.statusItem.text = '$(checklist) TrustCode'; this.statusItem.tooltip = 'Open TrustCode'; return; }
    const f = (view.findings ?? []).length;
    const u = (view.unverified ?? []).length;
    const failed = (view.checks ?? []).filter((c: any) => c.status === 'check_failed').length;
    this.statusItem.text = `$(checklist) ${f} finding${f === 1 ? '' : 's'} · ${u} not verified${failed ? ` · ${failed} check${failed === 1 ? '' : 's'} failed` : ''}`;
    this.statusItem.tooltip = 'TrustCode: last verification result — click to open. Counts describe evidence, not correctness.';
  }

  /** Jump to a finding in the editor, using the selection offset of the verification that produced it. */
  async reveal(findingId: unknown) {
    if (typeof findingId !== 'string' || !/^[A-Z]{2,5}-\d{1,4}$/.test(findingId)) return;
    const lr = this.lastResult;
    if (!lr || lr.jobId !== this.jobId || !lr.selection) {
      vscode.window.showInformationMessage('TrustCode: re-verify the code to link findings to lines in the editor.');
      return;
    }
    const mark = this.marks.find((m) => m.finding?.id === findingId);
    if (!mark || !this.marksUri) {
      vscode.window.showInformationMessage('TrustCode: this line was edited after the verification — run the checks again to locate the finding.');
      return;
    }
    const doc = await vscode.workspace.openTextDocument(this.marksUri);
    const ed = await vscode.window.showTextDocument(doc, { preserveFocus: false });
    const first = Math.min(mark.range.start, doc.lineCount - 1), last = Math.min(mark.range.end, doc.lineCount - 1);
    const range = new vscode.Range(doc.lineAt(first).range.start, doc.lineAt(last).range.end);
    ed.selection = new vscode.Selection(range.start, range.end);
    ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    this.refreshMarks();
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

const SITE_URL = 'https://trustcode-app.vercel.app';
/** Panel actions and commands that work without a confirmed account (signing in, account, privacy and updates). */
const OPEN_ACTIONS = new Set(['ready', 'home', 'refresh', 'tab', 'signIn', 'createAccount', 'signOut', 'checkUpdates', 'installUpdate', 'openRelease',
  'trustCenter', 'licenceSync', 'manageDevices', 'openSettings', 'deleteData']);
const OPEN_COMMANDS = new Set(['trustcode.signIn', 'trustcode.signOut', 'trustcode.showAccount', 'trustcode.checkLicence', 'trustcode.openRelease',
  'trustcode.openTrustCenter', 'trustcode.checkForUpdates', 'trustcode.deleteMyData', 'trustcode.forgetConsent', 'trustcode.clearFindings',
  'trustcode.engineStatus', 'trustcode.removeEngine']);
const LICENCE_NOTICE_KEY = 'trustcode.licenceNotice';

export function activate(ctx: vscode.ExtensionContext) {
  const started = Date.now();
  const cfg = () => vscode.workspace.getConfiguration('trustcode');
  const timeout = () => cfg().get<number>('requestTimeoutSeconds', 30) * 1000;
  // ---- local engine: Verify and Session run on this machine unless the user selects the server
  const engineLog = vscode.window.createOutputChannel('TrustCode Engine');
  const engine = new EngineManager(ctx, engineLog);
  const stateFile = path.join(ctx.globalStorageUri.fsPath, 'local-analysis.json');
  const localAnalysis = new LocalAnalysis(engine, {
    load: () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')) as LocalState; } catch { return undefined; } },
    save: (st) => {
      try {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile + '.tmp', JSON.stringify(st), { mode: 0o600 });
        fs.renameSync(stateFile + '.tmp', stateFile);
      } catch (e) { engineLog.appendLine(`Local history could not be saved: ${String((e as Error)?.message ?? e)}`); }
    },
  }, () => ({ profile: 'extended', registry: cfg().get<boolean>('engine.registryLookups', false), runTests: cfg().get<boolean>('engine.runTests', true) }));
  const api = new RoutedApi(backendUrl, secretStore(ctx, TOKEN_KEY), timeout, localAnalysis, localEngine);
  const participantApi = new TrustCodeApi(backendUrl, secretStore(ctx, PARTICIPANT_KEY), timeout);
  const view = new TrustCodeView(ctx, api, participantApi);
  view.engine = engine;
  view.local = localAnalysis;
  // ---- offline licence: verified on this device at startup (no network), refreshed in the background when due
  const licenceLog = vscode.window.createOutputChannel('TrustCode Licence');
  const licenceItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  licenceItem.command = { title: 'Account', command: 'trustcode.showAccount' };
  // Integrity signal: this build's version and a hash of its compiled code, sent with licence requests. Computed in
  // the background; until it is ready the version alone is sent.
  const client: { v?: string; build?: string } = { v: String(ctx.extension.packageJSON?.version ?? '') || undefined };
  void buildHash(path.join(ctx.extensionPath, 'out', 'src')).then((h) => { client.build = h; });
  const licence = new LicenceManager({
    client: () => client,
    secrets: ctx.secrets, fetch: (globalThis as any).fetch, backend: backendUrl, keys: LICENCE_KEYS,
    authed: (method, p, body) => api.request(method, p, body),
    log: (msg) => licenceLog.appendLine(`[${new Date().toISOString()}] ${msg}`),
    deviceName: `${vscode.env.appName} on ${os.hostname().slice(0, 40)}`, platform: `${process.platform}-${process.arch}`,
    onChange: (v) => licenceChanged(v),
  });
  view.licence = licence;
  // The licence follows traffic the extension already makes: the server returns the account's revocation version
  // with every signed-in response, and server analysis carries a proof that it comes from this activated device.
  api.hooks = {
    onLicenceRev: (rev) => licence.noteRev(rev),
    onUnauthorized: () => licence.noteUnauthorized(),
    headers: async (method, p): Promise<Record<string, string>> => {
      if (method !== 'POST' || (p !== '/verifications' && p !== '/session-verifications')) return {};
      const proof = await licence.proof();
      return proof ? { 'X-TrustCode-Device': proof } : {};
    },
  };
  // Only states that need the user's attention show anything, and each one is announced at most once a day.
  let wasUsable = false;
  function licenceChanged(v: LicenceView) {
    if (v.usable !== wasUsable) {
      wasUsable = v.usable;
      // account confirmed: start the usual startup scan; account lost: the panel switches to the sign-in screen
      if (v.usable && process.env.TRUSTCODE_TEST !== '1') setTimeout(() => { try { view.security.startup(); } catch { /* not ready */ } }, 0);
      try { view.session?.setLicensed(v.usable); } catch { /* not ready */ }   // a restored session is watched only with an account
      void view.showTab(view.activeTab).catch(() => undefined);
    }
    const attention = v.status === 'expiring_soon' || v.status === 'connection_required' || v.status === 'subscription_expired' || v.status === 'revoked';
    if (v.status === 'sign_in_required') {   // first start or signed out: a quiet pointer, no pop-up
      licenceItem.text = '$(account) TrustCode: sign in';
      licenceItem.tooltip = v.message;
      licenceItem.command = { title: 'Sign in', command: 'trustcode.panel.focus' };
      licenceItem.show();
      return;
    }
    licenceItem.command = { title: 'Account', command: 'trustcode.showAccount' };
    if (!attention) { licenceItem.hide(); return; }
    licenceItem.text = v.status === 'expiring_soon' ? '$(clock) TrustCode' : v.usable ? '$(info) TrustCode plan' : '$(warning) TrustCode paused';
    licenceItem.tooltip = v.message;
    licenceItem.show();
    const notice = noticeDue(ctx.globalState.get(LICENCE_NOTICE_KEY), v.status, Date.now());   // one per state per day
    if (!notice.notify) return;
    void ctx.globalState.update(LICENCE_NOTICE_KEY, notice.seen);
    if (process.env.TRUSTCODE_TEST !== '1') void vscode.window.showWarningMessage(`TrustCode: ${v.message}`);
  }
  ctx.subscriptions.push(licenceLog, licenceItem, { dispose: () => licence.dispose() },
    vscode.window.onDidChangeWindowState((w) => { if (w.focused) licence.nudge(); }));
  void licence.load().then(async () => {
    // signed in before licences existed (or activation failed offline): activate now, without asking again
    if (licence.view.status === 'sign_in_required' && (await ctx.secrets.get(TOKEN_KEY()))) {
      await licence.activate().catch((e) => licenceLog.appendLine(`Activation: ${describeError(e)}`));
    }
    licence.startTimers();
  }).catch((e) => licenceLog.appendLine(`Licence could not be loaded: ${String(e?.message ?? e)}`));
  ctx.subscriptions.push(engineLog, engine.onDidChange(() => { void view.showTab(view.activeTab).catch(() => undefined); }));
  const applyDisplay = () => setShowExplanations(cfg().get<boolean>('showExplanations', false));
  applyDisplay();
  const security = new SecurityController(() => view.refreshSecurity(), (text, tooltip) => {
    const item = view.securityItem;
    if (!item) return;
    if (text) { item.text = text; item.tooltip = tooltip; item.show(); } else item.hide();
  }, () => engine.scanner());
  view.security = security;
  // once the engine is installed its scanner exists too: the Security tab stops saying "scanner not found"
  ctx.subscriptions.push(engine.onDidChange(() => { if (engine.scanner() && security.model().availability === 'missing') void security.scan('full', { quiet: true }).catch(() => undefined); }));
  security.gate = () => licence.usable();
  if (process.env.TRUSTCODE_TEST !== '1' && cfg().get<boolean>('updates.check', true)
      && Date.now() - ctx.globalState.get<number>('trustcode.lastUpdateCheck', 0) > 24 * 3600 * 1000) {
    setTimeout(() => void view.checkForUpdates(false).catch(() => undefined), 20000);   // once a day at most, never on every start
  }
  const CI_EXAMPLE = `# .github/workflows/trustcode-scan.yml
# Runs the TrustCode security scan on every push and pull request. A local hook can be skipped with
# --no-verify, so this is the check that cannot be bypassed from a developer machine.
name: TrustCode security scan
on: [push, pull_request]
permissions:
  contents: read
  security-events: write   # upload findings to GitHub code scanning
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - name: Install the scanner
        run: pip install "trustcode-worker[tools] @ git+https://github.com/malika1234m/trustcode.git#subdirectory=verification-worker"
      - name: Scan (fails the job when the policy blocks or the scan is incomplete)
        run: trustcode-scan --mode ci --format sarif --output trustcode.sarif
      - name: Upload findings
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: trustcode.sarif, category: trustcode }
`;
  const sessionHost = {
    /** An AI coding session reached a review point: scan exactly the files it changed, locally. */
    onChangesReady: (paths: string[]) => { if (cfg().get<boolean>('scanner.scanSessionChanges', true) && paths.length) void security.scan('changed', { paths, quiet: true }).catch(() => undefined); },
    api,
    ensureSignedIn: () => view.ensureSignedIn(),
    local: localEngine,
    ensureEngine: (interactive: boolean) => engine.ensure(interactive),
    consent: (message: string, interactive: boolean) => view.consentFor(message, interactive),
    backendLabel: () => (isLoopback(backendUrl()) ? `your local TrustCode backend (${backendUrl()})` : `the remote TrustCode server ${backendUrl()}`),
    refresh: () => view.refreshSession(),
    showSessionTab: () => view.showSessionTab(),
    focusFinding: (id: string) => void view.showFinding(id, 'session'),
    onError: (e: unknown) => view.error(e),
  };
  const session = new SessionController(ctx, sessionHost);
  view.session = session;
  session.gate = () => licence.usable();
  // TrustCode is free, but every feature needs a registered account confirmed on this device (src/licence).
  const reg = (id: string, fn: (...a: any[]) => any) => vscode.commands.registerCommand(id, OPEN_COMMANDS.has(id) ? fn
    : async (...a: any[]) => { if (licence.usable()) return fn(...a); await view.showAccountRequired(); });
  const sessionCmd = (id: string, fn: (...a: any[]) => Promise<unknown>) =>
    reg(id, (...a: any[]) => fn(...a).catch((e) => view.error(e)));
  const relOf = (u: unknown) => (u instanceof vscode.Uri ? session.toRel(u) : undefined);
  const HOOK_DOC = `# TrustCode: tell TrustCode when your coding agent has finished

TrustCode cannot see inside a coding agent. Without a signal it can only *estimate* that the agent has
finished, from the fact that files stopped changing. If your agent can run a command when it finishes, it can
tell TrustCode directly by writing a small file in the workspace:

    .trustcode/agent-signal.json      {"event": "stop", "agent": "claude-code"}

- \`"event": "stop"\`  - the agent finished a turn. The session is marked "Agent reported it finished" and, if
  "Verify when the agent reports it finished" is on, all unverified changes are verified.
- \`"event": "start"\` - starts a tracking session, only if \`trustcode.session.autoStartOnAgentSignal\` is on.

The file is read as data only (two fields, validated); nothing in it is executed. \`.trustcode/\` is never
tracked or sent. Add it to your .gitignore.

## Claude Code

Claude Code can run a command on its \`Stop\` hook (when it finishes responding). Add this to
\`.claude/settings.local.json\` in the project (or merge it into your existing hooks), then check it against
the hooks documentation of your Claude Code version:

\`\`\`json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command",
        "command": "mkdir -p \\"\${CLAUDE_PROJECT_DIR:-.}/.trustcode\\" && printf '{\\"event\\":\\"stop\\",\\"agent\\":\\"claude-code\\",\\"ts\\":\\"%s\\"}' \\"$(date -u +%FT%TZ)\\" > \\"\${CLAUDE_PROJECT_DIR:-.}/.trustcode/agent-signal.json\\"" } ] }
    ]
  }
}
\`\`\`

A Stop hook fires at the end of each agent turn, which is not always the end of the whole task. TrustCode
says "finished a turn", and withdraws "ready for review" if files start changing again.

## Other agents (Cursor, Copilot, scripts)

Any tool that can run a shell command when it finishes can write the same file. GitHub Copilot does not expose
a completion event to other extensions, so for Copilot TrustCode relies on the inactivity estimate
(\`trustcode.session.inactivitySeconds\`) or on you choosing "Review latest changes" / "End session and verify".
`;
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
      // register this device and store a signed licence, so the plan also holds while offline
      await licence.activate().catch((e) => {
        licenceLog.appendLine(`Activation: ${describeError(e)}`);
        if (e instanceof ApiError && e.code === 'device_limit_reached') {
          void vscode.window.showWarningMessage(`TrustCode: ${e.message}`, 'Manage devices').then((c) => {
            if (c) void vscode.env.openExternal(vscode.Uri.parse(`${SITE_URL}/dashboard/settings#devices`));
          });
        }
      });
      await view.showForm();
    },
  };

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('trustcode.panel', view, { webviewOptions: { retainContextWhenHidden: true } }),
    reg('trustcode.verifySelection', wrap(async () => {
      if (!view.captureSelection()) return;
      await vscode.commands.executeCommand('trustcode.panel.focus');
      view.showForm();
    })),
    reg('trustcode.verifyFile', wrap(async () => {
      if (!view.captureFile()) return;
      await vscode.commands.executeCommand('trustcode.panel.focus');
      await view.verify(undefined, undefined, { file: true });
    })),
    reg('trustcode.rerun', wrap(async () => {
      if (!view.selection) { vscode.window.showInformationMessage('TrustCode: nothing has been verified yet in this window.'); return; }
      await vscode.commands.executeCommand('trustcode.panel.focus');
      await view.onMessage({ action: 'rerun' });
    })),
    reg('trustcode.showFinding', (id?: unknown, source?: unknown) => view.showFinding(id, source).catch((e) => view.error(e))),
    vscode.languages.registerHoverProvider([{ scheme: 'file' }, { scheme: 'untitled' }], {
      provideHover(doc, pos) {
        const mark = view.markAt(doc.uri, pos.line);
        if (!mark?.finding) return session.hoverAt(doc.uri, pos.line);
        const md = new vscode.MarkdownString(hoverMarkdown(mark.finding, view.explained(mark.finding.id)));
        md.isTrusted = { enabledCommands: ['trustcode.showFinding'] };  // the only link the hover can run
        return new vscode.Hover(md, new vscode.Range(mark.range.start, 0, mark.range.end, Number.MAX_SAFE_INTEGER));
      },
    }),
    vscode.languages.registerCodeActionsProvider([{ scheme: 'file' }, { scheme: 'untitled' }], {
      provideCodeActions(doc, _range, context) {
        const actions: vscode.CodeAction[] = [];
        for (const d of context.diagnostics) {
          const id = typeof d.source === 'string' && d.source.startsWith('TrustCode') ? findingIdFromMessage(d.message) : undefined;
          if (!id) continue;
          const explain = new vscode.CodeAction(`TrustCode: explain ${id} (why, evidence, next step)`, vscode.CodeActionKind.QuickFix);
          const fromSession = session.ownsDiagnostic(doc.uri, d);
          explain.command = { command: 'trustcode.showFinding', title: 'Explain in TrustCode', arguments: fromSession ? [id, 'session'] : [id] };
          explain.diagnostics = [d];
          actions.push(explain);
        }
        if (actions.length) {
          const sessionOnly = context.diagnostics.every((d) => session.ownsDiagnostic(doc.uri, d));
          const rerun = new vscode.CodeAction(sessionOnly ? 'TrustCode: verify the session changes again' : 'TrustCode: run the checks again', vscode.CodeActionKind.QuickFix);
          rerun.command = sessionOnly ? { command: 'trustcode.verifySessionChanges', title: 'Verify session changes' } : { command: 'trustcode.rerun', title: 'Run the checks again' };
          actions.push(rerun);
        }
        return actions;
      },
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    view.unverifiedDecoration,
    vscode.window.onDidChangeVisibleTextEditors(() => view.refreshMarks()),
    security,
    sessionCmd('trustcode.scanProject', async () => { await view.showSecurityTab(); await security.scan('full'); }),
    sessionCmd('trustcode.scanChangedFiles', async () => { await view.showSecurityTab(); await security.scan('changed'); }),
    sessionCmd('trustcode.scanBeforeCommit', async () => { await view.showSecurityTab(); await security.scan('staged'); }),
    sessionCmd('trustcode.scanBeforePush', async () => { await view.showSecurityTab(); await security.scan('push'); }),
    sessionCmd('trustcode.scanBeforeProduction', async () => { await view.showSecurityTab(); await security.scan('production'); }),
    sessionCmd('trustcode.scanNewFiles', async () => { await view.showSecurityTab(); await security.scan('new'); }),
    sessionCmd('trustcode.editScanConfig', () => security.editConfig()),
    sessionCmd('trustcode.rescanSecurity', async () => { await view.showSecurityTab(); await security.rescan(); }),
    sessionCmd('trustcode.nextSecurityFinding', () => security.step(1)),
    sessionCmd('trustcode.previousSecurityFinding', () => security.step(-1)),
    sessionCmd('trustcode.setSecurityBaseline', () => security.baseline()),
    sessionCmd('trustcode.installGitHooks', () => security.installHooks()),
    sessionCmd('trustcode.showCiExample', async () => { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'yaml', content: CI_EXAMPLE })); }),
    (() => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 102);
      item.command = 'trustcode.openSecurity';
      view.securityItem = item;
      return item;
    })(),
    sessionCmd('trustcode.openSecurity', () => view.showSecurityTab()),
    sessionCmd('trustcode.checkForUpdates', async () => { await view.checkForUpdates(true); }),
    sessionCmd('trustcode.openRelease', async () => { await vscode.env.openExternal(vscode.Uri.parse(view.update?.pageUrl ?? 'https://github.com/malika1234m/trustcode/releases/latest')); }),
    sessionCmd('trustcode.openTrustCenter', async () => { await vscode.env.openExternal(vscode.Uri.parse('https://github.com/malika1234m/trustcode/blob/main/docs/TRUSTCODE_TRUST_AND_PRIVACY.md')); }),
    session,
    sessionCmd('trustcode.startSession', async () => { if (await session.start()) await view.showSessionTab(); }),
    sessionCmd('trustcode.pauseSession', () => session.pause()),
    sessionCmd('trustcode.resumeSession', () => session.resume()),
    sessionCmd('trustcode.endSession', async () => {
      if (!session.session || session.session.status === 'ended') { vscode.window.showInformationMessage('TrustCode: no session is being tracked.'); return; }
      const pick = await vscode.window.showQuickPick(['End session and verify all changes', 'End session without verifying'], { placeHolder: 'End the tracking session' });
      if (!pick) return;
      await view.showSessionTab();
      await session.end(pick.startsWith('End session and verify'));
    }),
    sessionCmd('trustcode.reviewLatestChanges', async () => { await view.showSessionTab(); await session.rescan(true); }),
    sessionCmd('trustcode.verifySessionChanges', async () => { await view.showSessionTab(); await session.verify('session', 'manual', true); }),
    sessionCmd('trustcode.verifyGitChanges', async () => { await view.showSessionTab(); await session.verify('git', 'manual', true); }),
    sessionCmd('trustcode.verifyWorkspace', async () => {
      const go = await vscode.window.showWarningMessage('Verify every Python, JavaScript and TypeScript file in the workspace? This can send many files and use several verifications from your monthly allowance. You will see the exact count before anything is sent.',
        { modal: true }, 'Continue');
      if (go !== 'Continue') return;
      await view.showSessionTab();
      await session.verify('workspace', 'manual', true);
    }),
    sessionCmd('trustcode.verifyFiles', async (clicked?: unknown, selected?: unknown) => {
      let rels = (Array.isArray(selected) && selected.length ? selected : clicked ? [clicked] : []).map(relOf).filter((p): p is string => !!p);
      if (!rels.length) {
        const picks = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFolders: false, openLabel: 'Verify these files',
          defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri });
        rels = (picks ?? []).map(relOf).filter((p): p is string => !!p);
        if (picks?.length && !rels.length) vscode.window.showWarningMessage('TrustCode: choose files inside the open workspace folder.');
      }
      if (!rels.length) return;
      await view.showSessionTab();
      await session.verify('custom', 'manual', true, rels);
    }),
    sessionCmd('trustcode.verify', async () => {
      const scope = cfg().get<string>('verification.defaultScope', 'session');
      if (scope === 'selection') return vscode.commands.executeCommand('trustcode.verifySelection');
      if (scope === 'file') return vscode.commands.executeCommand('trustcode.verifyFile');
      if (scope === 'workspace') return vscode.commands.executeCommand('trustcode.verifyWorkspace');
      if (scope === 'custom') return vscode.commands.executeCommand('trustcode.verifyFiles');
      if (scope === 'git') return vscode.commands.executeCommand('trustcode.verifyGitChanges');
      if (!session.session) {
        const pick = await vscode.window.showInformationMessage('TrustCode: no session is being tracked, so there are no session changes to verify.', 'Start tracking session', 'Verify Git-changed files');
        if (pick === 'Start tracking session') return vscode.commands.executeCommand('trustcode.startSession');
        if (pick) return vscode.commands.executeCommand('trustcode.verifyGitChanges');
        return undefined;
      }
      return vscode.commands.executeCommand('trustcode.verifySessionChanges');
    }),
    sessionCmd('trustcode.copyFixPrompt', async (mode?: unknown) => {
      const text = session.fixPrompt();
      if (!text) { vscode.window.showInformationMessage('TrustCode: the current report has no findings to send to your agent.'); return; }
      if (mode === 'open') { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'markdown', content: text })); return; }
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage('TrustCode: fix prompt copied. Paste it into your coding agent; TrustCode will pick up the changes it makes and you can verify again.');
    }),
    sessionCmd('trustcode.agentHookSetup', async () => {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'markdown', content: HOOK_DOC }));
    }),
    sessionCmd('trustcode.clearSessionHistory', async () => {
      const ok = await vscode.window.showWarningMessage('Remove all stored session verification reports for this workspace?', { modal: true }, 'Remove');
      if (ok === 'Remove') await session.clearHistory();
    }),
    (() => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
      item.command = 'trustcode.reviewLatestChanges';
      item.tooltip = 'TrustCode session — click to review the latest changes';
      view.sessionItem = item;
      return item;
    })(),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('trustcode')) { applyDisplay(); view.refreshSession(); view.refreshSecurity(); }
      if (e.affectsConfiguration('trustcode.backendUrl')) void licence.load();   // licences belong to one server
    }),
    reg('trustcode.signIn', (intent?: unknown) => wrap(async () => {
      await browserAuth.begin(intent === 'create' ? 'register' : 'login');
    })()),
    vscode.window.registerUriHandler({ handleUri: (uri: vscode.Uri) => browserAuth.handleUri(uri).catch((e) => view.error(e)) }),
    reg('trustcode.signOut', wrap(async () => {
      await licence.release();   // frees this device's slot; the licence is removed from this computer
      await ctx.secrets.delete(TOKEN_KEY());
      view.jobId = undefined;
      view.cache.clear();  // results belong to the signed-in account
      view.clearMarks();
      vscode.window.showInformationMessage('TrustCode: signed out.');
      await view.showForm();
    })),
    reg('trustcode.setExperienceLevel', wrap(async () => {
      const lvl = await vscode.window.showQuickPick(['beginner', 'intermediate', 'advanced'], { placeHolder: 'How detailed should explanations be?' });
      if (!lvl || !(await view.ensureSignedIn())) return;
      await api.request('PATCH', '/profile', { experience_level: lvl });
      view.level = undefined;
      vscode.window.showInformationMessage(`TrustCode: explanation level set to ${lvl}.`);
    })),
    reg('trustcode.privacySettings', wrap(async () => {
      if (!(await view.ensureSignedIn())) return;
      const p = await api.request('GET', '/profile');
      const picks = await vscode.window.showQuickPick([
        { label: 'Keep verification history (30 days)', key: 'store_history', picked: p.store_history },
        { label: 'Allow LLM-worded explanations (server sends finding details to its LLM provider)', key: 'allow_llm', picked: p.allow_llm },
        { label: 'Suggest explanation level changes from my feedback', key: 'adaptive_suggestions', picked: p.adaptive_suggestions },
      ].filter((x) => !(p.local && x.key === 'allow_llm')), { canPickMany: true, placeHolder: 'Select what you allow (unselected = off)' });
      if (!picks) return;
      const on = new Set(picks.map((x) => x.key));
      await api.request('PATCH', '/profile', { store_history: on.has('store_history'), allow_llm: on.has('allow_llm'), adaptive_suggestions: on.has('adaptive_suggestions') });
      vscode.window.showInformationMessage('TrustCode: privacy settings saved.');
    })),
    reg('trustcode.startExperiment', wrap(async () => { await vscode.commands.executeCommand('trustcode.panel.focus'); await view.startExperiment(); })),
    view.diagnostics,
    (() => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
      item.command = 'trustcode.panel.focus';
      view.statusItem = item;
      view.updateStatus();
      item.show();
      return item;
    })(),
    vscode.workspace.onDidChangeTextDocument((e) => view.onDocumentChanged(e)),
    reg('trustcode.clearFindings', () => { view.clearMarks(); session.diagnostics.clear(); }),
    reg('trustcode.deleteMyData', wrap(async () => {
      if (localEngine()) {
        const n = localAnalysis.counts();
        const go = await vscode.window.showWarningMessage(
          `Delete the TrustCode history, decisions and feedback stored on this computer (${n.runs} runs, ${n.feedback} ratings)? This cannot be undone.`,
          { modal: true }, 'Delete local data');
        if (go !== 'Delete local data') return;
        localAnalysis.clear();
        view.clearMarks();
        view.cache.clear();
        view.jobId = undefined;
        vscode.window.showInformationMessage('TrustCode: the data stored on this computer was deleted.');
        if (!(await ctx.secrets.get(TOKEN_KEY()))) return void (await view.showTab(view.activeTab));
      }
      const ok = await vscode.window.showWarningMessage(
        'Delete your TrustCode account and all stored verification history, decisions and feedback on this server? This cannot be undone.',
        { modal: true }, 'Delete everything');
      if (ok !== 'Delete everything' || !(await view.ensureAccount())) return;
      await api.request('DELETE', '/me/data');
      await licence.release();   // the server already removed the device; this clears the licence on this computer
      await ctx.secrets.delete(TOKEN_KEY());
      view.clearMarks();
      view.cache.clear();
      view.jobId = undefined;
      vscode.window.showInformationMessage('TrustCode: your account and data were deleted.');
    })),
    reg('trustcode.showAccount', wrap(async () => {
      await vscode.commands.executeCommand('trustcode.panel.focus');
      await view.showTab('account');
    })),
    reg('trustcode.checkLicence', wrap(async () => {
      await licence.sync(true);
      vscode.window.showInformationMessage(`TrustCode: ${licence.view.message}`);
    })),
    reg('trustcode.setupEngine', wrap(async () => {
      if (engine.python()) { vscode.window.showInformationMessage('TrustCode: the local engine is already set up.'); return; }
      await engine.ensure(true);
    })),
    reg('trustcode.engineStatus', wrap(async () => {
      const info = engine.info();
      if (info.status !== 'ready') { vscode.window.showWarningMessage(`TrustCode: the local engine is ${info.status === 'installing' ? 'being set up' : 'not set up'}.${info.detail ? ` ${info.detail}` : ''}`); return; }
      const d = await engine.run({ op: 'doctor' }, { timeoutMs: 120_000 });
      engineLog.appendLine(`\nEngine ${d.engine} · Python ${d.python} · ${d.executable}`);
      for (const [name, t] of Object.entries<any>(d.tools ?? {})) engineLog.appendLine(`  ${t.available ? 'available    ' : 'NOT available'}  ${name}${t.version ? ` ${t.version}` : ''} — ${t.used_for}${t.note && !t.available ? ` (${t.note})` : ''}`);
      engineLog.show();
      const missing: string[] = d.missing ?? [];
      vscode.window.showInformationMessage(missing.length ? `TrustCode engine is working. Not available: ${missing.join(', ')} — the checks that need them are reported as not run.` : 'TrustCode engine is working and every tool is available.');
    })),
    reg('trustcode.removeEngine', wrap(async () => {
      const go = await vscode.window.showWarningMessage('Remove the local engine TrustCode installed? Verify, Session and Security stop working until it is set up again. Your history is kept.', { modal: true }, 'Remove');
      if (go !== 'Remove') return;
      await engine.remove();
      vscode.window.showInformationMessage('TrustCode: the local engine was removed.');
    })),
    reg('trustcode.forgetConsent', wrap(async () => { await ctx.globalState.update(CONSENT_KEY, { trustedBackends: [] }); vscode.window.showInformationMessage('TrustCode will ask before sending code again.'); })),
  );
  void session.activate().catch(() => undefined);   // restores a session that was being tracked before a restart
  // Test-only hook (never active for users): lets the integration suite drive the real panel object.
  if (process.env.TRUSTCODE_TEST === '1') {
    return { __test: { view, ctx, browserAuth, session, security, activationMs: Date.now() - started,
      // simulates a restart: a fresh controller that must restore everything from storage
      restartSession: async () => { await view.session.persistNow(); view.session.dispose(); const next = new SessionController(ctx, sessionHost); view.session = next;
        next.gate = () => licence.usable(); await next.activate(); return next; } } };
  }
  return undefined;
}

export function deactivate() { /* disposables are released via ctx.subscriptions */ }
