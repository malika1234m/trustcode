// Security scan controller: starts the local scanner, shows findings at their exact ranges, and keeps the
// project scanned as files change. The scanner is a local program (trustcode-scan); nothing is uploaded.
import { ChildProcess, execFile } from 'child_process';
import * as vscode from 'vscode';
import { GroupBy, neighbour, parseReport, SecFinding, SecReport, SecurityModel, visible } from './model';

const SEV: Record<string, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Error, high: vscode.DiagnosticSeverity.Warning, medium: vscode.DiagnosticSeverity.Warning,
  low: vscode.DiagnosticSeverity.Information, info: vscode.DiagnosticSeverity.Hint,
};
const CONF: Record<string, string> = { confirmed: 'confirmed', strongly_suspected: 'strongly suspected', potential: 'needs review' };
const MODES = ['full', 'changed', 'new', 'staged', 'push', 'production'];
const IGNORED_EVENT = /(^|[\\/])(\.git|\.trustcode|node_modules|\.venv|venv|dist|build|out|__pycache__|\.next)([\\/]|$)/;

export class SecurityController implements vscode.Disposable {
  report?: SecReport;
  scanning?: { mode: string };
  error?: string;
  groupBy: GroupBy = 'severity';
  private availability: SecurityModel['availability'] = 'ready';
  private hooks?: Record<string, string>;
  private lastMode = 'full';
  private proc?: ChildProcess;
  private timer?: NodeJS.Timeout;
  private dirty = false;
  private disposables: vscode.Disposable[] = [];
  readonly diagnostics = vscode.languages.createDiagnosticCollection('trustcode-security');
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'), overviewRulerLane: vscode.OverviewRulerLane.Right,
    backgroundColor: new vscode.ThemeColor('editorWarning.background'), borderRadius: '2px',
  });

  constructor(private refresh: () => void, private status: (text: string | undefined, tooltip?: string) => void) {
    const w = vscode.workspace.createFileSystemWatcher('**/*');
    const on = (u: vscode.Uri) => this.onFileEvent(u);
    this.disposables.push(this.diagnostics, this.decoration, w, w.onDidCreate(on), w.onDidChange(on), w.onDidDelete(on),
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorate()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => { this.availability = 'ready'; this.refresh(); }));
  }

  private cfg() { return vscode.workspace.getConfiguration('trustcode'); }
  private root(): string | undefined { return vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === 'file')?.uri.fsPath; }
  private command(): string { return this.cfg().get<string>('scanner.path', 'trustcode-scan') || 'trustcode-scan'; }

  /** Runs the scanner with an argument array (never through a shell) and returns its standard output. */
  private run(args: string[], input?: string): Promise<{ code: number | null; stdout: string; stderr: string; missing: boolean }> {
    return new Promise((resolve) => {
      const child = execFile(this.command(), args, { cwd: this.root(), maxBuffer: 256 * 1024 * 1024, timeout: Math.max(60, this.cfg().get<number>('scanner.timeoutSeconds', 900)) * 1000 },
        (err: any, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : null) : 0, stdout: String(stdout), stderr: String(stderr), missing: err?.code === 'ENOENT' }));
      this.proc = child;
      if (input !== undefined) child.stdin?.end(input); else child.stdin?.end();
    });
  }

  model(): SecurityModel {
    const availability = !this.root() ? 'no-workspace' : !vscode.workspace.isTrusted ? 'untrusted' : this.availability;
    return { availability, scanning: this.scanning, report: this.report, error: this.error, groupBy: this.groupBy, automatic: this.cfg().get('scanner.automatic', true),
      scannerCommand: this.command(), hooks: this.hooks, online: this.cfg().get('scanner.onlineAdvisories', false) };
  }

  /** `paths`: scan exactly these workspace-relative files (used for AI-session change sets). */
  async scan(mode: string, opts: { noCache?: boolean; paths?: string[]; quiet?: boolean } = {}): Promise<SecReport | undefined> {
    if (!MODES.includes(mode) || !this.root() || !vscode.workspace.isTrusted) { this.refresh(); return undefined; }
    if (this.scanning) { this.dirty = true; return undefined; }
    this.scanning = { mode };
    this.error = undefined;
    this.lastMode = mode;
    this.status('$(sync~spin) TrustCode: scanning…', 'Security scan running');
    this.refresh();
    const args = ['--format', 'json', '--mode', opts.paths ? 'changed' : mode];
    if (opts.noCache) args.push('--no-cache');
    if (opts.paths) args.push('--paths-from', '-');
    if (this.cfg().get('scanner.onlineAdvisories', false)) args.push('--online');
    if (this.cfg().get('scanner.scanGitHistory', false) && (mode === 'full' || mode === 'production')) args.push('--history');
    try {
      const r = await this.run(args, opts.paths?.join('\n'));
      if (r.missing) { this.availability = 'missing'; this.report = undefined; this.clearMarks(); return undefined; }
      this.availability = 'ready';
      if (r.code === null && !r.stdout) { this.error = 'The scan was cancelled or timed out. No result is shown.'; return undefined; }
      const report = parseReport(r.stdout);
      if (!report) {
        // never show a previous or partial result as if this scan had succeeded
        this.error = `The scanner did not return a readable report, so this scan has NO result. ${r.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`;
        return undefined;
      }
      // a scan limited to some files must not wipe the findings of files it did not look at
      this.report = opts.paths && this.report ? this.merge(this.report, report, opts.paths) : report;
      this.mark();
      void this.loadHooks();
      const n = visible(this.report).length;
      if (!opts.quiet) {
        const head = report.gate.decision === 'block' ? 'BLOCK' : report.status !== 'complete' ? 'scan INCOMPLETE' : `${n} finding${n === 1 ? '' : 's'}`;
        vscode.window.setStatusBarMessage(`TrustCode security: ${head} (${report.files.scanned} files, ${(report.durationMs / 1000).toFixed(1)} s)`, 6000);
      }
      return report;
    } finally {
      this.scanning = undefined;
      this.proc = undefined;
      this.updateStatus();
      this.refresh();
      if (this.dirty) { this.dirty = false; this.schedule(); }
    }
  }

  private merge(prev: SecReport, part: SecReport, paths: string[]): SecReport {
    const touched = new Set(paths);
    return { ...part, mode: prev.mode, files: { ...prev.files, fromCache: prev.files.fromCache },
      findings: [...prev.findings.filter((f) => !touched.has(f.path)), ...part.findings],
      baseline: prev.baseline, gate: prev.gate, notes: [...new Set([...prev.notes, ...part.notes])] };
  }

  cancel() { this.proc?.kill(); }
  rescan() { return this.scan(this.lastMode, { noCache: true }); }

  private updateStatus() {
    const r = this.report;
    if (!r) return this.status(this.availability === 'missing' ? '$(warning) TrustCode: scanner not installed' : undefined, 'Open the Security tab');
    const c = visible(r);
    const crit = c.filter((f) => f.severity === 'critical').length, high = c.filter((f) => f.severity === 'high').length;
    this.status(`${r.status !== 'complete' ? '$(warning)' : crit || high ? '$(shield)' : '$(shield)'} TrustCode: ${crit} critical · ${high} high${r.status !== 'complete' ? ' · scan incomplete' : ''}`,
      `Security scan: ${c.length} finding(s) in ${r.files.scanned} file(s). Click to open. This is not a statement that the project is secure.`);
  }

  // ------------------------------------------------------------------ exact highlighting
  private uri(rel: string): vscode.Uri | undefined { const root = this.root(); return root ? vscode.Uri.joinPath(vscode.Uri.file(root), ...rel.split('/')) : undefined; }
  private range(f: SecFinding): vscode.Range {
    if (f.fileLevel) return new vscode.Range(0, 0, 0, 0);
    const endCol = f.endLine === f.line && f.endCol <= f.col ? Number.MAX_SAFE_INTEGER : Math.max(0, f.endCol - 1);
    return new vscode.Range(f.line - 1, Math.max(0, f.col - 1), f.endLine - 1, endCol);
  }
  private mark() {
    this.diagnostics.clear();
    const by = new Map<string, vscode.Diagnostic[]>();
    for (const f of this.report ? visible(this.report) : []) {
      const uri = this.uri(f.path);
      if (!uri) continue;
      const d = new vscode.Diagnostic(this.range(f), `${f.title} — ${f.reason} [${CONF[f.confidence] ?? f.confidence}${f.fileLevel ? ', file-level' : ''}]`, SEV[f.severity]);
      d.source = 'TrustCode security';
      d.code = f.ruleId;
      by.set(uri.toString(), [...(by.get(uri.toString()) ?? []), d]);
    }
    for (const [k, v] of by) this.diagnostics.set(vscode.Uri.parse(k), v);
    this.decorate();
  }
  private decorate() {
    for (const ed of vscode.window.visibleTextEditors) {
      const ranges = (this.diagnostics.get(ed.document.uri) ?? []).filter((d) => !d.range.isEmpty).map((d) => d.range);
      ed.setDecorations(this.decoration, ranges);
    }
  }
  private clearMarks() { this.diagnostics.clear(); for (const ed of vscode.window.visibleTextEditors) ed.setDecorations(this.decoration, []); }

  async open(fingerprint: string): Promise<void> {
    const f = this.report?.findings.find((x) => x.fingerprint === fingerprint);
    const uri = f && this.uri(f.path);
    if (!f || !uri) return;
    try {
      const ed = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preserveFocus: false });
      const r = ed.document.validateRange(this.range(f));
      ed.selection = new vscode.Selection(r.start, r.isEmpty ? r.start : r.end);
      ed.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch { vscode.window.showInformationMessage(`TrustCode: ${f.path} can no longer be opened. Rescan to refresh the findings.`); }
  }

  async step(dir: 1 | -1): Promise<void> {
    if (!this.report) return;
    const ed = vscode.window.activeTextEditor;
    const root = this.root();
    const rel = ed && root && ed.document.uri.fsPath.startsWith(root) ? ed.document.uri.fsPath.slice(root.length + 1).split(/[\\/]/).join('/') : undefined;
    const next = neighbour(visible(this.report), rel ? { path: rel, line: ed!.selection.active.line + 1, col: ed!.selection.active.character + 1 } : undefined, dir);
    if (next) await this.open(next.fingerprint); else vscode.window.setStatusBarMessage('TrustCode: no security findings to step through', 3000);
  }

  // ------------------------------------------------------------------ review, baseline, hooks
  async review(fingerprint: string): Promise<void> {
    const f = this.report?.findings.find((x) => x.fingerprint === fingerprint);
    if (!f) return;
    const reason = await vscode.window.showInputBox({ prompt: `Why is "${f.title}" at ${f.path}:${f.line} a false positive? (recorded in .trustcode/reviewed.json)`,
      validateInput: (v) => (v.trim().length >= 8 ? undefined : 'Give a reason of at least 8 characters'), ignoreFocusOut: true });
    if (!reason) return;
    const r = await this.run(['review', fingerprint, '--reason', reason]);
    if (r.code !== 0) { vscode.window.showErrorMessage(`TrustCode: the review could not be recorded. ${r.stderr.trim().slice(0, 200)}`); return; }
    await this.scan(this.lastMode, { quiet: true });
  }

  async baseline(): Promise<void> {
    const ok = await vscode.window.showWarningMessage('Run a full scan and record its findings as the baseline? Existing findings stay visible in every report; later scans show which findings are new.',
      { modal: true }, 'Set baseline');
    if (ok !== 'Set baseline') return;
    const r = await this.run(['baseline', '--format', 'json']);
    if (r.missing) { this.availability = 'missing'; this.refresh(); return; }
    await this.scan('full', { quiet: true });
  }

  /** Opens the project's scanner policy file (rules to disable, exclusions, blocking thresholds), creating it with the defaults first. */
  async editConfig(): Promise<void> {
    const root = this.root();
    if (!root) return;
    const uri = vscode.Uri.joinPath(vscode.Uri.file(root), '.trustcode', 'config.json');
    try { await vscode.workspace.fs.stat(uri); } catch {
      const r = await this.run(['config']);
      if (r.missing || r.code !== 0) { this.availability = r.missing ? 'missing' : this.availability; this.refresh(); return; }
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(vscode.Uri.file(root), '.trustcode'));
      await vscode.workspace.fs.writeFile(uri, Buffer.from(r.stdout, 'utf8'));
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    vscode.window.showInformationMessage('TrustCode: "disabled_rules" takes rule IDs, "exclude" takes path patterns. Save, then rescan. Rule IDs are listed with: trustcode-scan rules');
  }

  private async loadHooks() {
    const r = await this.run(['hooks', 'status']);
    try {
      const d = JSON.parse(r.stdout);
      this.hooks = d.git ? Object.fromEntries(Object.entries(d.hooks).map(([k, v]: [string, any]) => [k, String(v.state)])) : { git: 'not a Git repository — hooks are not available, full-project scans are' };
      this.refresh();
    } catch { /* status is optional */ }
  }

  async installHooks(): Promise<void> {
    const ok = await vscode.window.showWarningMessage('Install Git pre-commit and pre-push hooks that run trustcode-scan? An existing hook is never replaced: you get the line to add to it instead.',
      { modal: true }, 'Install hooks');
    if (ok !== 'Install hooks') return;
    const r = await this.run(['hooks', 'install']);
    const text = `${r.stdout}\n${r.stderr}`.trim();
    await this.loadHooks();
    if (r.code === 0) vscode.window.showInformationMessage(`TrustCode: ${text.replace(/\n/g, ' · ').slice(0, 300)}`);
    else await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'markdown', content: `# Git hooks were not (all) installed\n\n\`\`\`\n${text}\n\`\`\`\n` }));
  }

  // ------------------------------------------------------------------ automatic scanning
  private onFileEvent(u: vscode.Uri) {
    if (u.scheme !== 'file' || IGNORED_EVENT.test(u.fsPath) || !this.cfg().get('scanner.automatic', true) || this.availability !== 'ready') return;
    this.schedule();
  }
  /** One scan after changes have been quiet for a few seconds; a burst of writes by an agent is one batch. */
  private schedule() {
    clearTimeout(this.timer);
    const wait = Math.max(2, this.cfg().get<number>('scanner.settleSeconds', 5)) * 1000;
    this.timer = setTimeout(() => {
      if (!this.report) return;   // automatic scans start after the first scan the user asked for
      if (this.scanning) { this.dirty = true; return; }
      void this.scan(this.lastMode === 'production' ? 'full' : this.lastMode === 'staged' || this.lastMode === 'push' ? 'full' : this.lastMode, { quiet: true });
    }, wait);
  }

  dispose() { clearTimeout(this.timer); this.proc?.kill(); this.disposables.forEach((d) => d.dispose()); }
}
