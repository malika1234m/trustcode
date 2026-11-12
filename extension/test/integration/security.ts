// Project security scanner inside a real VS Code window, with the real local scanner (no backend needed).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type R = { name: string; ok: boolean; ms: number; err?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSecurityScenarios(hook: any, scanner: string): Promise<R[]> {
  const results: R[] = [];
  const t = async (name: string, fn: () => Promise<void>) => {
    const t0 = Date.now();
    try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
    catch (e: any) { results.push({ name, ok: false, ms: Date.now() - t0, err: e?.message }); console.log(`  FAIL ${name}: ${e?.message}`); }
  };
  const { view, security } = hook;
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const abs = (rel: string) => path.join(root, ...rel.split('/'));
  const write = (rel: string, text: string) => { fs.mkdirSync(path.dirname(abs(rel)), { recursive: true }); fs.writeFileSync(abs(rel), text); };
  const until = async (cond: () => boolean, what: string, ms = 40000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(150); } };
  const cfg = () => vscode.workspace.getConfiguration('trustcode');
  const set = (k: string, v: unknown) => cfg().update(k, v, vscode.ConfigurationTarget.Global);
  const html: string[] = [];
  const orig = view.render.bind(view);
  view.render = (h: string) => { html.push(h); orig(h); };
  const found = (rule: string, file?: string) => (security.report?.findings ?? []).filter((f: any) => f.ruleId === rule && (!file || f.path === file));
  const SQLI = 'from flask import request\n\ndef find(conn):\n    name = request.args.get("name")\n    return conn.execute("SELECT * FROM users WHERE name = \'" + name + "\'").fetchall()\n';
  await set('scanner.path', scanner); await set('scanner.automatic', false); await set('scanner.settleSeconds', 2); await set('session.notifications', 'none');

  await t('missing scanner: reported as not scanned, never as a clean result', async () => {
    await set('scanner.path', '/nonexistent/trustcode-scan');
    await security.scan('full');
    assert.strictEqual(security.model().availability, 'missing');
    assert.strictEqual(security.report, undefined);
    await view.showTab('security');
    assert.match(html[html.length - 1], /Scanner not found[\s\S]*nothing was scanned/);
    await set('scanner.path', scanner);
  });

  await t('full project scan without signing in: tracked, untracked and pre-existing files are all examined', async () => {
    write('app/db.py', SQLI);                                             // untracked, never opened in an editor
    write('config/keys.py', 'GITHUB_TOKEN = "gh' + 'p_' + 'Zx9Kq2LmN8vB4tR7yW1cE5uA3sD6fG0hJ2kLmN"\n');
    const r = await security.scan('full');
    assert.ok(r, security.error);
    assert.strictEqual(r.status, 'complete');
    assert.ok(found('py-taint-sql', 'app/db.py').length === 1, 'SQL injection in an untracked file not found');
    assert.ok(found('TC-SEC-001', 'config/keys.py').length === 1, 'exposed token not found');
    assert.ok(found('eval-exec-use', 'app/legacy.py').length === 1, 'pre-existing vulnerability in an unmodified file not found');
    assert.ok(!JSON.stringify(security.report).includes('Zx9Kq2LmN8vB4tR7yW1cE5uA3sD6fG0hJ2kLmN'), 'secret value leaked into the report');
    assert.ok(r.files.excluded['dependency directory'] >= 1 && r.files.excluded['build output or cache'] >= 1, `exclusions not reported: ${JSON.stringify(r.files.excluded)}`);
    await view.showTab('security');
    const page = html[html.length - 1];
    assert.match(page, /Security overview[\s\S]*Scan complete/);
    assert.ok(!/Why it matters|Explain for/.test(page));
  });

  await t('exact highlighting: the diagnostic covers the vulnerable expression, not the whole file', async () => {
    const f = found('py-taint-sql', 'app/db.py')[0];
    const uri = vscode.Uri.file(abs('app/db.py'));
    const d = vscode.languages.getDiagnostics(uri).find((x) => x.source === 'TrustCode security' && x.code === 'py-taint-sql');
    assert.ok(d, 'no diagnostic');
    assert.strictEqual(d!.range.start.line, 4);
    const doc = await vscode.workspace.openTextDocument(uri);
    const text = doc.getText(d!.range);
    assert.ok(text.startsWith('"SELECT') && !text.includes('conn.execute') && text.length < 80, `range is not the query expression: ${text}`);
    assert.strictEqual(d!.severity, vscode.DiagnosticSeverity.Error);
    assert.match(d!.message, /strongly suspected/);
    await security.open(f.fingerprint);
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, uri.fsPath);
    assert.strictEqual(vscode.window.activeTextEditor?.selection.start.line, 4);
    const first = vscode.window.activeTextEditor!.document.uri.fsPath;
    await vscode.commands.executeCommand('trustcode.nextSecurityFinding');
    const second = `${vscode.window.activeTextEditor!.document.uri.fsPath}:${vscode.window.activeTextEditor!.selection.start.line}`;
    assert.notStrictEqual(second, `${first}:4`, 'next finding did not move');
  });

  await t('files created by any tool are picked up automatically, after changes settle, as one batch', async () => {
    await set('scanner.automatic', true);
    for (let i = 0; i < 6; i++) write(`agent/handler_${i}.js`, `function h${i}(req, res) { res.send("<p>" + req.query.q + "</p>"); }\nmodule.exports = h${i};\n`);
    await until(() => found('js-taint-xss').length === 6 && !security.scanning, 'automatic rescan of agent-created files');
    assert.ok(security.report.files.fromCache > 0, 'unchanged files should be reused from the cache');
    fs.rmSync(abs('agent/handler_0.js'));
    await until(() => found('js-taint-xss').length === 5 && !security.scanning, 'deleted file leaves the report');
    await set('scanner.automatic', false);
  });

  await t('AI session integration: when a tracked session reaches a review point its changes are scanned', async () => {
    const session = hook.session;
    assert.ok(await session.start('Test agent'));
    write('agent/upload.php', '<?php\ninclude $_GET["page"];\n');
    await until(() => (session.model().session?.changes ?? []).some((c: any) => c.path === 'agent/upload.php'), 'session change');
    await session.end(false);
    await until(() => found('php-taint-file', 'agent/upload.php').length === 1 && !security.scanning, 'scan of the session changes');
    assert.ok(found('py-taint-sql', 'app/db.py').length === 1, 'a scan limited to the session files must not wipe other findings');
  });

  await t('before-commit scan checks staged content and applies the blocking policy', async () => {
    const cp = require('child_process');
    cp.execFileSync('git', ['add', 'app/db.py'], { cwd: root });
    const r = await security.scan('staged');
    assert.deepStrictEqual([...new Set(r.findings.map((f: any) => f.path))], ['app/db.py']);
    assert.strictEqual(r.gate.decision, 'block');
    await view.showTab('security');
    assert.match(html[html.length - 1], /Policy decision: BLOCK/);
    cp.execFileSync('git', ['reset', '-q'], { cwd: root });
  });

  await t('baseline and review: existing findings stay visible, new ones are marked, a reviewed one is recorded', async () => {
    const cp = require('child_process');
    cp.execFileSync(scanner, ['baseline', '--format', 'json', '--output', path.join(root, '.trustcode', 'b.json')], { cwd: root });
    write('app/new_feature.py', SQLI.replace('find', 'search'));
    const r = await security.scan('full');
    const states = Object.fromEntries(r.findings.map((f: any) => [f.path, f.state]));
    assert.strictEqual(states['app/new_feature.py'], 'new');
    assert.strictEqual(states['app/db.py'], 'existing');
    const target = found('eval-exec-use', 'app/legacy.py')[0];
    cp.execFileSync(scanner, ['review', target.fingerprint, '--reason', 'legacy helper, not reachable from requests'], { cwd: root });
    const after = await security.scan('full');
    assert.strictEqual(after.findings.find((f: any) => f.fingerprint === target.fingerprint).state, 'suppressed');
    assert.ok(!vscode.languages.getDiagnostics(vscode.Uri.file(abs('app/legacy.py'))).some((d) => d.source === 'TrustCode security' && d.code === 'eval-exec-use'));
    await view.showTab('security');
    assert.match(html[html.length - 1], /Reviewed false positives \(1\)[\s\S]*not reachable from requests/);
  });

  await t('webview messages for the scanner are validated', async () => {
    await view.onMessage({ action: 'secScan', key: 'rm -rf /' });
    await view.onMessage({ action: 'secOpen', finding: '../../etc/passwd' });
    await view.onMessage({ action: 'secGroup', key: 'evil' });
    assert.strictEqual(security.groupBy, 'severity');
    await view.onMessage({ action: 'secGroup', key: 'file' });
    assert.strictEqual(security.groupBy, 'file');
  });
  return results;
}
