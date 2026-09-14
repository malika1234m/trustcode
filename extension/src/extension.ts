import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ApiError, describeError, Tokens, TrustCodeApi } from './api';
import { consentMessage, ConsentState, languageFor, needsPrompt, remember } from './consent';
import { esc, Level, renderDecision, renderResult } from './render';
import { shellHtml, submitFormHtml } from './panel';

const TOKEN_KEY = 'trustcode.tokens';
const PARTICIPANT_KEY = 'trustcode.participantToken';
const CONSENT_KEY = 'trustcode.consent';

interface Selection { code: string; language?: 'python' | 'javascript'; lines: number }

class TrustCodeView implements vscode.WebviewViewProvider {
  view?: vscode.WebviewView;
  selection?: Selection;
  jobId?: string;
  level?: Level;
  trialId?: string;
  private lastTask = '';

  constructor(private ctx: vscode.ExtensionContext, private api: TrustCodeApi, private participantApi: TrustCodeApi) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = shellHtml(view.webview);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => this.error(e)));
  }

  render(html: string) { this.view?.webview.postMessage({ type: 'render', html }); }
  showForm() { this.render(submitFormHtml(this.selection && { lines: this.selection.lines, language: this.selection.language }, this.lastTask)); }
  error(e: unknown) {
    const msg = describeError(e);
    vscode.window.showErrorMessage(`TrustCode: ${msg}`);
    this.render(`<p class="err" role="alert">${esc(msg)}</p><button data-action="home">Back</button>`);
  }

  captureSelection(): boolean {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.selection.isEmpty) {
      vscode.window.showInformationMessage('TrustCode: select the AI-generated code you want to verify first.');
      return false;
    }
    const code = ed.document.getText(ed.selection);  // read-only access; the document is never modified
    this.selection = { code, language: languageFor(ed.document.languageId), lines: code.split('\n').length };
    return true;
  }

  async onMessage(m: any) {
    switch (m.action) {
      case 'ready': case 'home': return this.showForm();
      case 'verify': this.lastTask = m.task ?? ''; return this.verify(m.task, m.tests);
      case 'level': this.level = m.level; return this.showExplanation();
      case 'decide': return this.decide(m);
      case 'feedback': await this.api.request('POST', '/feedback', { job_id: this.jobId, finding_id: m.finding, rating: m.rating });
        return void vscode.window.setStatusBarMessage('TrustCode: thanks for the feedback', 2500);
      case 'experiment': return vscode.commands.executeCommand('trustcode.startExperiment');
      case 'trial-decide': return this.trialDecide(m);
      case 'track': return this.track(m);
      case 'tlx': return this.submitTlx(m);
    }
  }

  async ensureSignedIn(): Promise<boolean> {
    if (await this.ctx.secrets.get(TOKEN_KEY)) return true;
    const cfg = vscode.workspace.getConfiguration('trustcode');
    if (cfg.get('mode') === 'local') {
      const secretFile = path.join(os.homedir(), '.trustcode', 'local-secret');
      if (!fs.existsSync(secretFile)) {
        vscode.window.showErrorMessage('TrustCode local mode: start the local backend first (it creates ~/.trustcode/local-secret).');
        return false;
      }
      await this.api.localLogin(fs.readFileSync(secretFile, 'utf8').trim());
      return true;
    }
    await vscode.commands.executeCommand('trustcode.signIn');
    return !!(await this.ctx.secrets.get(TOKEN_KEY));
  }

  async verify(task?: string, tests?: string) {
    if (!this.selection && !this.captureSelection()) return;
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
        this.render('<p>Submitting… <span class="muted">(you can cancel from the notification)</span></p>');
        const job = await this.api.submit(sel.code, sel.language, task, tests);
        this.jobId = job.id;
        const done = await this.api.waitForResult(job.id, () => token.isCancellationRequested, (s) => {
          progress.report({ message: s === 'running' ? 'running checks (syntax, lint, security, tests)…' : `${s}…` });
          this.render(`<p>Verification ${esc(s)}… running independent checks.</p>`);
        });
        if (done.status === 'cancelled') { this.render('<p>Verification cancelled.</p><button data-action="home">Back</button>'); return; }
        if (done.status !== 'done') throw new ApiError(500, 'failed', done.error ?? `verification ${done.status}`);
        await this.showExplanation();
      });
  }

  async showExplanation() {
    if (!this.jobId) return this.showForm();
    const useLlm = vscode.workspace.getConfiguration('trustcode').get('useLlmExplanations', false);
    const q = new URLSearchParams();
    if (this.level) q.set('level', this.level);
    if (useLlm) q.set('llm', 'true');
    const view = await this.api.request('GET', `/verifications/${this.jobId}/explanation?${q}`);
    this.render(`<h2>Verification evidence</h2>${renderResult(view)}${renderDecision('decide')}
      <label for="rationale">Optional note</label><textarea id="rationale"></textarea>
      <div class="row"><button data-action="home">Verify something else</button></div>`);
  }

  async decide(m: any) {
    if (!this.jobId) return;
    await this.api.request('POST', `/verifications/${this.jobId}/decision`,
      { decision: m.decision, confidence: m.confidence, rationale: m.rationale || undefined });
    vscode.window.showInformationMessage(`TrustCode: decision “${m.decision}” recorded. Your code was not changed.`);
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
    await this.ctx.secrets.store(PARTICIPANT_KEY, JSON.stringify({ access: r.access_token }));
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
    if (!this.trialId) return;
    await this.participantApi.request('POST', `/experiments/trials/${this.trialId}/decision`,
      { decision: m.decision, confidence: m.confidence ?? 50, rationale: m.rationale || undefined });
    await this.nextTrial();
  }

  async track(m: any) {
    if (!this.trialId) return;  // interaction events are only collected in study mode
    await this.participantApi.request('POST', '/experiments/events', { trial_id: this.trialId, type: m.type, payload: m.finding ? { finding: m.finding } : undefined })
      .catch(() => undefined);
  }

  async submitTlx(m: any) {
    const responses = { raw: m.rationale ?? '' };
    await this.participantApi.request('POST', '/experiments/questionnaires', { instrument: 'open', responses });
    this.render('<p>Thank you — your responses were recorded.</p>');
  }
}

