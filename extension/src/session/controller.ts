// Session controller: connects the pure session model to VS Code (file events, Git, storage, timers) and to
// the verification server. All state decisions live in ./model and ./report so they can be unit-tested.
import { execFile } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ApiError, TrustCodeApi } from '../api';
import { codeLanguage, importsAnyOf, localImports, nearestManifests } from './imports';
import {
  absorbPausedChange, awaitingVerification, counts, DEFAULT_EXCLUDE, DEFAULT_SENSITIVE, deserialize, effectiveChanges, EffectiveChange, FileState,
  inactivityReached, isSensitive, markCompletion, newSession, noteActivity, observe, parseAgentSignal, serialize, SessionData, TrackingRules,
  trackingDecision, verificationKey,
} from './model';
import { buildFixPrompt, compareRuns, mergeReports, outdatedFiles, planBatches, RunComparison, RunRecord, SessionFinding } from './report';
import { DashboardModel, DashboardSettings } from './render';
import { hoverMarkdown, LineRange, shiftRange, toLineEdit } from '../findings';

const MAX_FILE_CHARS = 50_000;          // server limit per file
const BATCH = { maxFiles: 38, maxChars: 380_000 };
const MAX_TRACKED = 20_000;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const SIGNAL_FILE = '.trustcode/agent-signal.json';
const BASELINE_SCHEME = 'trustcode-baseline';
const SEV: Record<string, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Warning, high: vscode.DiagnosticSeverity.Warning,
  medium: vscode.DiagnosticSeverity.Information, low: vscode.DiagnosticSeverity.Information, info: vscode.DiagnosticSeverity.Hint,
};

export interface Host {
  api: TrustCodeApi;
  ensureSignedIn(): Promise<boolean>;
  /** Analysis runs on this machine: nothing is sent, so there is no consent step and no server limit. */
  local(): boolean;
  /** Makes sure the local engine can run; asks before installing, never when `interactive` is false. */
  ensureEngine(interactive: boolean): Promise<boolean>;
  /** Asks for consent when the server is not yet trusted. `interactive: false` must never show a dialog. */
  consent(message: string, interactive: boolean): Promise<boolean>;
  backendLabel(): string;
  refresh(): void;
  showSessionTab(): Promise<void>;
  focusFinding(id: string): void;
  onError(e: unknown): void;
  /** Called when a session reaches a review point (agent signal, inactivity estimate, or the user ending it). */
  onChangesReady?(paths: string[]): void;
}
interface Item { path: string; kind: 'created' | 'modified' | 'deleted' | 'renamed'; from?: string; baseline?: string | null }
interface Mark { range: LineRange; finding: SessionFinding }
type Trigger = 'manual' | 'agent_signal' | 'inactivity' | 'session_end' | 'save' | 'batch' | 'changed_during_run';

const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

function git(cwd: string, args: string[], maxBuffer = 64 * 1024 * 1024): Promise<string | undefined> {
  return new Promise((resolve) => {
    // execFile: arguments are passed as an array, never through a shell
    execFile('git', args, { cwd, maxBuffer, timeout: 20_000, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout) => resolve(err ? undefined : stdout));
  });
}

export class SessionController implements vscode.Disposable {
  session?: SessionData;
  runs: RunRecord[] = [];
  viewingRun?: string;
  busy?: { message: string; done: number; total: number };
  readonly diagnostics = vscode.languages.createDiagnosticCollection('trustcode-session');
  private marks = new Map<string, Mark[]>();   // uri string -> marks
  private disposables: vscode.Disposable[] = [];
  private sessionDisposables: vscode.Disposable[] = [];
  private queue = new Set<string>();
  private queueTimer?: NodeJS.Timeout;
  private saveTimer?: NodeJS.Timeout;
  private autoTimer?: NodeJS.Timeout;
  private tick?: NodeJS.Timeout;
  private editedInEditor = new Set<string>();
  private listing: string[] = [];
  private importCache = new Map<string, { key: string; text: string }>();
  private rerunRequested = false;
  private notifiedReady = false;
  private processing: Promise<void> = Promise.resolve();
  private baselineProvider = new (class implements vscode.TextDocumentContentProvider {
    contents = new Map<string, string>();
    provideTextDocumentContent(uri: vscode.Uri) { return this.contents.get(uri.toString()) ?? ''; }
  })();

