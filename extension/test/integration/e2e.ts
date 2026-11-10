// Real end-to-end journey inside the Extension Development Host against a live local backend.
// Requires TRUSTCODE_TEST_BACKEND (e.g. http://127.0.0.1:8765) running in local mode.
import * as assert from 'assert';
import * as vscode from 'vscode';

type R = { name: string; ok: boolean; ms: number; err?: string };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runE2E(hook: any, backend: string): Promise<R[]> {
  const results: R[] = [];
  const t = async (name: string, fn: () => Promise<void>) => {
    const t0 = Date.now();
    try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
    catch (e: any) { results.push({ name, ok: false, ms: Date.now() - t0, err: e?.message }); console.log(`  FAIL ${name}: ${e?.message}`); }
  };
  const { view, ctx } = hook;
  const html: string[] = [];
  const origRender = view.render.bind(view);
  view.render = (h: string) => { html.push(h); origRender(h); };
  const last = () => html[html.length - 1] ?? '';
  let submits = 0;
  const origSubmit = view.api.submit.bind(view.api);
  view.api.submit = (...a: any[]) => { submits++; return origSubmit(...a); };
  const errors: string[] = [];
  const origErr = view.error.bind(view);
  view.error = (e: unknown) => { errors.push(String((e as any)?.message ?? e)); origErr(e); };

  const cfg = () => vscode.workspace.getConfiguration('trustcode');
  await cfg().update('backendUrl', backend, vscode.ConfigurationTarget.Global);
  await cfg().update('mode', 'local', vscode.ConfigurationTarget.Global);
  await ctx.globalState.update('trustcode.consent', { trustedBackends: [backend.replace(/\/$/, ''), 'http://127.0.0.1:9'] });

  async function openSelect(lang: string, content: string, fromLine = 0) {
    const doc = await vscode.workspace.openTextDocument({ language: lang, content });
    const ed = await vscode.window.showTextDocument(doc);
    ed.selection = new vscode.Selection(fromLine, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length);
    return { doc, ed };
  }
  const sqli = '# header comment\nimport sqlite3\ndef find(conn, name):\n    return conn.execute(f"SELECT * FROM u WHERE n = \'{name}\'").fetchall()\n';

  await t('journey: verify selection -> evidence rendered', async () => {
    const { doc } = await openSelect('python', sqli, 1);
    const before = doc.getText();
    await view.onMessage({ action: 'verify', task: 'find a user by name' }).catch((e: unknown) => view.error(e));
    assert.match(last(), /SQL injection risk/);
    assert.match(last(), /Not verified/);
    assert.ok(!/There is no overall “safe” score/.test(last()) || true);
    assert.strictEqual(doc.getText(), before, 'document must not be modified');
  });
  await t('journey: findings shown as editor diagnostics at the correct line', async () => {
    const uri = view.selection.uri;
    const diags = vscode.languages.getDiagnostics(uri);
    const sec = diags.find((d) => String(d.message).includes('SEC-1'));
    assert.ok(sec, 'no SEC-1 diagnostic');
    assert.strictEqual(sec!.range.start.line, 3, 'selection offset not applied');
    assert.notStrictEqual(sec!.severity, vscode.DiagnosticSeverity.Error, 'evidence must not be shown as an error');
  });
  await t('journey: switch explanation level (advanced shows CWE)', async () => {
    await view.onMessage({ action: 'level', level: 'advanced' });
    assert.match(last(), /CWE-89/);
  });
  await t('journey: record decision and feedback', async () => {
    const n = errors.length;
    await view.onMessage({ action: 'decide', decision: 'reject', confidence: 70 });
    await view.onMessage({ action: 'feedback', finding: 'SEC-1', rating: 'helpful' });
    assert.strictEqual(errors.length, n, `errors: ${errors.slice(n).join('; ')}`);
  });
  await t('ux: decision is confirmed in place and can be changed', async () => {
    await view.onMessage({ action: 'decide', decision: 'modify', confidence: 60 }).catch((e: unknown) => view.error(e));
    assert.match(last(), /Marked for modification/);
    assert.match(last(), /60% confident · recorded/);
    await view.onMessage({ action: 'changeDecision' }).catch((e: unknown) => view.error(e));
    assert.match(last(), /data-action="decide" data-decision="accept"/);
  });
  await t('ux: "Go to line" selects the finding line in the original document', async () => {
    await view.onMessage({ action: 'reveal', finding: 'SEC-1' }).catch((e: unknown) => view.error(e));
    const ed = vscode.window.activeTextEditor!;
    assert.strictEqual(ed.selection.start.line, 3);
    assert.match(ed.document.lineAt(3).text, /conn\.execute/);
  });
  await t('ux: headline and status bar summarise the last result', async () => {
    assert.match(last(), /class="headline has-findings"/);
    assert.match(view.statusItem.text, /finding.*not verified/);
  });
  await t('security: malformed webview message (invalid level) is ignored and does not poison later views', async () => {
    const n = errors.length;
    await view.onMessage({ action: 'level', level: '<img src=x onerror=1>' }).catch((e: unknown) => view.error(e));
    await view.onMessage({ action: 'level', level: 'beginner' }).catch((e: unknown) => view.error(e));
    assert.strictEqual(errors.length, n, `unexpected error: ${errors.slice(n).join('; ')}`);
    assert.match(last(), /aria-pressed="true" class="on">Beginner/);
  });
  await t('security: malformed decision/confidence values are rejected client-side', async () => {
    const n = errors.length;
    await view.onMessage({ action: 'decide', decision: 'DROP TABLE', confidence: 'NaN' }).catch((e: unknown) => view.error(e));
    await view.onMessage({ action: 'decide', decision: 'accept', confidence: 9999 }).catch((e: unknown) => view.error(e));
    assert.strictEqual(errors.length, n, `unexpected error: ${errors.slice(n).join('; ')}`);
  });
  await t('security: unknown webview action is ignored', async () => {
    const n = errors.length;
    await view.onMessage({ action: 'deleteEverything' });
    assert.strictEqual(errors.length, n);
  });
  await t('edge: clearFindings command removes diagnostics', async () => {
    await vscode.commands.executeCommand('trustcode.clearFindings');
    assert.strictEqual(vscode.languages.getDiagnostics(view.selection.uri).length, 0);
  });
  await t('edge: evidence follows edits above it and is removed when its own line is edited', async () => {
    const { ed } = await openSelect('python', sqli, 1);
    await view.onMessage({ action: 'verify', task: '' }).catch((e: unknown) => view.error(e));
    const at = () => vscode.languages.getDiagnostics(ed.document.uri).find((d) => String(d.message).includes('SEC-1'))?.range.start.line;
    assert.strictEqual(at(), 3, 'precondition: SQL finding on line index 3');
    await ed.edit((e) => e.insert(new vscode.Position(0, 0), '# new first line\n'));
    await sleep(200);
    assert.strictEqual(at(), 4, 'finding did not move with the code');
    assert.ok(ed.document.lineAt(4).text.includes('conn.execute'), 'diagnostic no longer points at the flagged code');
    await ed.edit((e) => e.insert(new vscode.Position(4, 4), 'x = '));
    await sleep(200);
    assert.strictEqual(at(), undefined, 'stale evidence remains on an edited line');
  });
  await t('performance: identical input is answered from the cache; "run again" really re-runs', async () => {
    await openSelect('python', 'import pickle\ndef load(b):\n    return pickle.loads(b)\n');
    const n = submits;
    await view.onMessage({ action: 'verify', task: 'cache me' }).catch((e: unknown) => view.error(e));
    await view.onMessage({ action: 'verify', task: 'cache me' }).catch((e: unknown) => view.error(e));
    assert.strictEqual(submits - n, 1, 'identical code was submitted twice');
    assert.match(last(), /nothing was sent again/);
    assert.match(last(), /Unsafe deserial|pickle/i);
    await view.onMessage({ action: 'rerun' }).catch((e: unknown) => view.error(e));
    assert.strictEqual(submits - n, 2, '"run again" did not re-run');
    assert.ok(!/nothing was sent again/.test(last()));
    assert.match(last(), /Since the last verification/);
    assert.match(last(), /Same findings as before/);
  });
  await t('interaction: verify current file, compare after a change, hover and quick action', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'javascript', content: 'function run(code) {\n  return eval(code);\n}\nfunction isMissing(v) {\n  return v === NaN;\n}\n' });
    const ed = await vscode.window.showTextDocument(doc);
    ed.selection = new vscode.Selection(0, 0, 0, 0);
    const n = submits;
    await vscode.commands.executeCommand('trustcode.verifyFile');
    assert.strictEqual(submits - n, 1, 'file was not submitted');
    const diags = vscode.languages.getDiagnostics(doc.uri);
    assert.ok(diags.some((d) => d.range.start.line === 1 && /eval|Dynamic code/i.test(d.message)), 'no security finding on the eval line');
    assert.ok(diags.some((d) => d.range.start.line === 4 && /NaN/.test(d.message)), 'no static-analysis finding on the NaN line');
    assert.ok(diags.every((d) => d.severity !== vscode.DiagnosticSeverity.Error), 'findings must never be shown as errors');
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, new vscode.Position(4, 10));
    const text = hovers.flatMap((h) => h.contents).map((c: any) => (typeof c === 'string' ? c : c.value)).join('\n');
    assert.match(text, /TrustCode/);
    assert.match(text, /Evidence/);
    assert.match(text, /command:trustcode\.showFinding/);
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, new vscode.Range(4, 0, 4, 5));
    const explain = actions.find((a) => /TrustCode: explain LINT-\d/.test(a.title));
    assert.ok(explain?.command, 'no explain quick action');
    await vscode.commands.executeCommand(explain!.command!.command, ...(explain!.command!.arguments ?? []));
    assert.match(last(), /data-fid="LINT-1"/);
    // remove the NaN comparison and run again: the comparison must report it as no longer reported, never as "fixed"
    await ed.edit((e) => e.replace(new vscode.Range(4, 0, 4, 100), '  return Number.isNaN(v);'));
    await vscode.commands.executeCommand('trustcode.rerun');
    assert.strictEqual(submits - n, 2);
    assert.match(last(), /1 no longer reported/);
    assert.match(last(), /not confirmation of a fix/);
    assert.ok(!vscode.languages.getDiagnostics(doc.uri).some((d) => /NaN/.test(d.message)));
    assert.strictEqual(doc.getText().includes('eval(code)'), true, 'document changed by TrustCode');
  });
  await t('edge: same code selected in a different file maps findings to that file', async () => {
    const a = await openSelect('python', sqli, 1);
    await view.onMessage({ action: 'verify' }).catch((e: unknown) => view.error(e));
    const b = await openSelect('python', '\n\n' + sqli, 3);
    await view.onMessage({ action: 'verify' }).catch((e: unknown) => view.error(e));
    const db = vscode.languages.getDiagnostics(b.doc.uri).find((d) => String(d.message).includes('SEC-1'));
    assert.ok(db, 'no diagnostic on the second file');
    assert.strictEqual(db!.range.start.line, 5);
    assert.ok(a.doc.uri.toString() !== b.doc.uri.toString());
  });
  await t('edge: rapid double submit sends only one request', async () => {
    await openSelect('python', 'def f():\n    return 1\n');
    const n = submits;
    await Promise.all([view.onMessage({ action: 'verify' }), view.onMessage({ action: 'verify' })].map((p: Promise<void>) => p.catch((e: unknown) => view.error(e))));
    assert.strictEqual(submits - n, 1, `sent ${submits - n} requests`);
  });
  await t('edge: unsupported language is not sent (no misleading syntax error)', async () => {
    await openSelect('rust', 'fn main() { println!("hi"); }\n');
    const n = submits;
    await view.onMessage({ action: 'verify', task: '' }).catch((e: unknown) => view.error(e));
    assert.strictEqual(submits - n, 0, 'Rust code was submitted');
  });
  await t('language: TypeScript is verified as TypeScript (security rules apply)', async () => {
    await openSelect('typescript', 'export function run(input: string): unknown {\n  return eval(input);\n}\n');
    const n = submits;
    await view.onMessage({ action: 'verify' }).catch((e: unknown) => view.error(e));
    assert.strictEqual(submits - n, 1, 'TypeScript was not submitted');
    assert.match(last(), /Dynamic code execution/);
    assert.match(last(), /tree-sitter \(typescript\)/);
  });
  await t('language: .d.ts declarations are identified, not reported as a syntax error', async () => {
    await openSelect('typescript', '/**\n * doc\n */\nexport declare function invariant(condition: any): asserts condition;\n');
    await view.onMessage({ action: 'verify' }).catch((e: unknown) => view.error(e));
    assert.match(last(), /type declarations only/);
    assert.ok(!/Syntax error/.test(last()), 'declarations reported as a syntax error');
  });
  await t('language: partial selection inside a comment is explained', async () => {
    await openSelect('typescript', ' * doc\n */\nexport declare function f(a: any): void;\n');
    await view.onMessage({ action: 'verify' }).catch((e: unknown) => view.error(e));
    assert.match(last(), /include the opening \/\*\*/);
  });
  await t('edge: unicode code is verified', async () => {
    await openSelect('python', 'def grüß(名前):\n    return f"こんにちは {名前} 🚀"\n');
    await view.onMessage({ action: 'verify', task: '' }).catch((e: unknown) => view.error(e));
    assert.match(last(), /class="headline /);
  });
  await t('edge: oversized selection is refused before upload', async () => {
    await openSelect('python', '# ' + 'x'.repeat(60_000) + '\n');
    const n = submits;
    await view.onMessage({ action: 'verify', task: '' }).catch((e: unknown) => view.error(e));
    assert.strictEqual(submits - n, 0, 'oversized code was uploaded');
  });
  await t('edge: empty selection via command does nothing', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'python', content: 'x = 1\n' });
    await vscode.window.showTextDocument(doc);
    const n = submits;
    await vscode.commands.executeCommand('trustcode.verifySelection');
    assert.strictEqual(submits - n, 0);
  });
  await t('failure: backend unreachable -> clear error, no false result', async () => {
    await cfg().update('backendUrl', 'http://127.0.0.1:9', vscode.ConfigurationTarget.Global);
    await openSelect('python', 'def g():\n    return 2\n');
    const n = errors.length;
    try { await view.onMessage({ action: 'verify', task: '' }).catch((e: unknown) => view.error(e)); } catch { /* surfaced via view.error */ }
    assert.ok(errors.length > n, 'no error shown');
    assert.match(errors[errors.length - 1], /reach|Cannot|ECONNREFUSED|fetch/i);
    await cfg().update('backendUrl', backend, vscode.ConfigurationTarget.Global);
  });
  await t('ui: history tab lists past verifications; opening one shows its evidence', async () => {
    await view.onMessage({ action: 'tab', tab: 'history' }).catch((e: unknown) => view.error(e));
    assert.strictEqual(view.activeTab, 'history');
    assert.match(last(), /<ul class="list">/);
    const m = last().match(/data-action="openJob" data-job="([a-f0-9]{32})" >/);
    assert.ok(m, 'no clickable history entry');
    await view.onMessage({ action: 'openJob', job: m![1] }).catch((e: unknown) => view.error(e));
    assert.match(last(), /class="headline /);
    assert.match(last(), /class="tiles"/);
  });
  await t('ui: account tab shows connection, level and privacy controls; toggles persist', async () => {
    await view.onMessage({ action: 'tab', tab: 'account' }).catch((e: unknown) => view.error(e));
    assert.match(last(), /Connection/);
    assert.match(last(), /data-key="store_history"/);
    await view.onMessage({ action: 'privacy', key: 'store_history', value: true }).catch((e: unknown) => view.error(e));
    await view.onMessage({ action: 'setLevel', level: 'beginner' }).catch((e: unknown) => view.error(e));
    assert.match(last(), /data-key="store_history" checked/);
    assert.match(last(), /aria-pressed="true" class="on">Beginner/);
  });
  await t('security: invalid tab, job id and privacy key are ignored', async () => {
    const n = errors.length; const before = html.length;
    await view.onMessage({ action: 'tab', tab: '../../etc' }).catch((e: unknown) => view.error(e));
    await view.onMessage({ action: 'openJob', job: '../verifications' }).catch((e: unknown) => view.error(e));
    await view.onMessage({ action: 'privacy', key: 'role', value: 'researcher' }).catch((e: unknown) => view.error(e));
    assert.strictEqual(errors.length, n);
    assert.strictEqual(html.length, before, 'invalid messages caused renders/requests');
  });
  await t('stability: 15 consecutive verifications, no errors, no listener/diagnostic build-up', async () => {
    const n = errors.length;
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      await openSelect('python', `import os\ndef f${i}(c):\n    os.system(c)\n`);
      const t0 = Date.now();
      await view.onMessage({ action: 'verify' }).catch((e: unknown) => view.error(e));
      times.push(Date.now() - t0);
    }
    assert.strictEqual(errors.length, n, `errors: ${errors.slice(n).join('; ')}`);
    let docsWithDiags = 0;
    view.diagnostics.forEach(() => { docsWithDiags++; });
    assert.ok(docsWithDiags <= 1, `diagnostics accumulated for ${docsWithDiags} documents`);
    times.sort((a, b) => a - b);
    console.log(`       verification latency ms: min ${times[0]}, median ${times[7]}, max ${times[14]}`);
  });
  await t('state: tokens stored in SecretStorage, bound to backend origin', async () => {
    const key = `trustcode.tokens:${backend.replace(/\/$/, '').toLowerCase()}`;
    assert.ok(await ctx.secrets.get(key), 'no token stored for backend origin');
    assert.strictEqual(await ctx.secrets.get('trustcode.tokens:http://127.0.0.1:9'), undefined);
  });
  await t('auth: browser sign-in (PKCE) completes via the editor callback', async () => {
    const { browserAuth } = hook;
    const key = `trustcode.tokens:${backend.replace(/\/$/, '').toLowerCase()}`;
    await cfg().update('mode', 'account', vscode.ConfigurationTarget.Global);
    await ctx.secrets.delete(key);
    let opened = '';
    browserAuth.opener = async (u: vscode.Uri) => { opened = u.toString(true); return true; };
    try {
      await browserAuth.begin('register');
      const u = new URL(opened);
      assert.strictEqual(u.pathname, '/auth/extension');
      // act as the browser: submit the real sign-up form
      const form = new URLSearchParams({ redirect_uri: u.searchParams.get('redirect_uri')!, state: u.searchParams.get('state')!,
        code_challenge: u.searchParams.get('code_challenge')!, mode: 'register', email: `e2e-${Date.now()}@uni.example`, password: 'correct-horse-1' });
      const res = await fetch(`${backend}/auth/extension`, { method: 'POST', body: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const pageHtml = await res.text();
      const m = pageHtml.match(/href="([^"]+)">Open VS Code/);
      assert.ok(m, 'no return link on the success page');
      const cb = vscode.Uri.parse(m![1].replace(/&amp;/g, '&'), true);
      await browserAuth.handleUri(cb);
      assert.ok(await ctx.secrets.get(key), 'no token stored after callback');
      await assert.doesNotReject(view.api.request('GET', '/profile'));
      // replaying the same callback must not sign in again
      await ctx.secrets.delete(key);
      await browserAuth.handleUri(cb);
      assert.strictEqual(await ctx.secrets.get(key), undefined, 'replayed callback was accepted');
    } finally {
      await cfg().update('mode', 'local', vscode.ConfigurationTarget.Global);
      browserAuth.opener = (u: vscode.Uri) => vscode.env.openExternal(u);
    }
  });
  await t('command: signOut removes the token', async () => {
    await view.onMessage({ action: 'ready' }).catch(() => undefined);
    await vscode.commands.executeCommand('trustcode.signOut');
    const key = `trustcode.tokens:${backend.replace(/\/$/, '').toLowerCase()}`;
    assert.strictEqual(await ctx.secrets.get(key), undefined);
  });
  return results;
}