function tlxForm(): string {
  return `<label for="rationale">Any comments about the two ways of working? (optional)</label><textarea id="rationale"></textarea>
    <button class="primary" data-action="tlx">Submit</button>`;
}

function secretStore(ctx: vscode.ExtensionContext, key: string) {
  return {
    async get(): Promise<Tokens | undefined> { const v = await ctx.secrets.get(key); return v ? JSON.parse(v) : undefined; },
    async set(t: Tokens | undefined) { if (t) await ctx.secrets.store(key, JSON.stringify(t)); else await ctx.secrets.delete(key); },
  };
}

export function activate(ctx: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration('trustcode');
  const timeout = () => cfg().get<number>('requestTimeoutSeconds', 30) * 1000;
  const api = new TrustCodeApi(() => cfg().get<string>('backendUrl')!, secretStore(ctx, TOKEN_KEY), timeout);
  const participantApi = new TrustCodeApi(() => cfg().get<string>('backendUrl')!, secretStore(ctx, PARTICIPANT_KEY), timeout);
  const view = new TrustCodeView(ctx, api, participantApi);
  const wrap = (fn: () => Promise<unknown>) => () => fn().catch((e) => view.error(e));

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('trustcode.panel', view, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('trustcode.verifySelection', wrap(async () => {
      if (!view.captureSelection()) return;
      await vscode.commands.executeCommand('trustcode.panel.focus');
      view.showForm();
    })),
    vscode.commands.registerCommand('trustcode.signIn', wrap(async () => {
      const email = await vscode.window.showInputBox({ prompt: 'TrustCode email', ignoreFocusOut: true });
      if (!email) return;
      const password = await vscode.window.showInputBox({ prompt: 'Password (min. 10 characters)', password: true, ignoreFocusOut: true });
      if (!password) return;
      const create = await vscode.window.showQuickPick(['Sign in', 'Create account'], { placeHolder: 'Sign in or create an account?' });
      if (create === 'Create account') await api.register(email, password); else await api.login(email, password);
      vscode.window.showInformationMessage('TrustCode: signed in.');
    })),
    vscode.commands.registerCommand('trustcode.signOut', wrap(async () => { await ctx.secrets.delete(TOKEN_KEY); vscode.window.showInformationMessage('TrustCode: signed out.'); })),
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
    vscode.commands.registerCommand('trustcode.forgetConsent', wrap(async () => { await ctx.globalState.update(CONSENT_KEY, { trustedBackends: [] }); vscode.window.showInformationMessage('TrustCode will ask before sending code again.'); })),
  );
}

export function deactivate() { /* nothing to clean up */ }