  constructor(private ctx: vscode.ExtensionContext, private host: Host) {
    this.disposables.push(this.diagnostics,
      vscode.workspace.registerTextDocumentContentProvider(BASELINE_SCHEME, this.baselineProvider),
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChanged(e)));
  }

  // ------------------------------------------------------------------ configuration
  private cfg() { return vscode.workspace.getConfiguration('trustcode'); }
  rules(): TrackingRules {
    const c = this.cfg();
    return {
      exclude: c.get<string[]>('session.exclude', DEFAULT_EXCLUDE), include: c.get<string[]>('session.include', []),
      extensions: c.get<string[]>('session.extensions', []), sensitive: c.get<string[]>('session.sensitiveFiles', DEFAULT_SENSITIVE),
      maxFileSizeBytes: Math.max(1, c.get<number>('session.maxFileSizeKB', 512)) * 1024,
    };
  }
  settings(): DashboardSettings {
    const c = this.cfg();
    return {
      depth: c.get('verification.depth', 'standard'), defaultScope: c.get('verification.defaultScope', 'session'),
      inactivitySeconds: c.get('session.inactivitySeconds', 60), sendBaseline: c.get('verification.sendBaseline', true),
      includeRelated: c.get('verification.includeRelatedFiles', true), batchSize: Math.max(2, c.get('autoVerify.batchSize', 10)),
      auto: { agentFinished: c.get('autoVerify.onAgentFinished', true), inactivity: c.get('autoVerify.onInactivity', false),
        sessionEnd: c.get('autoVerify.onSessionEnd', true), save: c.get('autoVerify.onSave', false), batch: c.get('autoVerify.onBatch', false) },
    };
  }
  private notify(level: 'important' | 'all', message: string, ...actions: string[]): Thenable<string | undefined> {
    const pref = this.cfg().get<string>('session.notifications', 'important');
    if (pref === 'none' || (pref === 'important' && level === 'all')) { vscode.window.setStatusBarMessage(`TrustCode: ${message}`, 5000); return Promise.resolve(undefined); }
    return vscode.window.showInformationMessage(`TrustCode: ${message}`, ...actions);
  }

  // ------------------------------------------------------------------ workspace paths
  private folders(): readonly vscode.WorkspaceFolder[] { return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file'); }
  hasWorkspace(): boolean { return this.folders().length > 0 && !!this.ctx.storageUri; }
  /** Workspace-relative path with forward slashes; prefixed with the folder name in multi-root workspaces. */
  toRel(uri: vscode.Uri): string | undefined {
    const fs_ = this.folders();
    const f = fs_.find((x) => uri.fsPath === x.uri.fsPath || uri.fsPath.startsWith(x.uri.fsPath + path.sep));
    if (!f || uri.scheme !== 'file') return undefined;
    const rel = path.relative(f.uri.fsPath, uri.fsPath).split(path.sep).join('/');
    if (!rel || rel.startsWith('..')) return undefined;
    return fs_.length > 1 ? `${f.name}/${rel}` : rel;
  }
  toUri(rel: string): vscode.Uri | undefined {
    const fs_ = this.folders();
    if (!fs_.length) return undefined;
    if (fs_.length === 1) return vscode.Uri.joinPath(fs_[0].uri, ...rel.split('/'));
    const [name, ...rest] = rel.split('/');
    const f = fs_.find((x) => x.name === name);
    return f ? vscode.Uri.joinPath(f.uri, ...rest) : undefined;
  }
  private folderOf(rel: string): { folder: vscode.WorkspaceFolder; inner: string } | undefined {
    const fs_ = this.folders();
    if (fs_.length === 1) return { folder: fs_[0], inner: rel };
    const [name, ...rest] = rel.split('/');
    const folder = fs_.find((x) => x.name === name);
    return folder ? { folder, inner: rest.join('/') } : undefined;
  }
  private useGit(): boolean { return vscode.workspace.isTrusted && this.cfg().get('session.useGit', true); }

  /** Every file that exists now and is tracked, plus the reasons for files that are not. */
  private async listFiles(): Promise<{ files: string[]; skipped: Array<{ path: string; reason: string }>; usedGit: boolean }> {
    const rules = this.rules();
    const files: string[] = [], skipped: Array<{ path: string; reason: string }> = [];
    let usedGit = false;
    const multi = this.folders().length > 1;
    for (const folder of this.folders()) {
      let rels: string[] | undefined;
      if (this.useGit()) {
        // respects .gitignore, so build output and dependency folders are never walked
        const out = await git(folder.uri.fsPath, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
        if (out !== undefined) { rels = out.split('\0').filter(Boolean); usedGit = true; }
      }
      if (!rels) {
        const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), '**/{node_modules,.git,.venv,venv,__pycache__}/**', MAX_TRACKED + 1);
        rels = uris.map((u) => path.relative(folder.uri.fsPath, u.fsPath).split(path.sep).join('/'));
      }
      for (const r of rels) {
        const rel = multi ? `${folder.name}/${r}` : r;
        const d = trackingDecision(rel, rules);
        if (!d.track) { if (!/(^|\/)(node_modules|\.git|\.venv|venv|__pycache__|\.trustcode)\//.test(rel)) skipped.push({ path: rel, reason: d.reason! }); continue; }
        files.push(rel);
      }
    }
    if (files.length > MAX_TRACKED) {
      skipped.push({ path: `${files.length - MAX_TRACKED} more files`, reason: `beyond the limit of ${MAX_TRACKED.toLocaleString()} tracked files — narrow trustcode.session.include` });
      files.length = MAX_TRACKED;
    }
    return { files, skipped: skipped.slice(0, 500), usedGit };
  }

  private async stateOf(rel: string, known?: FileState): Promise<FileState | undefined> {
    const uri = this.toUri(rel);
    if (!uri) return undefined;
    try {
      const st = await fs.promises.stat(uri.fsPath);
      if (!st.isFile()) return undefined;
      const mtime = Math.floor(st.mtimeMs);
      if (known && known.size === st.size && known.mtime === mtime) return known;   // unchanged on disk: no need to re-read
      if (st.size > this.rules().maxFileSizeBytes) return { hash: `meta:${st.size}:${mtime}`, size: st.size, mtime };
      return { hash: sha(await fs.promises.readFile(uri.fsPath)), size: st.size, mtime };
    } catch { return undefined; }
  }

  private async mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
  }

  // ------------------------------------------------------------------ persistence
  private file(name: string): string | undefined { return this.ctx.storageUri ? path.join(this.ctx.storageUri.fsPath, name) : undefined; }
  private persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.persistNow(), 1500);
  }
  async persistNow() {
    clearTimeout(this.saveTimer);
    const f = this.file('session.json'), r = this.file('runs.json');
    if (!f || !r) return;
    try {
      await fs.promises.mkdir(path.dirname(f), { recursive: true });
      if (this.session) await fs.promises.writeFile(f, serialize(this.session)); else await fs.promises.rm(f, { force: true });
      const keep = Math.max(1, this.cfg().get<number>('session.retainRuns', 10));
      this.runs = this.runs.slice(-keep);
      await fs.promises.writeFile(r, JSON.stringify(this.runs));
    } catch { /* storage unavailable: the session continues in memory */ }
  }

  /** Restores a session after a restart and rescans, so changes made while VS Code was closed are included. */
  async activate() {
    const f = this.file('session.json'), r = this.file('runs.json');
    if (!f || !r) return;
    try { this.runs = JSON.parse(await fs.promises.readFile(r, 'utf8')); if (!Array.isArray(this.runs)) this.runs = []; } catch { this.runs = []; }
    let s: SessionData | undefined;
    try { s = deserialize(await fs.promises.readFile(f, 'utf8')); } catch { s = undefined; }
    if (!s) return;
    this.session = s;
    if (s.status !== 'ended') {
      s.recoveredAt = Date.now();
      this.attach();
      if (s.status !== 'paused') await this.rescan(false);
    }
    this.host.refresh();
  }

  // ------------------------------------------------------------------ session lifecycle
  /** Set by the extension: false until a registered account is confirmed on this device. */
  gate: () => boolean = () => true;

  async start(agentHint?: string): Promise<boolean> {
    if (!this.gate()) return false;
    if (!this.hasWorkspace()) { vscode.window.showInformationMessage('TrustCode: open a folder to track a session.'); return false; }
    if (this.session && this.session.status !== 'ended') {
      const c = counts(this.session);
      const go = await vscode.window.showWarningMessage(`A session is already being tracked (${c.total} changed file${c.total === 1 ? '' : 's'}). Start a new one? The current session ends; its verification history is kept.`,
        { modal: true }, 'Start new session');
      if (go !== 'Start new session') return false;
    }
    let agent = agentHint;
    if (!agent) {
      const known = this.detectAgents();
      const pick = await vscode.window.showQuickPick([...known.map((k) => ({ label: k, description: 'detected in this editor' })),
        ...['Claude Code', 'GitHub Copilot', 'Cursor', 'Another agent', 'Manual coding (no agent)'].filter((k) => !known.includes(k)).map((k) => ({ label: k, description: '' }))],
      { placeHolder: 'Which coding agent will make the changes? (a label for the session — it does not change what is tracked)' });
      if (!pick) return false;
      agent = pick.label;
    }
    this.detach();
    const s = newSession(randomBytes(8).toString('hex'), agent, Date.now());
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'TrustCode: recording the session baseline…' }, async () => {
      const { files, skipped, usedGit } = await this.listFiles();
      s.skipped = skipped;
      this.listing = files;
      await this.mapLimit(files, 24, async (rel) => { const st = await this.stateOf(rel); if (st) s.baseline[rel] = st; });
      await this.snapshotBaseline(s, usedGit);
    });
    this.session = s;
    this.viewingRun = undefined;
    this.notifiedReady = false;
    this.editedInEditor.clear();
    this.attach();
    await this.persistNow();
    this.host.refresh();
    void this.notify('all', `tracking started — ${Object.keys(s.baseline).length} files in the baseline.`);
    return true;
  }

  private detectAgents(): string[] {
    const out: string[] = [];
    if (/cursor/i.test(vscode.env.appName)) out.push('Cursor');
    if (vscode.extensions.getExtension('anthropic.claude-code')) out.push('Claude Code');
    if (vscode.extensions.getExtension('GitHub.copilot') || vscode.extensions.getExtension('GitHub.copilot-chat')) out.push('GitHub Copilot');
    return out;
  }

  /**
   * Makes the pre-session text of files retrievable (for diffs and for new/pre-existing attribution).
   * With Git: committed files are read from the recorded HEAD on demand; only files that were already
   * uncommitted at start are copied. Without Git: text files are copied until a size budget is reached.
   */
  private async snapshotBaseline(s: SessionData, usedGit: boolean) {
    const dir = this.file(`baseline-${s.id}`);
    if (!dir) return;
    await fs.promises.mkdir(dir, { recursive: true });
    let budget = MAX_SNAPSHOT_BYTES;
    const copy = async (rel: string) => {
      const st = s.baseline[rel], uri = this.toUri(rel);
      if (!st || !uri || st.hash.startsWith('meta:') || st.size > budget) { s.baselineContent[rel] = 'none'; return; }
      try { await fs.promises.copyFile(uri.fsPath, path.join(dir, sha(rel))); budget -= st.size; s.baselineContent[rel] = 'snapshot'; } catch { s.baselineContent[rel] = 'none'; }
    };
    const dirty = new Set<string>();
    let gitOk = false;
    if (usedGit && this.folders().length === 1) {
      const cwd = this.folders()[0].uri.fsPath;
      const head = (await git(cwd, ['rev-parse', 'HEAD']))?.trim();
      const prefix = (await git(cwd, ['rev-parse', '--show-prefix']))?.trim() ?? '';
      const status = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
      if (head && status !== undefined) {
        gitOk = true;
        const parts = status.split('\0');
        for (let i = 0; i < parts.length; i++) {
          const e = parts[i];
          if (e.length < 4) continue;
          const p = e.slice(3);
          if (e[0] === 'R' || e[0] === 'C') i++;   // the next field is the original path
          if (p.startsWith(prefix)) dirty.add(p.slice(prefix.length));
        }
        s.git = { root: cwd, head, branch: (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim(), dirtyAtStart: [...dirty].sort() };
        (s.git as any).prefix = prefix;
      }
    }
    const all = Object.keys(s.baseline);
    if (gitOk) {
      for (const rel of all) if (!dirty.has(rel)) s.baselineContent[rel] = 'git';
      await this.mapLimit(all.filter((r) => dirty.has(r)), 8, copy);
    } else {
      await this.mapLimit(all, 8, copy);
      if (Object.values(s.baselineContent).includes('none')) s.warnings.push('Some files were too large to copy for the baseline: their changes are detected, but a diff and new/pre-existing labels are unavailable for them.');
    }
  }

  /** Text of a file as it was when the session started; undefined when it is not retrievable. */
  async baselineText(rel: string, s = this.session): Promise<string | undefined> {
    if (!s || !s.baseline[rel]) return undefined;
    const src = s.baselineContent[rel];
    try {
      if (src === 'snapshot') {
        const dir = this.file(`baseline-${s.id}`);
        return dir ? await fs.promises.readFile(path.join(dir, sha(rel)), 'utf8') : undefined;
      }
      if (src === 'git' && s.git?.head) return await git(s.git.root, ['show', `${s.git.head}:${(s.git as any).prefix ?? ''}${rel}`], 8 * 1024 * 1024);
    } catch { /* fall through */ }
    return undefined;
  }

  private attach() {
    this.detach();
    const add = (d: vscode.Disposable) => this.sessionDisposables.push(d);
    for (const folder of this.folders()) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
      const on = (u: vscode.Uri) => this.enqueue(u);
      add(w); add(w.onDidCreate(on)); add(w.onDidChange(on)); add(w.onDidDelete(on));
    }
    // A save performed by VS Code itself means the content came from an editor (you, or an in-editor assistant) -
    // unlike a file an external agent wrote straight to disk.
    add(vscode.workspace.onWillSaveTextDocument((e) => { const rel = this.toRel(e.document.uri); if (rel) this.editedInEditor.add(rel); }));
    add(vscode.workspace.onDidSaveTextDocument((d) => { this.enqueue(d.uri); this.onSaved(); }));
    add(vscode.workspace.onDidRenameFiles((e) => e.files.forEach((f) => { this.enqueue(f.oldUri); this.enqueue(f.newUri); })));
    add(vscode.workspace.onDidDeleteFiles((e) => e.files.forEach((f) => this.enqueue(f))));
    add(vscode.workspace.onDidCreateFiles((e) => e.files.forEach((f) => this.enqueue(f))));
    this.tick = setInterval(() => this.onTick(), 5000);
  }
  private detach() {
    this.sessionDisposables.forEach((d) => d.dispose());
    this.sessionDisposables = [];
    clearInterval(this.tick); clearTimeout(this.queueTimer); clearTimeout(this.autoTimer);
    this.queue.clear();
  }

  // ------------------------------------------------------------------ change detection
  private enqueue(uri: vscode.Uri) {
    const s = this.session;
    if (!s || s.status === 'ended') return;
    const rel = this.toRel(uri);
    if (!rel) return;
    if (rel === SIGNAL_FILE || rel.endsWith(`/${SIGNAL_FILE}`)) { void this.onSignal(uri); return; }
    if (s.status === 'paused') return;   // absorbed into the baseline on resume
    if (!trackingDecision(rel, this.rules()).track) return;
    this.queue.add(rel);
    clearTimeout(this.queueTimer);
    // a burst of events (an agent writing many files, or several events for one write) is handled as one batch
    this.queueTimer = setTimeout(() => { this.processing = this.processing.then(() => this.flush()).catch(() => undefined); }, 350);
  }

  private async flush() {
    const s = this.session;
    if (!s || s.status === 'paused' || s.status === 'ended') { this.queue.clear(); return; }
    const batch = [...this.queue];
    this.queue.clear();
    let changed = false;
    const now = Date.now();
    await this.mapLimit(batch, 16, async (rel) => {
      const uri = this.toUri(rel);
      let isDir = false;
      try { isDir = !!uri && (await fs.promises.stat(uri.fsPath)).isDirectory(); } catch { /* gone */ }
      if (isDir) return void (changed = (await this.rescanUnder(rel)) || changed);
      const cur = await this.stateOf(rel, s.changes[rel]?.current ?? s.baseline[rel]);
      if (!cur && !s.baseline[rel] && !s.changes[rel]) {
        // a directory that existed at baseline was removed or renamed: its files are gone
        return void (changed = (await this.rescanUnder(rel)) || changed);
      }
      if (observe(s, rel, cur, now)) changed = true;
      if (s.changes[rel] && this.editedInEditor.has(rel)) s.changes[rel].editedInEditor = true;
    });
    if (changed) this.changed();
  }

  /** Re-examines every baseline and listed file below a directory (directory create/delete/rename events). */
  private async rescanUnder(dir: string): Promise<boolean> {
    const s = this.session!;
    const prefix = `${dir}/`;
    const now = Date.now();
    const candidates = new Set([...Object.keys(s.baseline), ...Object.keys(s.changes)].filter((p) => p.startsWith(prefix)));
    const uri = this.toUri(dir);
    if (uri) {
      const walk = async (d: string, rel: string, depth: number) => {
        if (depth > 12) return;
        let entries: fs.Dirent[] = [];
        try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const r = `${rel}/${e.name}`;
          if (e.isDirectory()) { if (trackingDecision(`${r}/x`, this.rules()).track) await walk(path.join(d, e.name), r, depth + 1); } else if (trackingDecision(r, this.rules()).track) candidates.add(r);
        }
      };
      await walk(uri.fsPath, dir, 0);
    }
    let changed = false;
    for (const rel of candidates) if (observe(s, rel, await this.stateOf(rel, s.changes[rel]?.current ?? s.baseline[rel]), now)) changed = true;
    return changed;
  }

  private changed() {
    const s = this.session!;
    noteActivity(s);
    this.notifiedReady = false;
    this.persist();
    this.host.refresh();
    const st = this.settings();
    if (st.auto.batch && awaitingVerification(s).length >= st.batchSize) this.scheduleAuto('batch', 6000);
  }

  /**
   * Full comparison of the workspace with the baseline. Independent of events, so a change that produced
   * no event (watcher exclusion, VS Code closed, a tool writing behind the editor) is still found.
   */
  async rescan(announce = true): Promise<number> {
    const s = this.session;
    if (!s) return 0;
    await this.processing;
    const before = JSON.stringify(Object.values(s.changes).map((c) => [c.path, c.kind, c.current?.hash]));
    const { files, skipped } = await this.listFiles();
    this.listing = files;
    s.skipped = skipped;
    const now = Date.now();
    const present = new Set(files);
    await this.mapLimit(files, 24, async (rel) => { observe(s, rel, await this.stateOf(rel, s.changes[rel]?.current ?? s.baseline[rel]), now); });
    // tracked at baseline but no longer listed: deleted, or now ignored/excluded - check the disk to tell the difference
    for (const rel of Object.keys(s.baseline)) {
      if (present.has(rel) || !trackingDecision(rel, this.rules()).track) continue;
      observe(s, rel, await this.stateOf(rel, s.changes[rel]?.current ?? s.baseline[rel]), now);
    }
    for (const rel of Object.keys(s.changes)) if (this.editedInEditor.has(rel)) s.changes[rel].editedInEditor = true;
    await this.checkHead(s);
    const after = JSON.stringify(Object.values(s.changes).map((c) => [c.path, c.kind, c.current?.hash]));
    if (before !== after) { noteActivity(s); this.persist(); }
    this.host.refresh();
    const c = counts(s);
    if (announce) vscode.window.setStatusBarMessage(`TrustCode: ${c.total} changed file${c.total === 1 ? '' : 's'} in this session (${c.awaiting} not verified)`, 5000);
    return c.total;
  }

  private async checkHead(s: SessionData) {
    if (!s.git?.head || !this.useGit()) return;
    const head = (await git(s.git.root, ['rev-parse', 'HEAD']))?.trim();
    const note = 'Git HEAD moved during the session (commit, checkout or pull). TrustCode compares file contents with the baseline, so files changed by that Git operation are listed as session changes.';
    s.warnings = s.warnings.filter((w) => w !== note);
    if (head && head !== s.git.head) s.warnings.push(note);
  }

  async pause() {
    const s = this.session;
    if (!s || (s.status !== 'tracking' && s.status !== 'awaiting_review')) return;
    await this.processing; await this.flush();
    s.status = 'paused'; s.pausedAt = Date.now(); s.completion = undefined;
    await this.persistNow(); this.host.refresh();
  }

  /** Resumes tracking. Whatever changed during the pause becomes part of the baseline (not attributed). */
  async resume() {
    const s = this.session;
    if (!s || s.status !== 'paused') return;
    const { files } = await this.listFiles();
    this.listing = files;
    let absorbed = 0, mixed = 0;
    for (const rel of new Set([...files, ...Object.keys(s.baseline), ...Object.keys(s.changes)])) {
      if (!trackingDecision(rel, this.rules()).track) continue;
      const r = absorbPausedChange(s, rel, await this.stateOf(rel, s.changes[rel]?.current ?? s.baseline[rel]));
      if (r === 'absorbed') absorbed++; else if (r === 'mixed') mixed++;
    }
    s.status = 'tracking'; s.pausedAt = undefined;
    await this.persistNow(); this.host.refresh();
    if (absorbed || mixed) void this.notify('all', `resumed. ${absorbed} file${absorbed === 1 ? '' : 's'} changed while paused ${absorbed === 1 ? 'is' : 'are'} not attributed to the session`
      + (mixed ? `; ${mixed} already had session changes and ${mixed === 1 ? 'is' : 'are'} marked “includes paused edits”.` : '.'));
  }

  async end(verify: boolean) {
    const s = this.session;
    if (!s || s.status === 'ended') return;
    if (s.status !== 'paused') await this.rescan(false);
    s.status = 'ended'; s.endedAt = Date.now(); s.completion = { kind: 'manual', at: Date.now(), detail: 'You ended the session.' };
    this.detach();
    await this.persistNow(); this.host.refresh();
    this.changesReady();
    if (verify && counts(s).total) await this.verify('session', 'session_end', true);
  }

  // ------------------------------------------------------------------ completion signals and triggers
  private async onSignal(uri: vscode.Uri) {
    let text = '';
    try { text = await fs.promises.readFile(uri.fsPath, 'utf8'); } catch { return; }   // deleted: nothing to do
    const sig = parseAgentSignal(text);
    if (!sig) return;
    const s = this.session;
    if (sig.event === 'start') {
      if ((!s || s.status === 'ended') && this.cfg().get('session.autoStartOnAgentSignal', false)) await this.start(sig.agent);
      return;
    }
    if (!s || (s.status !== 'tracking' && s.status !== 'awaiting_review')) return;
    await this.processing; await this.flush();
    if (!markCompletion(s, { kind: 'agent_signal', at: Date.now(), detail: `${sig.agent} reported that it finished a turn (signal file written by its hook).` })) return;
    this.persist(); this.host.refresh();
    this.changesReady();
    if (this.settings().auto.agentFinished && counts(s).awaiting) this.scheduleAuto('agent_signal', 800);
    else if (counts(s).total) this.announceReady(`${sig.agent} reported it finished`);
  }

  private onTick() {
    const s = this.session;
    if (!s) return;
    const st = this.settings();
    if (inactivityReached(s, st.inactivitySeconds, Date.now())
      && markCompletion(s, { kind: 'inactivity_estimate', at: Date.now(), detail: `No file has changed for ${st.inactivitySeconds} seconds.` })) {
      this.persist(); this.host.refresh();
      this.changesReady();
      if (st.auto.inactivity && counts(s).awaiting) this.scheduleAuto('inactivity', 300);
      else this.announceReady('files stopped changing (the agent may have finished)');
    }
  }
  private onSaved() {
    const s = this.session;
    if (s && this.settings().auto.save && (s.status === 'tracking' || s.status === 'awaiting_review')) this.scheduleAuto('save', 4000);
  }
  private changesReady() {
    const s = this.session;
    if (s) this.host.onChangesReady?.(effectiveChanges(s).filter((c) => c.kind !== 'deleted').map((c) => c.path));
  }
  private announceReady(why: string) {
    if (this.notifiedReady) return;
    this.notifiedReady = true;
    const c = counts(this.session!);
    void this.notify('important', `${why}. ${c.total} changed file${c.total === 1 ? '' : 's'} ready for review.`, 'Verify all changes', 'Open dashboard').then((pick) => {
      if (pick === 'Verify all changes') void this.verify('session', 'manual', true).catch((e) => this.host.onError(e));
      else if (pick === 'Open dashboard') void this.host.showSessionTab();
    });
  }
  /** Automatic runs wait for a quiet moment and never start while another run is active. */
  private scheduleAuto(trigger: Trigger, delay: number) {
    clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => {
      if (this.queue.size) return this.scheduleAuto(trigger, 1500);
      if (this.busy) { this.rerunRequested = true; return; }
      void this.verify('pending', trigger, false).catch((e) => this.host.onError(e));
    }, delay);
  }

  // ------------------------------------------------------------------ verification
  private async readText(rel: string): Promise<{ text?: string; reason?: string }> {
    const uri = this.toUri(rel);
    if (!uri) return { reason: 'outside the workspace' };
    try {
      // A link inside the workspace can point anywhere on the machine. Only files that really live in the
      // workspace are read for sending, and the sensitive-file rules are applied to the real location too.
      const real = await fs.promises.realpath(uri.fsPath);
      const realRel = await this.realRel(real);
      if (realRel === undefined) return { reason: 'symbolic link to a location outside the workspace: not sent' };
      if (isSensitive(realRel, this.rules())) return { reason: 'resolves to a file matching trustcode.session.sensitiveFiles: never sent' };
      const buf = await fs.promises.readFile(real);
      if (buf.subarray(0, 8000).includes(0)) return { reason: 'binary file: not sent' };
      const text = buf.toString('utf8');
      if (text.length > MAX_FILE_CHARS) return { reason: `larger than the ${MAX_FILE_CHARS.toLocaleString()}-character limit per file: not sent` };
      return { text };
    } catch { return { reason: 'could not be read' }; }
  }

  private async itemsForScope(scope: string, picked?: string[]): Promise<{ items: Item[]; label: string } | undefined> {
    const s = this.session;
    if (scope === 'session' || scope === 'pending' || scope === 'selected' || scope === 'failed') {
      if (!s) { vscode.window.showInformationMessage('TrustCode: no session is being tracked. Start one, or verify Git-changed files instead.'); return undefined; }
      if (s.status !== 'ended' && s.status !== 'paused') await this.rescan(false);
      let eff: EffectiveChange[] = scope === 'pending' ? awaitingVerification(s) : effectiveChanges(s);
      if (scope === 'selected') eff = eff.filter((c) => (picked ?? []).includes(c.path));
      if (scope === 'failed') {
        const last = this.latestRun();
        const failed = new Set((last?.report.files ?? []).filter((f) => (f.checks ?? []).some((c: any) => c.status === 'check_failed')).map((f) => f.path));
        eff = eff.filter((c) => failed.has(c.path));
      }
      return { items: eff.map((c) => ({ path: c.path, kind: c.kind, from: c.from })), label: `${s.agent} session` };
    }
    if (scope === 'git') {
      if (!this.useGit() || this.folders().length !== 1) {
        vscode.window.showWarningMessage('TrustCode: Git-changed files need a trusted single-folder workspace with Git available. Use a tracking session or “Choose files” instead.');
        return undefined;
      }
      const cwd = this.folders()[0].uri.fsPath;
      const status = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
      const prefix = (await git(cwd, ['rev-parse', '--show-prefix']))?.trim() ?? '';
      if (status === undefined) { vscode.window.showWarningMessage('TrustCode: this folder is not a Git repository (or Git is not installed).'); return undefined; }
      const items: Item[] = [];
      const parts = status.split('\0');
      for (let i = 0; i < parts.length; i++) {
        const e = parts[i];
        if (e.length < 4) continue;
        const xy = e.slice(0, 2), p = e.slice(3);
        let from: string | undefined;
        if (xy[0] === 'R' || xy[0] === 'C') from = parts[++i];
        if (!p.startsWith(prefix)) continue;
        const rel = p.slice(prefix.length);
        if (!trackingDecision(rel, this.rules()).track) continue;
        const kind: Item['kind'] = xy.includes('D') ? 'deleted' : xy === '??' || xy.includes('A') ? 'created' : from ? 'renamed' : 'modified';
        let baseline: string | null | undefined;
        if (kind === 'modified' || kind === 'renamed') baseline = (await git(cwd, ['show', `HEAD:${prefix}${from && kind === 'renamed' ? from.slice(prefix.length) : rel}`], 8 * 1024 * 1024)) ?? null;
        items.push({ path: rel, kind, from: from?.startsWith(prefix) ? from.slice(prefix.length) : undefined, baseline });
      }
      return { items, label: 'Git-changed files' };
    }
    const { files } = await this.listFiles();
    this.listing = files;
    if (scope === 'workspace') {
      const code = files.filter((f) => codeLanguage(f) || /(^|\/)(package\.json|pyproject\.toml|requirements[^/]*\.txt)$/.test(f));
      return { items: code.map((p) => ({ path: p, kind: 'modified' as const, baseline: null })), label: 'Entire workspace' };
    }
    return { items: (picked ?? []).filter((p) => files.includes(p)).map((p) => ({ path: p, kind: 'modified' as const, baseline: null })), label: 'Chosen files' };
  }

  latestRun(): RunRecord | undefined { return this.runs[this.runs.length - 1]; }
  shownRun(): RunRecord | undefined { return this.runs.find((r) => r.id === this.viewingRun) ?? this.latestRun(); }

  /**
   * Verifies a set of files together. `interactive: false` (automatic triggers) never opens a dialog: if
   * the server is not already approved, the run is not started and the user is told a review is ready.
   */
  async verify(scope: string, trigger: Trigger, interactive: boolean, picked?: string[]): Promise<void> {
    if (!this.gate()) return;
    if (this.busy) { if (interactive) vscode.window.setStatusBarMessage('TrustCode: a verification is already running', 3000); else this.rerunRequested = true; return; }
    this.busy = { message: 'Collecting changes…', done: 0, total: 0 };
    this.host.refresh();
    try {
      await this.verifyInner(scope, trigger, interactive, picked);
    } finally {
      this.busy = undefined;
      this.host.refresh();
      if (this.rerunRequested) { this.rerunRequested = false; this.scheduleAuto('changed_during_run', 2500); }
    }
  }

  private async verifyInner(scope: string, trigger: Trigger, interactive: boolean, picked?: string[]) {
    const st = this.settings();
    const startedAt = Date.now();
    const got = await this.itemsForScope(scope, picked);
    if (!got) return;
    let { items } = got;
    if (!items.length) {
      if (interactive) vscode.window.showInformationMessage(scope === 'selected' ? 'TrustCode: tick the files you want to verify first.' : 'TrustCode: there are no changed files to verify in this scope.');
      return;
    }
    const maxFiles = Math.max(1, this.cfg().get<number>('verification.maxFiles', 200));
    const skipped: Array<{ path: string; reason: string }> = [];
    if (items.length > maxFiles) {
      if (!interactive) { this.announceReady(`${items.length} files changed — more than trustcode.verification.maxFiles (${maxFiles})`); return; }
      const go = await vscode.window.showWarningMessage(`${items.length} files are in scope, more than your limit of ${maxFiles} (trustcode.verification.maxFiles). Verify the first ${maxFiles} (sorted by path)? The rest will be listed as not analysed.`,
        { modal: true }, `Verify ${maxFiles} files`);
      if (!go) return;
      items = [...items].sort((a, b) => a.path.localeCompare(b.path));
      for (const it of items.slice(maxFiles)) skipped.push({ path: it.path, reason: `beyond trustcode.verification.maxFiles (${maxFiles}): not sent` });
      items = items.slice(0, maxFiles);
    }
    const rules = this.rules();
    const s = this.session;
    const sessionScope = ['session', 'pending', 'selected', 'failed'].includes(scope);
    const paths = new Set(this.listing);
    const payload = new Map<string, any>();        // changed files
    const verifiedKey: Record<string, string> = {};
    for (const it of items) {
      if (isSensitive(it.path, rules)) { skipped.push({ path: it.path, reason: 'matches trustcode.session.sensitiveFiles: never sent' }); continue; }
      if (it.kind === 'deleted') {
        payload.set(it.path, { path: it.path, change: 'deleted' });
        verifiedKey[it.path] = 'deleted';
        continue;
      }
      const rec = sessionScope ? s?.changes[it.path] : undefined;
      if (rec?.current?.hash.startsWith('meta:')) { skipped.push({ path: it.path, reason: 'larger than trustcode.session.maxFileSizeKB: tracked, but not sent' }); continue; }
      const { text, reason } = await this.readText(it.path);
      if (text === undefined) { skipped.push({ path: it.path, reason: reason! }); continue; }
      const entry: any = { path: it.path, change: it.kind, content: text };
      if (it.from) entry.renamed_from = it.from;
      if (st.sendBaseline && (it.kind === 'modified' || it.kind === 'renamed')) {
        const base = it.baseline !== undefined ? it.baseline : await this.baselineText(it.from ?? it.path);
        if (typeof base === 'string' && base.length <= MAX_FILE_CHARS && !base.includes('\0')) entry.baseline = base;
      }
      payload.set(it.path, entry);
      verifiedKey[it.path] = sha(Buffer.from(text, 'utf8'));
    }
    if (!payload.size) {
      await this.finishRun({ startedAt, scope, depth: st.depth, trigger, reports: [], verifiedKey: {}, skipped, cancelled: false });
      return;
    }
    // ---- supporting files: what the changed files import, their manifests, and unchanged files that import them
    this.busy = { message: 'Finding related files…', done: 0, total: 0 };
    this.host.refresh();
    const attachText = new Map<string, { change: 'context' | 'related'; content: string }>();
    const attachFor = new Map<string, string[]>();
    const gone = new Set<string>([...items.filter((i) => i.kind === 'deleted').map((i) => i.path), ...items.filter((i) => i.from).map((i) => i.from!)]);
    const notes: string[] = [];
    if (st.includeRelated && st.depth !== 'quick') {
      const addAttach = async (owner: string, rel: string, change: 'context' | 'related') => {
        if (payload.has(rel) || isSensitive(rel, rules)) return;
        if (!attachText.has(rel)) {
          const { text } = await this.readText(rel);
          if (text === undefined) return;
          attachText.set(rel, { change, content: text });
        } else if (change === 'related') attachText.get(rel)!.change = 'related';
        attachFor.set(owner, [...new Set([...(attachFor.get(owner) ?? []), rel])]);
      };
      for (const [rel, entry] of payload) {
        if (entry.content === undefined) continue;
        for (const dep of [...localImports(rel, entry.content, paths).slice(0, 12), ...nearestManifests(rel, paths)]) await addAttach(rel, dep, 'context');
      }
      const targets = new Set([...payload.keys()].filter((p) => codeLanguage(p)));
      const candidates = this.listing.filter((p) => codeLanguage(p) && !payload.has(p));
      const SCAN_LIMIT = 4000;
      if (candidates.length > SCAN_LIMIT) notes.push(`The search for unchanged files that import the changed files covered ${SCAN_LIMIT.toLocaleString()} of ${candidates.length.toLocaleString()} source files.`);
      let related = 0;
      const firstTarget = [...payload.keys()][0];
      await this.mapLimit(candidates.slice(0, SCAN_LIMIT), 16, async (rel) => {
        if (related >= 60) return;
        const text = await this.cachedText(rel);
        if (text === undefined || !importsAnyOf(rel, text, targets, paths, gone)) return;
        related++;
        const owner = localImports(rel, text, new Set([...paths, ...gone])).find((p) => payload.has(p)) ?? firstTarget;
        await addAttach(owner, rel, 'related');
      });
      if (related >= 60) notes.push('More than 60 unchanged files import the changed files; only the first 60 were included in cross-file checks.');
    }
    // The server says how much it accepts per request (less when it analyses inside the request).
    const limits = { ...BATCH };
    const local = this.host.local();
    if (!local) try {
      const health = await this.host.api.request('GET', '/health', undefined, { auth: false });
      const lf = Number(health?.limits?.session_max_files), lc = Number(health?.limits?.session_max_chars);
      if (Number.isFinite(lf) && lf >= 1) limits.maxFiles = Math.min(limits.maxFiles, lf);
      if (Number.isFinite(lc) && lc >= 1000) limits.maxChars = Math.min(limits.maxChars, Math.floor(lc * 0.95));
    } catch { /* unreachable server: the submit below reports it */ }
    const plan = planBatches([...payload.values()].map((e) => ({ path: e.path, chars: (e.content?.length ?? 0) + (e.baseline?.length ?? 0), attach: attachFor.get(e.path) ?? [] })),
      (p) => attachText.get(p)?.content.length ?? 0, limits);
    for (const p of plan.oversized) skipped.push({ path: p, reason: 'file plus its previous version exceed the request limit: not sent' });
    const totalChars = [...payload.values()].reduce((n, e) => n + (e.content?.length ?? 0) + (e.baseline?.length ?? 0), 0);
    const withBaseline = [...payload.values()].filter((e) => e.baseline !== undefined).length;
    const ok = local ? await this.host.ensureEngine(interactive) : await this.host.consent(
      `Send ${payload.size} changed file${payload.size === 1 ? '' : 's'} (${Math.round(totalChars / 1024)} KB`
      + `${withBaseline ? `, including the previous version of ${withBaseline}` : ''}`
      + `${attachText.size ? `, plus ${attachText.size} related unchanged file${attachText.size === 1 ? '' : 's'}` : ''}) to ${this.host.backendLabel()} for verification?`
      + ' File paths of the workspace are sent as names only. Files are analysed and then deleted from the server.'
      + (skipped.length ? ` ${skipped.length} file${skipped.length === 1 ? ' is' : 's are'} not sent (sensitive, binary or too large).` : ''), interactive);
    if (!ok) { if (!interactive) this.announceReady(local ? 'changes are ready, and the local engine needs to be set up first' : 'changes are ready, and sending them needs your confirmation'); return; }
    if (!(await this.host.ensureSignedIn())) return;

    const listingChars = this.listing.reduce((n, p) => n + p.length, 0);
    const workspacePaths = this.listing.length <= 20_000 && listingChars <= 1_900_000 ? this.listing : [];
    if (!workspacePaths.length && this.listing.length) notes.push('The workspace file listing is larger than the server accepts (20,000 files or 1.9 MB of paths), so it was not sent: imports of missing files could not be detected.');
    const reports: any[] = [];
    let cancelled = false;
    const timeoutMs = Math.max(30, this.cfg().get<number>('verification.timeoutSeconds', 180)) * 1000;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'TrustCode', cancellable: true }, async (progress, token) => {
      for (let i = 0; i < plan.batches.length; i++) {
        const b = plan.batches[i];
        this.busy = { message: `Verifying ${payload.size} changed file${payload.size === 1 ? '' : 's'} (${st.depth} check)…`, done: i, total: plan.batches.length };
        this.host.refresh();
        progress.report({ message: `verifying batch ${i + 1} of ${plan.batches.length}…` });
        const files = [...b.files.map((p) => payload.get(p)), ...b.attach.map((p) => ({ path: p, change: attachText.get(p)!.change, content: attachText.get(p)!.content }))];
        try {
          if (token.isCancellationRequested) { cancelled = true; }
          else {
            const job = await this.host.api.request('POST', '/session-verifications', { files, workspace_paths: workspacePaths, depth: st.depth, label: got.label.slice(0, 200), client_consent: true },
              { timeoutMs: 90_000 });   // a server that analyses inside the request answers only when it is done
            const done = await this.host.api.waitForResult(job.id, () => token.isCancellationRequested, undefined, 400, timeoutMs);
            if (done.status === 'cancelled') cancelled = true;
            else if (done.status !== 'done') throw new ApiError(500, 'failed', done.error ?? `verification ${done.status}`);
            else reports.push(await this.host.api.request('GET', `/verifications/${job.id}/session-report`));
          }
        } catch (e) {
          // keep what was verified; say exactly what was not
          const msg = e instanceof ApiError ? e.message : String((e as any)?.message ?? e);
          for (const p of plan.batches.slice(i).flatMap((x) => x.files)) { skipped.push({ path: p, reason: `not verified: the request failed (${msg})` }); delete verifiedKey[p]; }
          this.host.onError(e);
          break;
        }
        if (cancelled) {
          for (const p of plan.batches.slice(i).flatMap((x) => x.files)) { skipped.push({ path: p, reason: 'not verified: the run was cancelled' }); delete verifiedKey[p]; }
          break;
        }
      }
    });
    for (const n of notes) skipped.push({ path: 'cross-file checks', reason: n });
    await this.finishRun({ startedAt, scope, depth: st.depth, trigger, reports, verifiedKey, skipped, cancelled });
  }

  /** Workspace-relative path of a resolved (real) file-system path, or undefined when it is outside every folder. */
  private async realRel(real: string): Promise<string | undefined> {
    for (const f of this.folders()) {
      let root = f.uri.fsPath;
      try { root = await fs.promises.realpath(root); } catch { /* keep the configured path */ }
      if (real.startsWith(root + path.sep)) return path.relative(root, real).split(path.sep).join('/');
    }
    return undefined;
  }

  private async cachedText(rel: string): Promise<string | undefined> {
    const uri = this.toUri(rel);
    if (!uri) return undefined;
    try {
      if ((await fs.promises.lstat(uri.fsPath)).isSymbolicLink()) return undefined;   // related-file search never follows links
      const st = await fs.promises.stat(uri.fsPath);
      if (st.size > 200_000) return undefined;
      const key = `${st.size}:${Math.floor(st.mtimeMs)}`;
      const hit = this.importCache.get(rel);
      if (hit?.key === key) return hit.text;
      const text = await fs.promises.readFile(uri.fsPath, 'utf8');
      if (this.importCache.size > 6000) this.importCache.clear();
      this.importCache.set(rel, { key, text });
      return text;
    } catch { return undefined; }
  }

  private async finishRun(a: { startedAt: number; scope: string; depth: string; trigger: Trigger; reports: any[]; verifiedKey: Record<string, string>; skipped: Array<{ path: string; reason: string }>; cancelled: boolean }) {
    const report = mergeReports(a.reports);
    report.depth = a.depth;
    const analysed = new Set(report.files.filter((f) => f.analysed || f.change === 'deleted').map((f) => f.path));
    const verified: Record<string, string> = {};
    for (const [p, k] of Object.entries(a.verifiedKey)) if (analysed.has(p)) verified[p] = k;
    const run: RunRecord = { id: randomBytes(6).toString('hex'), at: a.startedAt, finishedAt: Date.now(), scope: a.scope, depth: a.depth, trigger: a.trigger, report, verified, skipped: a.skipped, cancelled: a.cancelled || undefined };
    this.runs.push(run);
    this.viewingRun = undefined;
    const s = this.session;
    if (s && ['session', 'pending', 'selected', 'failed'].includes(a.scope)) {
      for (const [p, k] of Object.entries(verified)) {
        const rec = s.changes[p];
        // only mark as verified if the file still has the content that was sent
        if (rec && verificationKey(rec) === k) rec.verifiedHash = k;
      }
    }
    this.applyDiagnostics(run);
    await this.persistNow();
    this.host.refresh();
    const n = report.findings.length;
    const stale = this.outdated(run).length;
    if (stale && s && s.status !== 'ended') this.rerunRequestedIfAuto(a.trigger);
    void this.notify(a.trigger === 'manual' ? 'all' : 'important',
      `${a.cancelled ? 'run cancelled — partial result: ' : ''}${n} finding${n === 1 ? '' : 's'} in ${report.filesChanged} changed file${report.filesChanged === 1 ? '' : 's'}`
      + `${a.skipped.length ? `, ${a.skipped.length} not analysed` : ''}${stale ? ` — ${stale} file${stale === 1 ? '' : 's'} changed during the run` : ''}.`, 'Open report')
      .then((pick) => { if (pick) void this.host.showSessionTab(); });
  }
  private rerunRequestedIfAuto(trigger: Trigger) { if (trigger !== 'manual' && trigger !== 'session_end') this.rerunRequested = true; }

  /** Files of a run whose content has changed since it was read. Uses live session state where available. */
  outdated(run: RunRecord | undefined): string[] {
    if (!run) return [];
    const s = this.session;
    const sessionScope = ['session', 'pending', 'selected', 'failed'].includes(run.scope);
    if (!s || !sessionScope) return [];
    return outdatedFiles(run, (p) => { const rec = s.changes[p]; return rec ? verificationKey(rec) : undefined; })
      // a file that is no longer a session change (reverted to the baseline) is not "outdated", it is gone from the change set
      .filter((p) => !!s.changes[p]);
  }

  comparison(): RunComparison | undefined {
    const shown = this.shownRun();
    const i = shown ? this.runs.indexOf(shown) : -1;
    return i > 0 ? compareRuns(this.runs[i - 1].report, shown!.report) : undefined;
  }

  // ------------------------------------------------------------------ editor integration
  private applyDiagnostics(run: RunRecord) {
    this.diagnostics.clear();
    this.marks.clear();
    for (const f of run.report.findings) {
      const uri = this.toUri(f.path);
      if (!uri || !f.line) continue;
      const key = uri.toString();
      this.marks.set(key, [...(this.marks.get(key) ?? []), { finding: f, range: { start: f.line - 1, end: (f.endLine ?? f.line) - 1 } }]);
    }
    for (const key of this.marks.keys()) this.redraw(key);
  }
  private redraw(key: string) {
    const uri = vscode.Uri.parse(key);
    this.diagnostics.set(uri, (this.marks.get(key) ?? []).map((m) => {
      const origin = m.finding.introduced === 'new' ? 'new in this change' : m.finding.introduced === 'preexisting' ? 'already present before' : 'origin unknown';
      const d = new vscode.Diagnostic(new vscode.Range(m.range.start, 0, m.range.end, Number.MAX_SAFE_INTEGER),
        `${m.finding.title} (${m.finding.id}) — ${m.finding.message} [${origin}]`, SEV[m.finding.severity] ?? vscode.DiagnosticSeverity.Information);
      d.source = `TrustCode · ${m.finding.tool}`;
      d.code = m.finding.rule;
      return d;
    }));
  }
  private onDocumentChanged(e: vscode.TextDocumentChangeEvent) {
    if (!e.contentChanges.length) return;
    const rel = this.toRel(e.document.uri);
    // typed in an editor (the document is dirty); a reload from disk leaves it clean
    if (rel && e.document.isDirty && this.session && this.session.status !== 'ended' && this.session.status !== 'paused') {
      this.editedInEditor.add(rel);
      const rec = this.session.changes[rel];
      if (rec && !rec.editedInEditor) { rec.editedInEditor = true; this.persist(); this.host.refresh(); }
    }
    const key = e.document.uri.toString();
    let marks = this.marks.get(key);
    if (!marks?.length) return;
    for (const edit of [...e.contentChanges].sort((a, b) => b.range.start.line - a.range.start.line).map((c) => toLineEdit(c.range.start.line, c.range.start.character, c.range.end.line, c.text))) {
      marks = marks.flatMap((m) => { const r = shiftRange(m.range, edit); return r ? [{ ...m, range: r }] : []; });
    }
    this.marks.set(key, marks);
    this.redraw(key);
  }
  hoverAt(uri: vscode.Uri, line: number): vscode.Hover | undefined {
    const m = (this.marks.get(uri.toString()) ?? []).find((x) => x.range.start <= line && line <= x.range.end);
    if (!m) return undefined;
    const f = m.finding;
    const md = new vscode.MarkdownString(hoverMarkdown({ id: f.id, check: f.check, tool: f.tool, rule: f.rule, title: f.title, message: f.message, severity: f.severity, alsoReportedBy: [] },
      { why: f.why, next_step: f.nextStep, could_not_verify: f.couldNotVerify, your_feedback: f.feedbackNote ? { note: f.feedbackNote } : undefined }, 'session'));
    md.isTrusted = { enabledCommands: ['trustcode.showFinding'] };
    return new vscode.Hover(md, new vscode.Range(m.range.start, 0, m.range.end, Number.MAX_SAFE_INTEGER));
  }
  ownsDiagnostic(uri: vscode.Uri, d: vscode.Diagnostic): boolean {
    return (this.diagnostics.get(uri) ?? []).some((x) => x.message === d.message && x.range.isEqual(d.range));
  }
  finding(id: string): SessionFinding | undefined { return this.shownRun()?.report.findings.find((f) => f.id === id); }
  hasFinding(id: string): boolean { return !!this.latestRun()?.report.findings.some((f) => f.id === id); }

  async openFinding(id: string) {
    const f = this.finding(id);
    const uri = f && this.toUri(f.path);
    if (!f || !uri) return;
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const ed = await vscode.window.showTextDocument(doc, { preserveFocus: false });
      const mark = (this.marks.get(uri.toString()) ?? []).find((m) => m.finding.id === id);
      const line = Math.min(mark ? mark.range.start : (f.line ?? 1) - 1, doc.lineCount - 1);
      const range = doc.lineAt(Math.max(0, line)).range;
      ed.selection = new vscode.Selection(range.start, range.end);
      ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch { vscode.window.showInformationMessage(`TrustCode: ${f.path} can no longer be opened (it may have been deleted or renamed).`); }
  }

  /** Opens what changed in a file: a diff against the session baseline, the new file, or the removed text. */
  async openDiff(rel: string) {
    const s = this.session;
    const c = s && effectiveChanges(s).find((x) => x.path === rel);
    const uri = this.toUri(rel);
    if (!s || !c || !uri) return;
    if (c.kind === 'created') { await vscode.window.showTextDocument(uri); return; }
    const base = await this.baselineText(c.from ?? rel);
    if (base === undefined) {
      vscode.window.showInformationMessage('TrustCode: the pre-session version of this file is not available (too large to copy, or changed while tracking was paused), so no diff can be shown.');
      if (c.kind !== 'deleted') await vscode.window.showTextDocument(uri);
      return;
    }
    const left = vscode.Uri.from({ scheme: BASELINE_SCHEME, path: `/${c.from ?? rel}`, query: s.id });
    this.baselineProvider.contents.set(left.toString(), base);
    if (c.kind === 'deleted') { await vscode.window.showTextDocument(left, { preview: true }); return; }
    await vscode.commands.executeCommand('vscode.diff', left, uri, `${path.basename(rel)} (session start ↔ now)`);
  }

  fixPrompt(): string | undefined {
    const run = this.shownRun();
    return run?.report.findings.length ? buildFixPrompt(run.report.findings) : undefined;
  }

  async feedback(id: string, rating: 'helpful' | 'incorrect') {
    const f = this.finding(id);
    if (!f || !f.jobId) return;
    await this.host.api.request('POST', '/feedback', { job_id: f.jobId, finding_id: f.serverId, rating });
  }

  // ------------------------------------------------------------------ dashboard model
  model(): DashboardModel {
    const s = this.session;
    const run = this.shownRun();
    return {
      hasWorkspace: this.hasWorkspace(),
      session: s && { agent: s.agent, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, completion: s.completion, counts: counts(s),
        changes: effectiveChanges(s), skipped: s.skipped, warnings: s.warnings, baselineFiles: Object.keys(s.baseline).length, usesGit: !!s.git, recovered: !!s.recoveredAt },
      busy: this.busy, run, outdated: run === this.latestRun() ? this.outdated(run) : [], comparison: this.comparison(),
      viewingOlderRun: !!run && run !== this.latestRun(),
      history: [...this.runs].reverse().map((r) => ({ id: r.id, at: r.finishedAt, scope: r.scope, depth: r.depth, trigger: r.trigger, findings: r.report.findings.length, files: r.report.filesChanged, cancelled: r.cancelled })),
      settings: this.settings(),
    };
  }
  statusText(): string | undefined {
    const s = this.session;
    if (!s || s.status === 'ended') return undefined;
    const c = counts(s);
    if (this.busy) return '$(sync~spin) TrustCode: verifying session…';
    const icon = s.status === 'paused' ? '$(debug-pause)' : s.status === 'awaiting_review' ? '$(eye)' : '$(record)';
    return `${icon} TrustCode: ${c.total} changed${c.awaiting ? ` · ${c.awaiting} unverified` : ''}`;
  }

  async clearHistory() {
    this.runs = []; this.viewingRun = undefined; this.diagnostics.clear(); this.marks.clear();
    await this.persistNow(); this.host.refresh();
  }

  dispose() {
    this.detach();
    clearTimeout(this.saveTimer);
    this.disposables.forEach((d) => d.dispose());
  }
}
