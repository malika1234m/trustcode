// Local-engine scenarios inside a real VS Code. No TrustCode server exists in these runs (the configured
// address refuses connections), so anything that works here works without the network.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type R = { name: string; ok: boolean; ms: number; err?: string };
const SQLI = 'import sqlite3\ndef find(conn, name):\n    return conn.execute(f"SELECT * FROM u WHERE n = \'{name}\'").fetchall()\n';

function harness(hook: any) {
  const results: R[] = [];
  const t = async (name: string, fn: () => Promise<void>) => {
    const t0 = Date.now();
    try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
    catch (e: any) { results.push({ name, ok: false, ms: Date.now() - t0, err: e?.message }); console.log(`  FAIL ${name}: ${e?.message}`); }
  };
  const { view } = hook;
  const html: string[] = [];
  const origRender = view.render.bind(view);
  view.render = (h: string) => { html.push(h); origRender(h); };
  const errors: string[] = [];
  const origErr = view.error.bind(view);
  view.error = (e: unknown) => { errors.push(String((e as any)?.message ?? e)); origErr(e); };
  const cfg = () => vscode.workspace.getConfiguration('trustcode');
  const set = (k: string, v: unknown) => cfg().update(k, v, vscode.ConfigurationTarget.Global);
  const verify = async (code: string, lang = 'python') => {
    const doc = await vscode.workspace.openTextDocument({ language: lang, content: code });
    const ed = await vscode.window.showTextDocument(doc);
    ed.selection = new vscode.Selection(0, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length);
    view.jobId = undefined;
    await view.verify('', undefined, { force: true }).catch((e: unknown) => view.error(e));
    return doc;
  };
  return { results, t, view, html, errors, set, verify, last: () => html[html.length - 1] ?? '' };
}

export async function runEngineScenarios(hook: any, enginePy: string): Promise<R[]> {
  const { results, t, view, errors, set, verify, last } = harness(hook);
  await set('mode', 'account'); await set('analysis.location', 'local'); await set('engine.pythonPath', enginePy);
  await set('backendUrl', 'http://127.0.0.1:9'); await set('showExplanations', true);
  await view.refreshAuth();

  await t('local: a verification makes no network request and needs no account', async () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    (globalThis as any).fetch = (u: any, ...rest: any[]) => { calls.push(String(u)); return (realFetch as any)(u, ...rest); };
    try {
      const doc = await verify(SQLI);
      assert.match(last(), /SQL injection risk/);
      assert.ok(vscode.languages.getDiagnostics(doc.uri).some((d) => d.source === 'TrustCode' || /SEC-/.test(String(d.message))), 'finding not shown in the editor');
      assert.deepStrictEqual(calls, [], `network requests during a local verification: ${calls.join(', ')}`);
      assert.strictEqual(await hook.ctx.secrets.get('trustcode.tokens:http://127.0.0.1:9'), undefined, 'no account exists in this run');
    } finally { (globalThis as any).fetch = realFetch; }
  });

  await t('local: marking a rule wrong twice adds a note, and the finding is still reported', async () => {
    await verify(SQLI);
    const id = (last().match(/data-finding="((?:SEC)-\d+)"/) ?? [])[1] ?? 'SEC-1';
    for (let i = 0; i < 2; i++) await view.onMessage({ action: 'feedback', finding: id, rating: 'incorrect' });
    await view.showExplanation();
    assert.match(last(), /marked findings from this rule as wrong 2 times/);
    assert.match(last(), /SQL injection risk/);
  });

  await t('local: account tab states where checks run and that nothing goes to the server', async () => {
    await view.onMessage({ action: 'tab', tab: 'account' });
    assert.match(last(), /On this computer/);
    assert.match(last(), /Code sent to the TrustCode server[\s\S]{0,400}Never/);
    assert.match(last(), /Kept on this computer \(\d+ runs, \d+ ratings\)/);
    assert.doesNotMatch(last(), /data-key="allow_llm"/);
  });

  await t('local: the security scanner comes from the same engine environment', async () => {
    const expected = path.join(path.dirname(enginePy), process.platform === 'win32' ? 'trustcode-scan.exe' : 'trustcode-scan');
    assert.strictEqual(view.engine.scanner(), expected);
  });

  await t('local: deleting local data empties history, feedback and results', async () => {
    assert.ok(view.local.counts().runs > 0);
    view.local.clear();
    assert.deepStrictEqual(view.local.counts(), { runs: 0, feedback: 0 });
    await view.onMessage({ action: 'tab', tab: 'history' });
    assert.match(last(), /No verifications yet/);
  });

  await t('local: an interpreter that is not the engine gives an error and no result', async () => {
    await set('engine.pythonPath', process.platform === 'win32' ? process.execPath : '/bin/echo');
    const n = errors.length;
    const doc = await verify('def g():\n    return eval("1")\n');
    await set('engine.pythonPath', enginePy);
    assert.ok(errors.length > n, 'no error was shown');
    assert.match(errors[errors.length - 1], /No result is shown/);
    assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 0, 'findings were shown for a run that failed');
    assert.doesNotMatch(last(), /class="headline /, 'a result page was rendered for a failed run');
  });

  await t('local: a missing configured interpreter is reported, never silently replaced', async () => {
    await set('engine.pythonPath', '/nonexistent/python');
    const info = view.engine.info();
    await set('engine.pythonPath', enginePy);
    assert.strictEqual(info.status, 'failed');
    assert.match(info.detail, /not found/);
  });

  await t('local: without an engine nothing is checked and the setup card is shown', async () => {
    await set('engine.pythonPath', undefined);
    assert.strictEqual(view.engine.info().status, 'missing', 'this test profile must not contain a managed engine');
    const asked: boolean[] = [];
    const orig = view.engine.ensure.bind(view.engine);
    view.engine.ensure = async (interactive: boolean) => { asked.push(interactive); return false; };   // the user declines the setup dialog
    try {
      const doc = await verify('def g():\n    return eval("1")\n');
      assert.deepStrictEqual(asked, [true], 'setup must be offered exactly once, interactively');
      assert.strictEqual(vscode.languages.getDiagnostics(doc.uri).length, 0);
      assert.match(last(), /Set up the local engine/);
      assert.match(last(), /nothing is checked/i);
    } finally { view.engine.ensure = orig; await set('engine.pythonPath', enginePy); }
  });

  await t('switching to the server asks for an account again and sends nothing by itself', async () => {
    await set('analysis.location', 'server');
    const usable = await view.refreshAuth();
    const who = view.who();
    await set('analysis.location', 'local');
    assert.strictEqual(usable, false, 'server analysis must need an account');
    assert.strictEqual(who, 'Signed out');
    assert.strictEqual(await view.refreshAuth(), true);
    assert.strictEqual(view.who(), 'On this device');
  });
  return results;
}

