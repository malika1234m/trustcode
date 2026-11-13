// The local engine on this machine: finds or installs it, and runs requests against it.
//
// The engine is the Python package shipped inside this extension (engine/*.whl). TrustCode installs it into a
// private virtual environment in VS Code's storage - only after the user agrees, because installing downloads
// its dependencies from PyPI. The engine is never looked up in, or started from, the workspace folder, and the
// code to analyse is passed to it as data on standard input.
import { execFile, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ApiError } from '../api';
import { EngineRunner } from './local';

export type EngineStatus = 'ready' | 'missing' | 'installing' | 'failed';
export interface EngineInfo { status: EngineStatus; managed: boolean; python?: string; detail?: string; version?: string }

import { MIN_PYTHON, parseAnswer, parsePythonVersion, pythonOk, TOOL_PACKAGES, venvPaths } from './util';

export class EngineManager implements EngineRunner {
  private installing?: Promise<boolean>;
  private failure?: string;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private ctx: vscode.ExtensionContext, readonly log: vscode.OutputChannel) {}

  private cfg() { return vscode.workspace.getConfiguration('trustcode'); }
  private home() { return path.join(this.ctx.globalStorageUri.fsPath, 'engine'); }
  private outsideWorkspace(p: string) {
    return !(vscode.workspace.workspaceFolders ?? []).some((f) => f.uri.scheme === 'file' && (p === f.uri.fsPath || p.startsWith(f.uri.fsPath + path.sep)));
  }
  private isFile(p: string) { try { return path.isAbsolute(p) && fs.statSync(p).isFile(); } catch { return false; } }

  /** The engine package shipped with this extension version. */
  wheel(): string | undefined {
    try {
      const dir = path.join(this.ctx.extensionPath, 'engine');
      const name = fs.readdirSync(dir).filter((f) => /^trustcode_worker-[\w.]+-py3-none-any\.whl$/.test(f)).sort().pop();
      return name ? path.join(dir, name) : undefined;
    } catch { return undefined; }
  }
  private wheelId(): string | undefined {
    const w = this.wheel();
    if (!w) return undefined;
    try { return crypto.createHash('sha256').update(fs.readFileSync(w)).digest('hex').slice(0, 16); } catch { return undefined; }
  }
  private venvDir() { return path.join(this.home(), `venv-${this.wheelId() ?? 'none'}`); }
  private marker() { return path.join(this.venvDir(), 'trustcode-engine.json'); }

  /** An interpreter the user configured (it must already have the engine installed); application-scoped setting. */
  private configured(): string | undefined {
    const p = (this.cfg().get<string>('engine.pythonPath', '') || '').trim();
    return p && this.isFile(p) && this.outsideWorkspace(p) ? p : undefined;
  }
  /** Interpreter that runs the engine, or undefined when the engine is not installed. */
  python(): string | undefined {
    const own = this.configured();
    if (own) return own;
    const v = venvPaths(this.venvDir());
    return fs.existsSync(this.marker()) && this.isFile(v.python) ? v.python : undefined;
  }
  /** The security scanner that belongs to the engine (same environment). */
  scanner(): string | undefined {
    const py = this.python();
    if (!py) return undefined;
    const s = path.join(path.dirname(py), process.platform === 'win32' ? 'trustcode-scan.exe' : 'trustcode-scan');
    return this.isFile(s) ? s : undefined;
  }
  info(): EngineInfo {
    const py = this.python();
    const managed = !this.configured();
    if (this.installing) return { status: 'installing', managed };
    if (py) return { status: 'ready', managed, python: py, version: this.readMarker()?.engine };
    const bad = (this.cfg().get<string>('engine.pythonPath', '') || '').trim();
    if (bad) return { status: 'failed', managed: false, detail: `The interpreter set in trustcode.engine.pythonPath was not found or is inside the workspace: ${bad}` };
    return this.failure ? { status: 'failed', managed, detail: this.failure } : { status: 'missing', managed };
  }
  private readMarker(): any { try { return JSON.parse(fs.readFileSync(this.marker(), 'utf8')); } catch { return undefined; } }

  private exec(file: string, args: string[], timeoutMs: number, token?: vscode.CancellationToken): Promise<{ code: number | null; out: string }> {
    return new Promise((resolve) => {
      fs.mkdirSync(this.home(), { recursive: true });
      const child = spawn(file, args, { cwd: this.home(), env: this.env(path.dirname(file)), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const take = (b: Buffer) => { const s = b.toString(); out = (out + s).slice(-20000); this.log.append(s); };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      const timer = setTimeout(() => child.kill(), timeoutMs);
      const sub = token?.onCancellationRequested(() => child.kill());
      const end = (code: number | null) => { clearTimeout(timer); sub?.dispose(); resolve({ code, out }); };
      child.on('error', (e) => { out += String(e); end(null); });
      child.on('close', (code) => end(code));
    });
  }
  /** The engine's tools sit next to its interpreter; that directory goes first so they are the ones found. */
  private env(binDir: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: [binDir, ...(process.env.PATH ?? '').split(path.delimiter).filter((d) => d && path.isAbsolute(d) && this.outsideWorkspace(d))].join(path.delimiter),
      PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_INPUT: '1', PYTHONDONTWRITEBYTECODE: '1' };
    for (const k of Object.keys(env)) if (/^(PYTHONPATH|PYTHONHOME|PYTHONSTARTUP|VIRTUAL_ENV|PIP_CONFIG_FILE|PIP_INDEX_URL|PIP_EXTRA_INDEX_URL)$/.test(k)) delete env[k];
    return env;
  }

  /** A Python new enough to host the engine: the configured one, else the first suitable one on PATH. */
  async findPython(): Promise<{ path: string; version: string } | undefined> {
    const names = process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3.13', 'python3.12', 'python3.11', 'python3.14', 'python3', 'python'];
    const base = (this.cfg().get<string>('engine.basePython', '') || '').trim();
    const cands: string[] = base ? [base] : [];
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      if (!dir || !path.isAbsolute(dir)) continue;
      for (const n of names) cands.push(path.join(dir, n));
    }
    if (process.platform !== 'win32') for (const d of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) for (const n of names) cands.push(path.join(d, n));
    const seen = new Set<string>();
    for (const c of cands) {
      if (seen.has(c) || !this.isFile(c) || !this.outsideWorkspace(c)) continue;
      seen.add(c);
      const v = await new Promise<string>((resolve) => execFile(c, ['-I', '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { timeout: 15000, cwd: path.dirname(c) },
        (err, stdout) => resolve(err ? '' : String(stdout))));
      if (pythonOk(parsePythonVersion(v))) return { path: c, version: v.trim() };
    }
    return undefined;
  }

  /** Makes sure the engine can run. Asks before installing; never installs when `interactive` is false. */
  async ensure(interactive: boolean): Promise<boolean> {
    if (this.python()) return true;
    if (this.installing) return this.installing;
    if (!interactive || this.configured() || (this.cfg().get<string>('engine.pythonPath', '') || '').trim()) return false;
    const choice = await vscode.window.showInformationMessage(
      'Set up TrustCode\'s local engine?',
      { modal: true, detail: 'TrustCode checks your code on this computer; the code is not uploaded.\n\nSetting up creates a private Python environment inside VS Code\'s storage and downloads the analysis tools from PyPI '
        + '(pydantic, tree-sitter, Ruff, Pyflakes, mypy, Bandit, Semgrep: about 300 MB, a few minutes). Nothing is installed into your project or your system Python. Needs Python 3.11 or newer.' },
      'Set up');
    return choice === 'Set up' ? this.install() : false;
  }

  install(): Promise<boolean> {
    if (this.installing) return this.installing;
    const run = Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'TrustCode engine', cancellable: true },
      (progress, token) => this.doInstall(progress, token))).then((ok) => ok, (e) => { this.failure = String(e?.message ?? e); return false; })
      .then((ok) => { this.installing = undefined; this.changed.fire(); return ok; });
    this.installing = run;
    this.changed.fire();
    return run;
  }

  private async doInstall(progress: vscode.Progress<{ message?: string }>, token: vscode.CancellationToken): Promise<boolean> {
    this.failure = undefined;
    const fail = (msg: string) => {
      this.failure = msg;
      this.log.appendLine(`\nSetup failed: ${msg}`);
      void vscode.window.showErrorMessage(`TrustCode engine setup failed: ${msg}`, 'Show log').then((c) => { if (c) this.log.show(); });
      return false;
    };
    const wheel = this.wheel();
    if (!wheel) return fail('this build of the extension does not contain the engine package.');
    progress.report({ message: 'looking for Python…' });
    const py = await this.findPython();
    if (!py) return fail(`Python ${MIN_PYTHON.join('.')} or newer was not found. Install it from python.org (or set trustcode.engine.basePython) and try again.`);
    const dir = this.venvDir();
    const v = venvPaths(dir);
    this.log.appendLine(`Setting up the TrustCode engine with ${py.path} (Python ${py.version}) in ${dir}`);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* created below */ }
    const step = async (message: string, file: string, args: string[], timeoutMs: number) => {
      progress.report({ message });
      this.log.appendLine(`\n> ${message}`);
      const r = await this.exec(file, args, timeoutMs, token);
      return r.code === 0;
    };
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* nothing to remove */ } };
    if (!(await step('creating a private environment…', py.path, ['-I', '-m', 'venv', dir], 180_000))) { cleanup(); return token.isCancellationRequested ? false : fail('the Python environment could not be created (is the venv module installed?).'); }
    if (!(await step('installing the engine…', v.python, ['-I', '-m', 'pip', 'install', '--no-input', wheel], 600_000))) { cleanup(); return token.isCancellationRequested ? false : fail('the engine package could not be installed (is PyPI reachable?).'); }
    const skipped: string[] = [];
    for (const [i, spec] of TOOL_PACKAGES.entries()) {
      if (token.isCancellationRequested) { cleanup(); return false; }
      const name = spec.split(/[<>=]/)[0];
      if (!(await step(`installing ${name} (${i + 1} of ${TOOL_PACKAGES.length})…`, v.python, ['-I', '-m', 'pip', 'install', '--no-input', spec], 900_000))) skipped.push(name);
    }
    if (token.isCancellationRequested) { cleanup(); return false; }
    progress.report({ message: 'checking the engine…' });
    fs.writeFileSync(this.marker(), JSON.stringify({ wheel: path.basename(wheel), basePython: py.path, installedAt: new Date().toISOString(), skipped }));
    let doc: any;
    try { doc = await this.run({ op: 'doctor' }, { timeoutMs: 120_000 }); } catch (e: any) { cleanup(); return fail(`the installed engine did not start: ${e?.message ?? e}`); }
    fs.writeFileSync(this.marker(), JSON.stringify({ wheel: path.basename(wheel), basePython: py.path, installedAt: new Date().toISOString(), skipped, engine: doc.engine, python: doc.python }));
    // older engine environments belong to previous extension versions
    try { for (const d of fs.readdirSync(this.home())) if (d.startsWith('venv-') && path.join(this.home(), d) !== dir) fs.rmSync(path.join(this.home(), d), { recursive: true, force: true }); } catch { /* best effort */ }
    this.log.appendLine(`\nEngine ready: ${doc.engine}, Python ${doc.python}.${skipped.length ? ` Not installed: ${skipped.join(', ')} (the checks that need them will say so).` : ''}`);
    if (skipped.length) void vscode.window.showWarningMessage(`TrustCode engine is set up, but ${skipped.join(', ')} could not be installed. Checks that need ${skipped.length === 1 ? 'it' : 'them'} will be reported as not run.`, 'Show log').then((c) => { if (c) this.log.show(); });
    return true;
  }

  /** Removes the managed environment (not an interpreter the user configured). */
  async remove() {
    try { fs.rmSync(this.home(), { recursive: true, force: true }); } catch { /* already gone */ }
    this.failure = undefined;
    this.changed.fire();
  }

  run(req: Record<string, unknown>, opts: { timeoutMs?: number; onStart?: (kill: () => void) => void } = {}): Promise<any> {
    const py = this.python() ?? (fs.existsSync(this.marker()) ? venvPaths(this.venvDir()).python : undefined);
    if (!py) return Promise.reject(new ApiError(0, 'engine_missing', 'The local engine is not set up.'));
    return new Promise((resolve, reject) => {
      fs.mkdirSync(this.home(), { recursive: true });
      // -I: isolated mode (no user site-packages, no PYTHON* variables, the working directory is not importable)
      const child = spawn(py, ['-I', '-m', 'trustcode_worker.local'], { cwd: this.home(), env: this.env(path.dirname(py)), stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '', killed = false;
      child.stdout.on('data', (b: Buffer) => { out += b.toString(); });
      child.stderr.on('data', (b: Buffer) => { err = (err + b.toString()).slice(-4000); });
      const kill = () => { killed = true; child.kill(); };
      const timer = setTimeout(kill, opts.timeoutMs ?? 300_000);
      opts.onStart?.(kill);
      child.on('error', (e) => { clearTimeout(timer); reject(new ApiError(0, 'engine', `The local engine could not be started: ${e.message}`)); });
      child.on('close', () => {
        clearTimeout(timer);
        const answer = parseAnswer(out);
        if (answer?.ok) return resolve(answer);
        if (killed) return reject(new ApiError(0, 'engine_stopped', 'The analysis was stopped before it finished. No result is shown.'));
        const why = answer?.error ?? (err.trim().split('\n').pop() || 'no answer');
        this.log.appendLine(`Engine request ${String(req.op)} failed: ${why}\n${err}`);
        reject(new ApiError(500, 'engine', `The local engine could not complete the analysis (${String(why).slice(0, 300)}). No result is shown.`));
      });
      child.stdin.on('error', () => undefined);   // the process ended before reading: reported by 'close'
      child.stdin.end(JSON.stringify(req));
    });
  }
}