/** Really installs the engine the way a user does (private environment + PyPI downloads) and uses it. */
export async function runEngineInstall(hook: any): Promise<R[]> {
  const { results, t, view, errors, set, verify, last } = harness(hook);
  await set('mode', 'account'); await set('analysis.location', 'local'); await set('engine.pythonPath', undefined);
  await set('backendUrl', 'http://127.0.0.1:9');
  await view.refreshAuth();

  await t('install: the extension contains the engine package', async () => {
    assert.ok(view.engine.wheel() && fs.statSync(view.engine.wheel()).size > 50_000, 'engine wheel missing: run `npm run bundle-engine`');
    assert.strictEqual(view.engine.info().status, 'missing');
  });
  await t('install: setup creates a private environment outside the workspace and the engine answers', async () => {
    const ok = await view.engine.install();
    assert.ok(ok, `setup failed: ${view.engine.info().detail}`);
    const info = view.engine.info();
    assert.strictEqual(info.status, 'ready');
    assert.ok(info.managed && info.python.startsWith(hook.ctx.globalStorageUri.fsPath), `engine not in extension storage: ${info.python}`);
    const d = await view.engine.run({ op: 'doctor' }, { timeoutMs: 120000 });
    console.log(`       engine: ${d.engine}, Python ${d.python}; not available: ${d.missing.join(', ') || 'nothing'}`);
    assert.strictEqual(d.package, '1.0.0');
    for (const tool of ['ruff', 'semgrep', 'mypy', 'pyflakes', 'tree-sitter']) assert.ok(d.tools[tool].available, `${tool} is not available in the installed engine`);
  });
  await t('install: Python and TypeScript are verified with the installed engine', async () => {
    const n = errors.length;
    await verify(SQLI);
    assert.match(last(), /SQL injection risk/);
    await verify('export function run(cmd: string) { return eval(cmd); }\n', 'typescript');
    assert.match(last(), /eval/i);
    assert.strictEqual(errors.length, n, errors.slice(n).join(' | '));
  });
  await t('install: the installed scanner starts', async () => {
    const scanner = view.engine.scanner();
    assert.ok(scanner && fs.existsSync(scanner), 'trustcode-scan was not installed with the engine');
    const out = require('child_process').execFileSync(scanner, ['tools'], { encoding: 'utf8', timeout: 60000, cwd: path.dirname(scanner) });
    assert.ok(JSON.parse(out), 'scanner did not answer');
  });
  await t('install: removing the engine leaves nothing behind and checks stop', async () => {
    const dir = path.join(hook.ctx.globalStorageUri.fsPath, 'engine');
    await view.engine.remove();
    assert.ok(!fs.existsSync(dir), 'engine files were left behind');
    assert.strictEqual(view.engine.info().status, 'missing');
  });
  return results;
}
